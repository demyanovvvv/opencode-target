import { tool } from "@opencode-ai/plugin"
import { createGitAdapter, createOpenCodeAdapter } from "./adapter.js"
import { SchedulerState } from "./scheduler.js"
import { collectSessionUsage } from "./traversal.js"
import {
  accountMissionUsage,
  addMissionCheckpoint,
  addMissionEvidence,
  acquireSchedulerLease,
  budgetLimitPrompt,
  compactionMissionContext,
  conciseStatus,
  continuationPrompt,
  createMission,
  defaultStateDir,
  deferNextContinuation,
  deleteMission,
  editMission,
  markBudgetWrapupSent,
  markContinuationStarted,
  missionHelp,
  getMissionHistory,
  missionReport,
  refreshMissionEvidence,
  newSchedulerOwnerID,
  objectiveUpdatedPrompt,
  parseMissionCommand,
  pauseMission,
  publicMissionJSON,
  readMission,
  recordMissionTurnOutcome,
  recordVerificationResult,
  isRetryableVerificationFailure,
  normalizeRetryPolicy,
  releaseSchedulerLease,
  renewSchedulerLease,
  resumeMission,
  resumePrompt,
  setMissionBudget,
  setStoppedStatus,
  snapshotMission,
  systemMissionPolicy,
  consumeContinuationDeferral,
} from "./core.js"

const PLUGIN_ID = "opencode-mission"
const DEFAULT_COMMAND = "mission"
const DEFAULT_ALIAS = "msn"
const defaultGitAdapter = createGitAdapter()

function getEventSessionID(event) {
  return event?.properties?.sessionID || event?.properties?.sessionId || event?.sessionID || event?.sessionId || null
}

