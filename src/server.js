import { tool } from "@opencode-ai/plugin"
import { installedStateDir, shadowedByLocalInstall } from "./install-state.js"
import { createGitAdapter, createOpenCodeAdapter } from "./adapter.js"
import { SchedulerState } from "./scheduler.js"
import { runContinuationPhases } from "./continuation.js"
import { executeVerificationGate } from "./verification-gate.js"
import { normalizePluginOptions } from "./options.js"
import { normalizePromptResponse } from "./host.js"
import { isTransientAccountingError } from "./errors.js"
import { resolveEventAction } from "./event-routing.js"
import { handleSessionError } from "./error-lifecycle.js"
import { accountToolBoundary } from "./tool-accounting.js"
import { applyCompactionContext, applySystemPolicy, disableCompactionAutocontinue } from "./context-hooks.js"
import { handleSlashCommand } from "./commands.js"
import { ContextSettings } from "./context.js"
import { ContextCompactor } from "./context-compaction.js"
import { collectSessionUsage } from "./traversal.js"
import {
  accountTargetUsage,
  addTargetCheckpoint,
  addTargetEvidence,
  acquireSchedulerLease,
  budgetLimitPrompt,
  compactionTargetContext,
  continuationPrompt,
  createTarget,
  defaultStateDir,
  markBudgetWrapupSent,
  markContinuationStarted,
  refreshTargetEvidence,
  newSchedulerOwnerID,
  publicTargetJSON,
  readTarget,
  recordTargetTurnOutcome,
  recordTargetTurnOutcomes,
  recordVerificationResult,
  releaseSchedulerLease,
  renewSchedulerLease,
  setStoppedStatus,
  snapshotTarget,
  systemTargetPolicy,
  consumeContinuationDeferral,
} from "./core.js"

const PLUGIN_ID = "opencode-target"
const defaultGitAdapter = createGitAdapter()

async function log(client, level, message, extra = undefined) {
  try {
    await client.app.log({
      body: { service: PLUGIN_ID, level, message, ...(extra ? { extra } : {}) },
    })
  } catch {
    // Logging must never affect Target execution.
  }
}

function listMessages(source, sessionID) { return (source.adapter || source).messages(sessionID) }
function listChildren(source, sessionID) { return (source.adapter || source).children(sessionID) }

async function accountLiveTarget(adapter, stateDir, sessionID, targetID, options, rootMessages) {
  const samples = await collectSessionUsage(adapter.adapter || adapter, sessionID, {
    maxDepth: Math.max(0, Number(options?.descendant_max_depth ?? 6)),
    maxSessions: Math.max(1, Number(options?.descendant_max_sessions ?? 96)),
    rootMessages,
  })
  return accountTargetUsage(stateDir, sessionID, samples, { expectedTargetID: targetID })
}

async function sendPrompt(client, sessionID, text) {
  const hostAdapter = client.adapter || client
  const logClient = client.client || client
  void log(logClient, "debug", "Target continuation prompt started", { sessionID, phase: "prompt" })
  try {
    const response = await hostAdapter.prompt(sessionID, text)
    void log(logClient, "debug", "Target continuation prompt finished", { sessionID, phase: "post" })
    return response
  } catch (error) {
    void log(logClient, "warn", "Target continuation prompt failed", { sessionID, phase: "prompt", code: error?.code, error: error?.message })
    throw error
  }
}

async function sendPromptAsync(client, sessionID, text) {
  const hostAdapter = client.adapter || client
  const logClient = client.client || client
  void log(logClient, "debug", "Target async continuation prompt started", { sessionID, phase: "prompt" })
  try {
    await hostAdapter.promptAsync(sessionID, text)
    void log(logClient, "debug", "Target async continuation prompt dispatched", { sessionID, phase: "dispatched" })
  } catch (error) {
    void log(logClient, "warn", "Target async continuation prompt failed", { sessionID, phase: "prompt", code: error?.code, error: error?.message })
    throw error
  }
}

async function targetDiagnostics(host, stateDir, sessionID) {
  const checks = []
  try {
    const target = await readTarget(stateDir, sessionID)
    if (!target) {
      checks.push("state: ok (no Target)")
    } else {
      const lease = target.schedulerLease
      const leaseState = lease
        ? lease.expiresAtMs <= Date.now() ? `expired (${lease.owner})` : `held (${lease.owner})`
        : "none"
      checks.push(`state: ok (${target.status}, schema ${target.version})`)
      checks.push(`scheduler lease: ${leaseState}`)
      checks.push(`accounting: ${target.accounting.truncated ? "warning, watermark history truncated" : "ok"}`)
    }
  } catch (error) {
    checks.push(`state: error (${error?.message || String(error)})`)
  }
  for (const [label, operation] of [
    ["messages API", () => listMessages(host, sessionID)],
    ["children API", () => listChildren(host, sessionID)],
  ]) {
    try {
      await operation()
      checks.push(`${label}: ok`)
    } catch (error) {
      checks.push(`${label}: error (${error?.message || String(error)})`)
    }
  }
  return `Target diagnostics\n${checks.map((check) => `- ${check}`).join("\n")}`
}

async function executeVerificationGateFor($, cwd, stateDir, sessionID, target, gate) {
  if (typeof $ !== "function") throw new Error("Verification execution is unavailable in this OpenCode runtime.")
  return executeVerificationGate({
    gate,
    cwd,
    stateDir,
    sessionID,
    target,
    run: (command) => $.cwd(cwd || process.cwd()).nothrow()`${{ raw: command }}`,
    fingerprint: getWorktreeFingerprint,
    refreshTargetEvidence,
    recordVerificationResult,
  })
}

async function getWorktreeFingerprint(cwd) {
  try {
    return await defaultGitAdapter.fingerprint(cwd || process.cwd())
  } catch {
    return null
  }
}