function eventErrorText(event) {
  const value = event?.properties?.error ?? event?.error ?? ""
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function isUsageLimitError(text) {
  return /(?:429|rate.?limit|quota|usage.?limit|insufficient.?quota|too many requests|usage.?limited)/i.test(text)
}

function isAbortError(text) {
  return /(?:aborted|cancelled|canceled|MessageAbortedError|AbortError|interrupted)/i.test(text)
}

function isTransientAccountingError(error) {
  return error?.code === "OPENCODE_MESSAGES_FAILED" ||
    error?.code === "OPENCODE_CHILDREN_FAILED" ||
    error?.code === "OPENCODE_PROMPT_FAILED"
}

async function log(client, level, message, extra = undefined) {
  try {
    await client.app.log({
      body: { service: PLUGIN_ID, level, message, ...(extra ? { extra } : {}) },
    })
  } catch {
    // Logging must never affect Mission execution.
  }
}

function listMessages(client, sessionID) { return (client.adapter || client).messages(sessionID) }
function listChildren(client, sessionID) { return (client.adapter || client).children(sessionID) }

async function accountLiveMission(adapter, stateDir, sessionID, missionID, options) {
  const samples = await collectSessionUsage(adapter.adapter || adapter, sessionID, {
    maxDepth: Math.max(0, Number(options?.descendant_max_depth ?? 6)),
    maxSessions: Math.max(1, Number(options?.descendant_max_sessions ?? 96)),
  })
  return accountMissionUsage(stateDir, sessionID, samples, { expectedMissionID: missionID })
}

function sendPrompt(client, sessionID, text) { return (client.adapter || client).prompt(sessionID, text) }

function normalizePromptResponse(response) {
  if (!response) return null
  if (response.info && Array.isArray(response.parts)) return response
  if (response.message?.info && Array.isArray(response.message?.parts)) return response.message
  return null
}

function commandResultPrompt(action, mission, continueNow = false, extraContext = "") {
  if (continueNow && mission?.status === "active") {
    const blocks = [action, extraContext, continuationPrompt(mission)].filter(Boolean)
    return blocks.join("\n\n")
  }
  return `${action}\n\nRespond with only a concise acknowledgement/status. Do not start unrelated or new Mission work in this control-command turn.`
}

function getConfiguredMaxBudget(options) {
  return options?.max_mission_token_budget ?? null
}

function integerOption(options, name, fallback, minimum) {
  const raw = options?.[name]
  if (raw === undefined || raw === null || raw === "") return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}`)
  }
  return value
}

function normalizeVerificationOptions(value) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error("verification must be an array")
  return value.map((item, index) => {
    const id = String(item?.id || `verification-${index + 1}`).trim()
    const command = String(item?.command || "").trim()
    if (!id || !command) throw new Error("verification entries require non-empty id and command")
    return {
      id,
      command,
      requirementID: item?.requirementID == null ? null : String(item.requirementID).trim(),
      retry: normalizeRetryPolicy(item?.retry),
    }
  })
}

export function normalizePluginOptions(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("Mission plugin options must be an object")
  }
  const commandName = String(options.command_name ?? DEFAULT_COMMAND).trim()
  if (!commandName || /\s/.test(commandName)) throw new Error("command_name must be a non-empty command without whitespace")
  const alias = options.alias === false ? false : String(options.alias ?? DEFAULT_ALIAS).trim()
  if (alias !== false && (!alias || /\s/.test(alias))) throw new Error("alias must be false or a non-empty command without whitespace")
  if (options.auto_continue !== undefined && typeof options.auto_continue !== "boolean") {
    throw new Error("auto_continue must be a boolean")
  }
  if (options.exec_tool_names !== undefined && (
    !Array.isArray(options.exec_tool_names) ||
    options.exec_tool_names.some((name) => typeof name !== "string" || !name.trim())
  )) {
    throw new Error("exec_tool_names must be an array of non-empty strings")
  }
  const maxBudget = integerOption(options, "max_mission_token_budget", null, 1)
  return Object.freeze({
    ...options,
    state_dir: options.state_dir == null ? null : String(options.state_dir),
    worktree: options.worktree == null ? null : String(options.worktree),
    command_name: commandName,
    alias,
    auto_continue: options.auto_continue ?? true,
    max_mission_token_budget: maxBudget,
    min_continue_interval_ms: integerOption(options, "min_continue_interval_ms", 250, 0),
    failed_exec_threshold: integerOption(options, "failed_exec_threshold", 3, 1),
    empty_auto_threshold: integerOption(options, "empty_auto_threshold", 3, 1),
    descendant_max_depth: integerOption(options, "descendant_max_depth", 6, 0),
    descendant_max_sessions: integerOption(options, "descendant_max_sessions", 96, 1),
    scheduler_lease_ms: integerOption(options, "scheduler_lease_ms", 30_000, 1_000),
    max_automatic_turns: integerOption(options, "max_automatic_turns", null, 1),
    max_active_seconds: integerOption(options, "max_active_seconds", null, 1),
    max_no_progress_turns: integerOption(options, "max_no_progress_turns", null, 1),
    verification: normalizeVerificationOptions(options.verification),
    accounting_retry: normalizeRetryPolicy(options.accounting_retry ?? {
      maxAttempts: 3,
      baseDelayMs: 500,
      maxDelayMs: 5000,
    }),
    exec_tool_names: options.exec_tool_names?.map((name) => name.trim()),
  })
}

async function missionDiagnostics(client, stateDir, sessionID) {
  const checks = []
  try {
    const mission = await readMission(stateDir, sessionID)
    if (!mission) {
      checks.push("state: ok (no Mission)")
    } else {
      const lease = mission.schedulerLease
      const leaseState = lease
        ? lease.expiresAtMs <= Date.now() ? `expired (${lease.owner})` : `held (${lease.owner})`
        : "none"
      checks.push(`state: ok (${mission.status}, schema ${mission.version})`)
      checks.push(`scheduler lease: ${leaseState}`)
      checks.push(`accounting: ${mission.accounting.truncated ? "warning, watermark history truncated" : "ok"}`)
    }
  } catch (error) {
    checks.push(`state: error (${error?.message || String(error)})`)
  }
  for (const [label, operation] of [
    ["messages API", () => listMessages(client, sessionID)],
    ["children API", () => listChildren(client, sessionID)],
  ]) {
    try {
      await operation()
      checks.push(`${label}: ok`)
    } catch (error) {
      checks.push(`${label}: error (${error?.message || String(error)})`)
    }
  }
  return `Mission diagnostics\n${checks.map((check) => `- ${check}`).join("\n")}`
}

async function executeVerificationGate($, cwd, stateDir, sessionID, mission, gate) {
  if (typeof $ !== "function") throw new Error("Verification execution is unavailable in this OpenCode runtime.")
  const policy = normalizeRetryPolicy(gate.retry)
  let result
  let attempts = 0
  let lastError = null
  while (attempts < policy.maxAttempts) {
    attempts += 1
    try {
      result = await $.cwd(cwd || process.cwd()).nothrow()`${{ raw: gate.command }}`
      break
    } catch (error) {
      lastError = error
      if (!isRetryableVerificationFailure(error) || attempts >= policy.maxAttempts) throw error
      const delay = Math.min(policy.maxDelayMs, policy.baseDelayMs * (2 ** (attempts - 1)))
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  if (!result && lastError) throw lastError
  const fingerprint = await getWorktreeFingerprint(cwd)
  mission = await refreshMissionEvidence(stateDir, sessionID, fingerprint, mission.missionID) || mission
  const output = String(result?.stdout || result?.stderr || result || "").trim()
  const passed = Number(result?.exitCode ?? result?.exit_code ?? 1) === 0
  const updated = await recordVerificationResult(stateDir, sessionID, gate.id, {
            passed,
            attempts,
            retryableFailure: attempts > 1,
    summary: `${gate.command}: ${passed ? "passed" : "failed"} (attempts: ${attempts})${output ? ` — ${output.slice(0, 700)}` : ""}`,
    fingerprint,
  }, mission.missionID)
  if (!updated) throw new Error("Mission changed concurrently; verification result rejected.")
  return { updated, passed, output }
}

async function getWorktreeFingerprint(cwd) {
  try {
    return await defaultGitAdapter.fingerprint(cwd || process.cwd())
  } catch {
    return null
  }
}

async function handleSlashCommand(client, $, workspaceDirectory, stateDir, sessionID, rawArguments, options) {
  const parsed = parseMissionCommand(rawArguments)
  const maxBudget = getConfiguredMaxBudget(options)
  // Codex uses max_goal_token_budget as both the default and maximum for a newly-created Goal.
  const createOptions = { maxTokenBudget: maxBudget, defaultTokenBudget: maxBudget }
  createOptions.maxAutomaticTurns = options.max_automatic_turns
  createOptions.maxActiveSeconds = options.max_active_seconds
  createOptions.maxNoProgressTurns = options.max_no_progress_turns

  if (parsed.op === "view") {
    const mission = await readMission(stateDir, sessionID)
    if (mission?.status === "active") await deferNextContinuation(stateDir, sessionID, 1, mission.missionID)
    return commandResultPrompt(`Mission control — current state:\n${conciseStatus(mission)}`, mission, false)
  }

  if (parsed.op === "help") {
    const mission = await readMission(stateDir, sessionID)
    if (mission?.status === "active") await deferNextContinuation(stateDir, sessionID, 1, mission.missionID)
    return commandResultPrompt(missionHelp(DEFAULT_COMMAND, DEFAULT_ALIAS), mission, false)
  }

  if (parsed.op === "doctor") {
    return commandResultPrompt(await missionDiagnostics(client, stateDir, sessionID), null, false)
  }

  if (parsed.op === "history" || parsed.op === "explain" || parsed.op === "report") {
    if (parsed.op === "report") return commandResultPrompt(JSON.stringify(await missionReport(stateDir, sessionID), null, 2), null, false)
    const history = await getMissionHistory(stateDir, sessionID)
    const text = parsed.op === "explain"
      ? `Mission decisions\n${history.map((event) => `- #${event.seq} ${event.type}: ${JSON.stringify(event.details)}`).join("\n") || "- no events"}`
      : `Mission history\n${history.map((event) => `- #${event.seq} ${event.type} @ ${new Date(event.atMs).toISOString()}`).join("\n") || "- no events"}`
    return commandResultPrompt(text, null, false)
  }

  if (parsed.op === "verify") {
    let mission = await readMission(stateDir, sessionID)
    if (!mission) throw new Error("No Mission exists for this session.")
    const gates = parsed.verificationID
      ? mission.verification.filter((gate) => gate.id === parsed.verificationID)
      : mission.verification
    if (gates.length === 0) throw new Error(parsed.verificationID
      ? `Unknown Mission verification gate: ${parsed.verificationID}`
      : "No verification gates are configured for this Mission.")
    const results = []
    for (const gate of gates) {
      const result = await executeVerificationGate($, workspaceDirectory, stateDir, sessionID, mission, gate)
      mission = result.updated
      results.push(`${gate.id}: ${result.passed ? "passed" : "failed"}`)
    }
    return commandResultPrompt(`Mission verification\n${results.map((result) => `- ${result}`).join("\n")}`, mission, false)
  }

  if (parsed.op === "checkpoint") {
    const mission = await readMission(stateDir, sessionID)
    if (!mission) throw new Error("No Mission exists for this session.")
    const fingerprint = await getWorktreeFingerprint(workspaceDirectory)
    const result = await addMissionCheckpoint(stateDir, sessionID, {
      fingerprint,
      summary: parsed.summary || "Manual checkpoint",
    }, mission.missionID)
    return commandResultPrompt(`Mission checkpoint created\n${JSON.stringify(result.checkpoints.at(-1), null, 2)}`, result, false)
  }

  if (parsed.op === "set") {
    if (!parsed.objective) throw new Error("Usage: /mission [--budget N] <objective>")
    const baselineSamples = await collectSessionUsage(client.adapter || client, sessionID, {
      maxDepth: Math.max(0, Number(options?.descendant_max_depth ?? 6)),
      maxSessions: Math.max(1, Number(options?.descendant_max_sessions ?? 96)),
    })
    const mission = await createMission(
      stateDir,
      sessionID,
      parsed.objective,
      parsed.tokenBudget,
      { ...createOptions, baselineSamples },
    )
    return commandResultPrompt(`Mission activated.\n${conciseStatus(mission)}`, mission, true)
  }

  if (parsed.op === "edit") {
    if (!parsed.objective) throw new Error("Usage: /mission edit <new objective>")
    const current = await readMission(stateDir, sessionID)
    if (!current) throw new Error("No Mission exists for this session.")
    const mission = await editMission(stateDir, sessionID, parsed.objective, current.missionID)
    if (!mission) throw new Error("Mission changed concurrently; retry the edit.")
    return commandResultPrompt(
      `Mission objective updated.\n${conciseStatus(mission)}`,
      mission,
      mission.status === "active",
      objectiveUpdatedPrompt(mission),
    )
  }

  if (parsed.op === "pause") {
    const current = await readMission(stateDir, sessionID)
    if (!current) throw new Error("No Mission exists for this session.")
    const mission = await pauseMission(
      stateDir,
      sessionID,
      parsed.reason || "Paused by user",
      current.missionID,
    )
    return commandResultPrompt(`Mission paused.\n${conciseStatus(mission)}`, mission, false)
  }

  if (parsed.op === "resume") {
    const current = await readMission(stateDir, sessionID)
    if (!current) throw new Error("No Mission exists for this session.")
    const mission = await resumeMission(stateDir, sessionID, current.missionID)
    if (!mission) throw new Error("Mission changed concurrently; retry resume.")
    return commandResultPrompt(
      mission.status === "active" ? `Mission resumed.\n${conciseStatus(mission)}` : `Mission could not resume.\n${conciseStatus(mission)}`,
      mission,
      mission.status === "active",
      mission.status === "active" ? resumePrompt(mission) : "",
    )
  }

  if (parsed.op === "budget_view") {
    const mission = await readMission(stateDir, sessionID)
    if (!mission) throw new Error("No Mission exists for this session.")
    if (mission.status === "active") await deferNextContinuation(stateDir, sessionID, 1, mission.missionID)
    return commandResultPrompt(`Mission budget — current state:\n${conciseStatus(mission)}`, mission, false)
  }

  if (parsed.op === "budget") {
    const current = await readMission(stateDir, sessionID)
    if (!current) throw new Error("No Mission exists for this session.")
    const mission = await setMissionBudget(stateDir, sessionID, parsed.tokenBudget, {
      maxTokenBudget: maxBudget,
      expectedMissionID: current.missionID,
    })
    if (!mission) throw new Error("Mission changed concurrently; retry budget update.")
    const note = mission.status === "budget_limited"
      ? "Budget changed. The Mission remains budget_limited until /mission resume; resume succeeds only if the new budget exceeds tokens already used."
      : "Mission budget updated."
    return commandResultPrompt(`${note}\n${conciseStatus(mission)}`, mission, false)
  }

  if (parsed.op === "clear") {
    const old = await readMission(stateDir, sessionID)
    await deleteMission(stateDir, sessionID)
    return commandResultPrompt(old ? "Mission cleared." : "No Mission was set.", null, false)
  }

  throw new Error(`Unknown Mission command operation: ${parsed.op}`)
}

async function recordRootTurnOutcomes(stateDir, sessionID, mission, messages, options) {
  let current = mission
  for (const message of messages) {
    const info = message?.info ?? message
    if (info?.role !== "assistant") continue
    const createdAt = Number(info?.time?.created) || 0
    if (createdAt && createdAt < mission.createdAtMs) continue
    current = (await recordMissionTurnOutcome(stateDir, sessionID, message, {
      expectedMissionID: mission.missionID,
      automatic: false,
      failedExecThreshold: Math.max(1, Number(options?.failed_exec_threshold ?? 3)),
      emptyAutomaticThreshold: Math.max(1, Number(options?.empty_auto_threshold ?? 3)),
      execToolNames: Array.isArray(options?.exec_tool_names) ? options.exec_tool_names : undefined,
    })) || current
    if (current.missionID !== mission.missionID || current.status !== "active") break
  }
  return current
}

async function processIdle(scheduler, host, stateDir, sessionID, options) {
  return scheduler.runExclusive(sessionID, async () => {
  let shouldRecheck = false
  let leaseOwner = null
  let leaseMissionID = null
  let expectedMissionID = null
  let accountingPhase = "pre"
  let recheckDelay = Math.max(50, Number(options?.min_continue_interval_ms ?? 250))

  try {
    let mission = await readMission(stateDir, sessionID)
    if (!mission) return
    expectedMissionID = mission.missionID
    mission = await refreshMissionEvidence(stateDir, sessionID, await getWorktreeFingerprint(options.worktree), expectedMissionID) || mission
    leaseOwner = newSchedulerOwnerID()
    const lease = await acquireSchedulerLease(stateDir, sessionID, leaseOwner, {
      expectedMissionID,
      leaseMs: options.scheduler_lease_ms,
    })
    if (!lease?.acquired) {
      if (lease?.leaseExpiresAtMs) {
        shouldRecheck = true
        recheckDelay = Math.max(50, lease.leaseExpiresAtMs - Date.now() + 10)
      }
      return
    }
    leaseMissionID = expectedMissionID
    scheduler.startHeartbeat(sessionID, Math.max(250, Math.floor(options.scheduler_lease_ms / 3)), () => {
      void renewSchedulerLease(stateDir, sessionID, leaseOwner, {
        expectedMissionID,
        leaseMs: options.scheduler_lease_ms,
      }).catch(() => {})
    })

    const rootMessages = await listMessages(host, sessionID)
    mission = (await recordRootTurnOutcomes(stateDir, sessionID, mission, rootMessages, options)) || mission
    if (mission.missionID !== expectedMissionID) return

    mission = (await accountLiveMission(host, stateDir, sessionID, expectedMissionID, options)) || mission
    if (mission.missionID !== expectedMissionID) return
    scheduler.resetRetries(sessionID, "pre")

    if (mission.status === "budget_limited") {
      if (!mission.budgetWrapupSent) {
        accountingPhase = "prompt"
        const response = normalizePromptResponse(await sendPrompt(host, sessionID, budgetLimitPrompt(mission)))
        if (response) {
          scheduler.resetRetries(sessionID, "prompt")
          accountingPhase = "post"
          const marked = await markBudgetWrapupSent(stateDir, sessionID, expectedMissionID)
          if (!marked) return
          await accountLiveMission(host, stateDir, sessionID, expectedMissionID, options)
          await recordMissionTurnOutcome(stateDir, sessionID, response, {
            expectedMissionID,
            automatic: false,
            failedExecThreshold: Math.max(1, Number(options?.failed_exec_threshold ?? 3)),
            emptyAutomaticThreshold: Math.max(1, Number(options?.empty_auto_threshold ?? 3)),
          })
        }
      }
      return
    }

    if (mission.status !== "active") return

    if (await consumeContinuationDeferral(stateDir, sessionID, expectedMissionID)) {
      // Control commands such as /mission status should not start substantive work
      // in their acknowledgement turn, but an active Mission must not become stranded.
      shouldRecheck = true
      recheckDelay = Math.max(50, Number(options?.min_continue_interval_ms ?? 250))
      return
    }

    const minIntervalMs = Math.max(0, Number(options?.min_continue_interval_ms ?? 250))
    if (mission.lastContinuationAtMs) {
      const elapsed = Date.now() - mission.lastContinuationAtMs
      if (elapsed < minIntervalMs) {
        shouldRecheck = true
        recheckDelay = minIntervalMs - elapsed
        return
      }
    }

    mission = await markContinuationStarted(stateDir, sessionID, expectedMissionID, leaseOwner)
    if (!mission) return

    // session.prompt is awaited, so this is one physical OpenCode turn, mirroring
    // Codex start_turn_if_idle rather than asking the same turn to recurse.
    accountingPhase = "prompt"
    const response = normalizePromptResponse(await sendPrompt(host, sessionID, continuationPrompt(mission)))
    if (response) {
      scheduler.resetRetries(sessionID, "prompt")
      accountingPhase = "post"
      mission = (await accountLiveMission(host, stateDir, sessionID, expectedMissionID, options)) || mission
      if (mission.missionID !== expectedMissionID) return
      scheduler.resetRetries(sessionID, "post")
      mission = (await recordMissionTurnOutcome(stateDir, sessionID, response, {
        expectedMissionID,
        automatic: true,
        failedExecThreshold: Math.max(1, Number(options?.failed_exec_threshold ?? 3)),
        emptyAutomaticThreshold: Math.max(1, Number(options?.empty_auto_threshold ?? 3)),
        execToolNames: Array.isArray(options?.exec_tool_names) ? options.exec_tool_names : undefined,
      })) || mission
    }

    shouldRecheck = mission?.missionID === expectedMissionID && mission?.status === "active"
  } catch (error) {
    if (expectedMissionID && isTransientAccountingError(error)) {
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
          expectedMissionID,
        ).catch(() => {})
      }
    } else if (expectedMissionID && error?.code === "ACCOUNTING_TRAVERSAL_INCOMPLETE") {
      scheduler.resetRetries(sessionID)
      await setStoppedStatus(
        stateDir,
        sessionID,
        "paused",
        `Accounting incomplete: ${error.message}`.slice(0, 500),
        expectedMissionID,
      ).catch(() => {})
    }
    await log(host.client, "error", "Mission idle continuation failed", {
      sessionID,
      code: error?.code || null,
      error: String(error?.stack || error),
    })
  } finally {
    scheduler.stopHeartbeat(sessionID)
    if (leaseOwner && leaseMissionID) {
      await releaseSchedulerLease(stateDir, sessionID, leaseOwner, leaseMissionID).catch(() => {})
    }
    if (shouldRecheck) {
      scheduler.scheduleRecheck(sessionID, recheckDelay, () => {
        void processIdle(scheduler, host, stateDir, sessionID, options)
      })
    }
  }
  })
}

function completionResponse(mission) {
  const view = snapshotMission(mission)
  return JSON.stringify({
    ...view,
    completionBudgetReport:
      mission?.status === "complete"
        ? "Mission achieved. In the final response, report token usage when a budget exists and summarize elapsed Mission time when it is non-zero."
        : null,
  }, null, 2)
}

export const MissionPlugin = async ({ client, $, directory }, rawOptions = {}) => {
  const options = normalizePluginOptions(rawOptions)
  const adapter = createOpenCodeAdapter(client)
  const host = { adapter, client }
  const scheduler = new SchedulerState()
  const stateDir = options.state_dir ? String(options.state_dir) : defaultStateDir()
  const commandName = String(options.command_name || DEFAULT_COMMAND)
  const aliasName = options.alias === false ? null : String(options.alias || DEFAULT_ALIAS)
  const autoContinue = options.auto_continue !== false
  const maxBudget = getConfiguredMaxBudget(options)

  await log(client, "info", "OpenCode Mission initialized", {
    stateDir,
    commandName,
    aliasName,
    autoContinue,
    maxMissionTokenBudget: maxBudget,
  })

  return {
    config: async (config) => {
      config.command ??= {}
      config.command[commandName] = {
        template: "$ARGUMENTS",
        description: "Start or control a persistent verified Mission that continues across turns",
      }
      if (aliasName && aliasName !== commandName) {
        config.command[aliasName] = {
          template: "$ARGUMENTS",
          description: `Short alias for /${commandName}`,
        }
      }
    },

    tool: {
      get_mission: tool({
        description:
          "Get the current persistent Mission for this session, including status, objective, token budget, root and descendant token usage, elapsed active time, and remaining token budget.",
        args: {},
        async execute(_args, context) {
          let mission = await readMission(stateDir, context.sessionID)
          if (!mission) return JSON.stringify({ mission: null, remainingTokens: null }, null, 2)
          mission = (await accountLiveMission(host, stateDir, context.sessionID, mission.missionID, options)) || mission
          return publicMissionJSON(mission)
        },
      }),

      create_mission: tool({
        description:
          "Create a persistent Mission only when the user or higher-priority instructions explicitly request Mission mode. Do not infer a Mission from an ordinary task. A new Mission can replace only a completed Mission; an unfinished Mission must be completed or cleared first. Set token_budget only when explicitly requested; the runtime may apply a configured default/maximum.",
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
          const baselineSamples = await collectSessionUsage(host.adapter || host, context.sessionID, {
            maxDepth: Math.max(0, Number(options?.descendant_max_depth ?? 6)),
            maxSessions: Math.max(1, Number(options?.descendant_max_sessions ?? 96)),
          })
          const mission = await createMission(
            stateDir,
            context.sessionID,
            args.objective,
            args.token_budget ?? null,
            { maxTokenBudget: maxBudget, defaultTokenBudget: maxBudget, requirements: args.requirements, verification: options.verification, baselineSamples },
          )
          return publicMissionJSON(mission)
        },
      }),

      update_mission: tool({
        description:
          "Update an existing Mission status. Use complete only after a requirement-by-requirement audit proves the entire objective with authoritative current evidence and no required work remains. Use blocked only when the same genuine blocker has recurred for at least three consecutive Mission turns and meaningful progress is impossible without user input or external-state change. Use paused only at the user's explicit request. This tool cannot resume a Mission or set usage_limited/budget_limited; those transitions belong to the user/runtime.",
        args: {
          status: tool.schema.enum(["complete", "blocked", "paused"]).describe("Required status transition."),
        },
        async execute(args, context) {
          let mission = await readMission(stateDir, context.sessionID)
          if (!mission) throw new Error("No Mission exists for this session.")
          const expectedMissionID = mission.missionID
          mission = await refreshMissionEvidence(stateDir, context.sessionID, await getWorktreeFingerprint(context.worktree), expectedMissionID) || mission

          // Mirror Codex: account the live turn before applying a stopped/completed status.
          mission = (await accountLiveMission(host, stateDir, context.sessionID, expectedMissionID, options)) || mission
          if (mission.missionID !== expectedMissionID) throw new Error("Mission changed concurrently; status update rejected.")

          const reason =
            args.status === "complete"
              ? "Objective achieved and verified"
              : args.status === "blocked"
                ? "Blocked after repeated blocker audit"
                : "Paused by explicit user request"

          mission = await setStoppedStatus(stateDir, context.sessionID, args.status, reason, expectedMissionID)
          if (!mission) throw new Error("Mission changed concurrently; status update rejected.")
          return args.status === "complete" ? completionResponse(mission) : publicMissionJSON(mission)
        },
      }),
      add_mission_evidence: tool({
        description: "Attach concise authoritative evidence to a declared Mission requirement. This does not complete or resume a Mission.",
        args: {
          requirement_id: tool.schema.string().min(1),
          kind: tool.schema.string().min(1).max(100).optional(),
          summary: tool.schema.string().min(1).max(1000),
        },
        async execute(args, context) {
          const mission = await readMission(stateDir, context.sessionID)
          if (!mission) throw new Error("No Mission exists for this session.")
          const updated = await addMissionEvidence(stateDir, context.sessionID, args.requirement_id, {
            kind: args.kind,
            summary: args.summary,
          }, mission.missionID)
          if (!updated) throw new Error("Mission changed concurrently; evidence update rejected.")
          return publicMissionJSON(updated)
        },
      }),
      verify_mission_gate: tool({
        description: "Run a configured Mission verification gate from trusted plugin configuration.",
        args: { verification_id: tool.schema.string().min(1) },
        async execute(args, context) {
          const mission = await readMission(stateDir, context.sessionID)
          const gate = mission?.verification.find((item) => item.id === args.verification_id)
          if (!mission || !gate) throw new Error(`Unknown Mission verification gate: ${args.verification_id}`)
          if (typeof $ !== "function") throw new Error("Verification execution is unavailable in this OpenCode runtime.")
          const result = await executeVerificationGate($, context.directory || directory, stateDir, context.sessionID, mission, gate)
          return publicMissionJSON(result.updated)
        },
      }),
      create_mission_checkpoint: tool({
        description: "Save manual checkpoint metadata for the current Mission without committing or rolling back files.",
        args: { summary: tool.schema.string().min(1).max(1000) },
        async execute(args, context) {
          const mission = await readMission(stateDir, context.sessionID)
          if (!mission) throw new Error("No Mission exists for this session.")
          const result = await addMissionCheckpoint(stateDir, context.sessionID, {
            summary: args.summary,
            fingerprint: await getWorktreeFingerprint(context.worktree || directory),
          }, mission.missionID)
          if (!result) throw new Error("Mission changed concurrently; checkpoint rejected.")
          return publicMissionJSON(result)
        },
      }),
    },

    "tool.execute.after": async (input) => {
      // Cheap root-session accounting at tool boundaries. Full descendant-tree
      // accounting occurs at idle/control boundaries to keep this hook lightweight.
      try {
        const mission = await readMission(stateDir, input.sessionID)
        if (!mission || (mission.status !== "active" && mission.status !== "budget_limited")) return
        const messages = await listMessages(client, input.sessionID)
        await accountMissionUsage(
          stateDir,
          input.sessionID,
          messages.map((message) => ({ sessionID: input.sessionID, message })),
          { expectedMissionID: mission.missionID },
        )
      } catch (error) {
        await log(client, "warn", "Mission tool-boundary accounting failed", {
          sessionID: input.sessionID,
          code: error?.code || "MISSION_ACCOUNTING_FAILED",
          phase: "tool.execute.after",
          error: String(error?.message || error),
        })
      }
    },

    "command.execute.before": async (input, output) => {
      if (input.command !== commandName && input.command !== aliasName) return
      try {
      const prompt = await handleSlashCommand(host, $, directory, stateDir, input.sessionID, input.arguments, options)
        // OpenCode keeps the original parts array; mutate it in place.
        output.parts.splice(0, output.parts.length, { type: "text", text: prompt, synthetic: true })
      } catch (error) {
        output.parts.splice(0, output.parts.length, {
          type: "text",
          text: `Mission command failed: ${error?.message || String(error)}\n\nReport this error concisely and do not modify Mission state further in this turn.`,
          synthetic: true,
        })
      }
    },

    "experimental.chat.system.transform": async (input, output) => {
      if (!input.sessionID) return
      const mission = await readMission(stateDir, input.sessionID)
      const policy = mission && systemMissionPolicy(mission)
      if (policy) output.system.push(policy)
    },

    "experimental.session.compacting": async (input, output) => {
      const mission = await readMission(stateDir, input.sessionID)
      if (mission) output.context.push(compactionMissionContext(mission))
    },

    "experimental.compaction.autocontinue": async (input, output) => {
      const mission = await readMission(stateDir, input.sessionID)
      // Mission owns continuation while active; avoid two independent continuation loops.
      if (mission?.status === "active") output.enabled = false
    },

    event: async ({ event }) => {
      if (event.type === "server.instance.disposed") {
        scheduler.dispose()
        return
      }
      const sessionID = getEventSessionID(event)
      if (!sessionID) return

      if (event.type === "session.deleted") {
        scheduler.disposeSession(sessionID)
        return
      }

      if (event.type === "session.idle" && autoContinue) {
        void processIdle(scheduler, host, stateDir, sessionID, options)
        return
      }

      if (event.type === "session.error") {
        let mission = await readMission(stateDir, sessionID)
        if (!mission || mission.status !== "active") return
        const expectedMissionID = mission.missionID
        const text = eventErrorText(event)
        try {
          mission = (await accountLiveMission(client, stateDir, sessionID, expectedMissionID, options)) || mission
          if (mission.missionID !== expectedMissionID) return

          // Codex allows usage_limited to supersede a just-crossed budget limit,
          // while pause/blocked do not override budget_limited.
          if (isUsageLimitError(text)) {
            await setStoppedStatus(
              stateDir,
              sessionID,
              "usage_limited",
              text.slice(0, 500) || "Usage limit reached",
              expectedMissionID,
            )
          } else if (mission.status === "budget_limited") {
            return
          } else if (isAbortError(text)) {
            // In Codex, user interrupt and Goal pause are coupled; otherwise idle would restart it.
            await setStoppedStatus(stateDir, sessionID, "paused", "Session interrupted/aborted", expectedMissionID)
          } else {
            // Runtime failure is distinct from the model's semantic 3-turn blocker audit.
            await setStoppedStatus(
              stateDir,
              sessionID,
              "blocked",
              text.slice(0, 500) || "Session runtime error",
              expectedMissionID,
            )
          }
        } catch (error) {
          await log(client, "error", "Failed to persist Mission error status", {
            sessionID,
            error: String(error?.stack || error),
          })
        }
      }
    },
  }
}