async function processIdle(scheduler, host, stateDir, sessionID, options) {
  return scheduler.runExclusive(sessionID, async () => {
    let shouldRecheck = false
    let leaseOwner = null
    let leaseTargetID = null
    let expectedTargetID = null
    let accountingPhase = "pre"
    const phaseContext = { value: accountingPhase }
    let recheckDelay = Math.max(50, Number(options?.min_continue_interval_ms ?? 250))

    try {
      let target = await readTarget(stateDir, sessionID)
      if (!target) return
      expectedTargetID = target.targetID
      target = await refreshTargetEvidence(stateDir, sessionID, await getWorktreeFingerprint(options.worktree), expectedTargetID) || target
      leaseOwner = newSchedulerOwnerID()
      const lease = await acquireSchedulerLease(stateDir, sessionID, leaseOwner, {
        expectedTargetID,
        leaseMs: options.scheduler_lease_ms,
      })
      if (!lease?.acquired) {
        if (lease?.leaseExpiresAtMs) {
          shouldRecheck = true
          recheckDelay = Math.max(50, lease.leaseExpiresAtMs - Date.now() + 10)
        }
        return
      }
      leaseTargetID = expectedTargetID
      scheduler.startHeartbeat(sessionID, Math.max(250, Math.floor(options.scheduler_lease_ms / 3)), () => {
        void renewSchedulerLease(stateDir, sessionID, leaseOwner, {
          expectedTargetID,
          leaseMs: options.scheduler_lease_ms,
        }).catch(() => {})
      })

      const phaseResult = await runContinuationPhases({
        scheduler,
        host,
        stateDir,
        sessionID,
        options,
        target,
        expectedTargetID,
        leaseOwner,
        phaseContext,
        operations: {
          listMessages,
          recordTargetTurnOutcome,
          recordTargetTurnOutcomes,
          accountLiveTarget,
          sendPrompt: async (currentHost, currentSessionID, prompt) => normalizePromptResponse(await sendPrompt(currentHost, currentSessionID, prompt)),
          sendPromptAsync: typeof host.client?.session?.promptAsync === "function" ? sendPromptAsync : null,
          continuationPrompt,
          budgetLimitPrompt,
          markBudgetWrapupSent,
          consumeContinuationDeferral,
          markContinuationStarted,
          checkContext: (id, settings) => host.context.check(id, settings),
        },
      })
      accountingPhase = phaseContext.value
      shouldRecheck = phaseResult.decision === "recheck"
      recheckDelay = phaseResult.recheckDelay
      if (phaseResult.awaitingIdle) {
        const checkContinuation = async () => {
          const current = await readTarget(stateDir, sessionID)
          if (current?.targetID !== expectedTargetID || current.status !== "active") return
          if (host.pendingInput.get(sessionID)?.size) {
            scheduler.startContinuationWatchdog(sessionID, options.continuation_watchdog_ms, () => { void checkContinuation().catch(() => {}) })
            return
          }
          if (typeof host.client.session.status === "function") {
            try {
              const status = await host.adapter.status(sessionID)
              if (status === "busy" || status === "retry") {
                scheduler.startContinuationWatchdog(sessionID, options.continuation_watchdog_ms, () => { void checkContinuation().catch(() => {}) })
                return
              }
            } catch {
              scheduler.startContinuationWatchdog(sessionID, options.continuation_watchdog_ms, () => { void checkContinuation().catch(() => {}) })
              return
            }
          }
          await setStoppedStatus(stateDir, sessionID, "paused",
            `Continuation watchdog expired after ${options.continuation_watchdog_ms}ms without a session.idle event.`, expectedTargetID)
          void log(host.client, "error", "Target continuation watchdog expired", { sessionID, expectedTargetID, timeoutMs: options.continuation_watchdog_ms })
        }
        scheduler.startContinuationWatchdog(sessionID, options.continuation_watchdog_ms, () => { void checkContinuation().catch(() => {}) })
      }
    } catch (error) {
      accountingPhase = phaseContext.value
      if (expectedTargetID && error?.code === "OPENCODE_PROMPT_PENDING") {
        scheduler.resetRetries(sessionID)
        await setStoppedStatus(stateDir, sessionID, "paused", error.message.slice(0, 500), expectedTargetID).catch(() => {})
      } else if (expectedTargetID && isTransientAccountingError(error)) {
        const retry = scheduler.nextRetry(sessionID, options.accounting_retry, accountingPhase)
        if (retry.retry) {
          shouldRecheck = true
          recheckDelay = retry.delayMs
        } else {
          await setStoppedStatus(
            stateDir,
            sessionID,
            "paused",
            `Continuation host API unavailable after ${retry.attempt} attempts: ${error.message}`.slice(0, 500),
            expectedTargetID,
          ).catch(() => {})
        }
      } else if (expectedTargetID && error?.code === "ACCOUNTING_TRAVERSAL_INCOMPLETE") {
        scheduler.resetRetries(sessionID)
        await setStoppedStatus(
          stateDir,
          sessionID,
          "paused",
          `Accounting incomplete: ${error.message}`.slice(0, 500),
          expectedTargetID,
        ).catch(() => {})
      } else if (expectedTargetID) {
        scheduler.resetRetries(sessionID)
        await setStoppedStatus(
          stateDir,
          sessionID,
          "blocked",
          `Continuation failed unexpectedly: ${error?.message || String(error)}`.slice(0, 500),
          expectedTargetID,
        ).catch(() => {})
      }
      await log(host.client, "error", "Target idle continuation failed", {
        sessionID,
        code: error?.code || null,
        phase: accountingPhase,
        error: String(error?.stack || error),
      })
    } finally {
      scheduler.stopHeartbeat(sessionID)
      if (leaseOwner && leaseTargetID) {
        await releaseSchedulerLease(stateDir, sessionID, leaseOwner, leaseTargetID).catch(() => {})
      }
      if (shouldRecheck) {
        scheduler.scheduleRecheck(sessionID, recheckDelay, () => {
          void processIdle(scheduler, host, stateDir, sessionID, options)
        })
      }
    }
  })
}

function completionResponse(target) {
  const view = snapshotTarget(target)
  return JSON.stringify({
    ...view,
    completionBudgetReport:
      target?.status === "complete"
        ? "Target achieved. In the final response, report token usage when a budget exists and summarize elapsed Target time when it is non-zero."
        : null,
  }, null, 2)
}

export const TargetPlugin = async ({ client, $, directory }, rawOptions = {}) => {
  if (await shadowedByLocalInstall(import.meta.url, directory)) return {}
  const options = normalizePluginOptions({ ...rawOptions, worktree: rawOptions.worktree ?? directory ?? process.cwd() })
  const adapter = createOpenCodeAdapter(client, { timeoutMs: options.host_api_timeout_ms })
  const host = { adapter, client, pendingInput: new Map(), usageUpdates: new Map(), sessionStatus: new Map() }
  const scheduler = new SchedulerState()
  const stateDir = options.state_dir ? String(options.state_dir) : await installedStateDir(import.meta.url) || defaultStateDir()
  const commandName = String(options.command_name || "target")
  const aliasName = options.alias === false ? null : String(options.alias || "t")
  const autoContinue = options.auto_continue !== false
  const maxBudget = options.max_target_token_budget ?? null
  const contextSettings = new ContextSettings(stateDir)
  const context = new ContextCompactor({
    stateDir, settings: contextSettings, adapter,
    pendingInput: (sessionID) => Boolean(host.pendingInput.get(sessionID)?.size),
    log: (level, message, extra) => { void log(client, level, message, extra) },
    onReady: (sessionID) => {
      if (autoContinue && !host.pendingInput.get(sessionID)?.size) scheduler.scheduleRecheck(sessionID, 50, () => {
        void (async () => {
          const status = typeof client.session.status === "function" ? await adapter.status(sessionID) : host.sessionStatus.get(sessionID)
          if (status === "busy" || status === "retry") { context.wake(sessionID, 250); return }
          await processIdle(scheduler, host, stateDir, sessionID, options)
        })().catch((error) => log(client, "warn", "Post-compaction continuation check failed", { sessionID, error: error.message }))
      })
    },
  })
  host.context = context

  await log(client, "info", "OpenCode Target initialized", {
    stateDir,
    commandName,
    aliasName,
    autoContinue,
    maxTargetTokenBudget: maxBudget,
  })

  return {
    whenIdle: async (sessionID) => { await context.settled(String(sessionID)); await scheduler.whenIdle(String(sessionID)) },

    config: async (config) => {
      config.command ??= {}
      config.command[commandName] = {
        template: "$ARGUMENTS",
        description: "Start or control a persistent verified Target that continues across turns",
      }
      if (aliasName && aliasName !== commandName) {
        config.command[aliasName] = {
          template: "$ARGUMENTS",
          description: `Short alias for /${commandName}`,
        }
      }
    },

    tool: {
      get_target: tool({
        description:
          "Get the current persistent Target for this session, including status, objective, token budget, root and descendant token usage, elapsed active time, and remaining token budget.",
        args: {},
        async execute(_args, context) {
          let target = await readTarget(stateDir, context.sessionID)
          if (!target) return JSON.stringify({ target: null, remainingTokens: null }, null, 2)
          target = (await accountLiveTarget(host, stateDir, context.sessionID, target.targetID, options)) || target
          return publicTargetJSON(target)
        },
      }),

      create_target: tool({
        description:
          "Create a persistent Target only when the user or higher-priority instructions explicitly request Target mode. Do not infer a Target from an ordinary task. A new Target can replace only a completed Target; an unfinished Target must be completed or cleared first. Set token_budget only when explicitly requested; the runtime may apply a configured default/maximum.",
        args: {
          objective: tool.schema
            .string()
            .min(1)
            .max(4000)
            .describe("Required concrete objective. It should preserve the full user-requested end state and finish line."),
          token_budget: tool.schema
            .number()
            .int()
            .positive()
            .optional()
            .describe("Optional positive token budget. Omit unless explicitly requested."),
          requirements: tool.schema.array(tool.schema.object({
            id: tool.schema.string().min(1),
            text: tool.schema.string().min(1).max(1000),
          })).optional().describe("Optional acceptance requirements that must have evidence before completion."),
        },
        async execute(args, context) {
          await contextSettings.session(context.sessionID)
          const baselineSamples = await collectSessionUsage(host.adapter || host, context.sessionID, {
            maxDepth: Math.max(0, Number(options?.descendant_max_depth ?? 6)),
            maxSessions: Math.max(1, Number(options?.descendant_max_sessions ?? 96)),
          })
          const target = await createTarget(
            stateDir,
            context.sessionID,
            args.objective,
            args.token_budget ?? null,
            { maxTokenBudget: maxBudget, defaultTokenBudget: maxBudget, requirements: args.requirements, verification: options.verification, baselineSamples },
          )
          return publicTargetJSON(target)
        },
      }),

      update_target: tool({
        description:
          "Update an existing Target status. Use complete only after a requirement-by-requirement audit proves the entire objective with authoritative current evidence and no required work remains. Use blocked only when the same genuine blocker has recurred for at least three consecutive Target turns and meaningful progress is impossible without user input or external-state change. Use paused only at the user's explicit request. This tool cannot resume a Target or set usage_limited/budget_limited; those transitions belong to the user/runtime.",
        args: {
          status: tool.schema.enum(["complete", "blocked", "paused"]).describe("Required status transition."),
        },
        async execute(args, context) {
          let target = await readTarget(stateDir, context.sessionID)
          if (!target) throw new Error("No Target exists for this session.")
          const expectedTargetID = target.targetID
          target = await refreshTargetEvidence(stateDir, context.sessionID, await getWorktreeFingerprint(context.worktree), expectedTargetID) || target

          // Mirror Codex: account the live turn before applying a stopped/completed status.
          target = (await accountLiveTarget(host, stateDir, context.sessionID, expectedTargetID, options)) || target
          if (target.targetID !== expectedTargetID) throw new Error("Target changed concurrently; status update rejected.")

          const reason =
            args.status === "complete"
              ? "Objective achieved and verified"
              : args.status === "blocked"
                ? "Blocked after repeated blocker audit"
                : "Paused by explicit user request"

          target = await setStoppedStatus(stateDir, context.sessionID, args.status, reason, expectedTargetID)
          if (!target) throw new Error("Target changed concurrently; status update rejected.")
          return args.status === "complete" ? completionResponse(target) : publicTargetJSON(target)
        },
      }),
      add_target_evidence: tool({
        description: "Attach concise authoritative evidence to a declared Target requirement. This does not complete or resume a Target.",
        args: {
          requirement_id: tool.schema.string().min(1),
          kind: tool.schema.string().min(1).max(100).optional(),
          summary: tool.schema.string().min(1).max(1000),
        },
        async execute(args, context) {
          const target = await readTarget(stateDir, context.sessionID)
          if (!target) throw new Error("No Target exists for this session.")
          const updated = await addTargetEvidence(stateDir, context.sessionID, args.requirement_id, {
            kind: args.kind,
            summary: args.summary,
          }, target.targetID)
          if (!updated) throw new Error("Target changed concurrently; evidence update rejected.")
          return publicTargetJSON(updated)
        },
      }),
      verify_target_gate: tool({
        description: "Run a configured Target verification gate from trusted plugin configuration.",
        args: { verification_id: tool.schema.string().min(1) },
        async execute(args, context) {
          const target = await readTarget(stateDir, context.sessionID)
          const gate = target?.verification.find((item) => item.id === args.verification_id)
          if (!target || !gate) throw new Error(`Unknown Target verification gate: ${args.verification_id}`)
          if (typeof $ !== "function") throw new Error("Verification execution is unavailable in this OpenCode runtime.")
          const result = await executeVerificationGateFor($, context.directory || directory, stateDir, context.sessionID, target, gate)
          return publicTargetJSON(result.updated)
        },
      }),
      create_target_checkpoint: tool({
        description: "Save manual checkpoint metadata for the current Target without committing or rolling back files.",
        args: { summary: tool.schema.string().min(1).max(1000) },
        async execute(args, context) {
          const target = await readTarget(stateDir, context.sessionID)
          if (!target) throw new Error("No Target exists for this session.")
          const result = await addTargetCheckpoint(stateDir, context.sessionID, {
            summary: args.summary,
            fingerprint: await getWorktreeFingerprint(context.worktree || directory),
          }, target.targetID)
          if (!result) throw new Error("Target changed concurrently; checkpoint rejected.")
          return publicTargetJSON(result)
        },
      }),
    },

    "tool.execute.after": async (input) => {
      // Cheap root-session accounting at tool boundaries. Full descendant-tree
      // accounting occurs at idle/control boundaries to keep this hook lightweight.
      try {
        const updates = host.usageUpdates.get(input.sessionID)
        const consumed = updates ? new Map(updates) : null
        await accountToolBoundary({
          stateDir,
          sessionID: input.sessionID,
          readTarget,
          listMessages: (sessionID) => listMessages(host, sessionID),
          incrementalMessages: consumed ? [...consumed.values()] : undefined,
          accountTargetUsage,
        })
        for (const [id, sample] of consumed || []) {
          if (updates.get(id) === sample) updates.delete(id)
        }
      } catch (error) {
        await log(client, "warn", "Target tool-boundary accounting failed", {
          sessionID: input.sessionID,
          code: error?.code || "TARGET_ACCOUNTING_FAILED",
          phase: "tool.execute.after",
          error: String(error?.message || error),
        })
      }
    },

    "command.execute.before": async (input, output) => {
      if (input.command !== commandName && input.command !== aliasName) return
      try {
        const prompt = await handleSlashCommand(host, $, directory, stateDir, input.sessionID, input.arguments, options, {
          collectSessionUsage,
          getWorktreeFingerprint,
          targetDiagnostics,
          executeVerificationGate: executeVerificationGateFor,
          contextSettings,
          contextStatus: (sessionID) => context.status(sessionID),
        })
        // OpenCode keeps the original parts array; mutate it in place.
        output.parts.splice(0, output.parts.length, { type: "text", text: prompt, synthetic: true })
      } catch (error) {
        output.parts.splice(0, output.parts.length, {
          type: "text",
          text: `Target command failed: ${error?.message || String(error)}\n\nReport this error concisely and do not modify Target state further in this turn.`,
          synthetic: true,
        })
      }
    },

    "experimental.chat.system.transform": async (input, output) => {
      return applySystemPolicy({ input, output, stateDir, readTarget, systemTargetPolicy })
    },

    "experimental.session.compacting": async (input, output) => {
      await context.compacting(input.sessionID)
      return applyCompactionContext({ input, output, stateDir, readTarget, compactionTargetContext })
    },

    "experimental.compaction.autocontinue": async (input, output) => {
      return disableCompactionAutocontinue({ input, output, stateDir, readTarget })
    },

    event: async ({ event }) => {
      if (event.type === "message.updated") {
        const info = event.properties?.info
        if (info?.role === "assistant" && info.sessionID && info.id) {
          const updates = host.usageUpdates.get(info.sessionID) || new Map()
          updates.set(info.id, { info })
          host.usageUpdates.set(info.sessionID, updates)
          if (info.time?.completed) void context.check(info.sessionID).catch((error) => log(client, "warn", "Target context check failed", { sessionID: info.sessionID, error: error.message }))
        }
        return
      }
      if (event.type === "session.status") {
        host.sessionStatus.set(event.properties.sessionID, event.properties.status?.type)
      }
      if (event.type === "session.compacted") {
        void context.check(event.properties.sessionID).catch((error) => log(client, "warn", "Target compaction reconciliation failed", { error: error.message }))
        return
      }
      if (event.type === "session.idle") {
        host.sessionStatus.set(event.properties.sessionID, "idle")
        if (!autoContinue) void context.check(event.properties.sessionID).catch((error) => log(client, "warn", "Target context check failed", { error: error.message }))
      }
      if (["permission.asked", "permission.replied", "question.asked", "question.replied", "question.rejected"].includes(event.type)) {
        const properties = event.properties || {}
        const sessionID = properties.sessionID
        if (sessionID) {
          const pending = host.pendingInput.get(sessionID) || new Set()
          if (event.type.endsWith(".asked")) pending.add(properties.id)
          else pending.delete(properties.requestID)
          if (pending.size) host.pendingInput.set(sessionID, pending)
          else host.pendingInput.delete(sessionID)
          void log(client, "info", "Target input boundary", { sessionID, type: event.type, pending: pending.size })
        }
        return
      }
      const route = resolveEventAction(event, autoContinue)
      if (route.action === "dispose") {
        context.dispose()
        host.sessionStatus.clear()
        host.pendingInput.clear()
        host.usageUpdates.clear()
        scheduler.dispose()
        return
      }
      if (route.action === "ignore") return
      const { sessionID } = route

      if (route.action === "dispose-session") {
        context.disposeSession(sessionID)
        host.sessionStatus.delete(sessionID)
        host.pendingInput.delete(sessionID)
        host.usageUpdates.delete(sessionID)
        scheduler.disposeSession(sessionID)
        return
      }

      if (route.action === "process-idle") {
        if (host.pendingInput.get(sessionID)?.size) return
        scheduler.stopContinuationWatchdog(sessionID)
        void processIdle(scheduler, host, stateDir, sessionID, options)
        return
      }

      if (route.action === "process-error") {
        host.pendingInput.delete(sessionID)
        scheduler.stopContinuationWatchdog(sessionID)
        scheduler.clearRecheck(sessionID)
        try {
          await handleSessionError(event, {
            stateDir,
            sessionID,
            options,
            readTarget,
            accountLiveTarget: (stateDir, sessionID, targetID, options) => accountLiveTarget(host, stateDir, sessionID, targetID, options),
            setStoppedStatus,
          })
        } catch (error) {
          await log(client, "error", "Failed to persist Target error status", {
            sessionID,
            error: String(error?.stack || error),
          })
        }
      }
    },
  }
}
