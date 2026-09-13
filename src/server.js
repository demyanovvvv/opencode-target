import { tool } from "@opencode-ai/plugin"
import {
  accountMissionUsage,
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
  objectiveUpdatedPrompt,
  parseMissionCommand,
  pauseMission,
  publicMissionJSON,
  readMission,
  recordMissionTurnOutcome,
  resumeMission,
  resumePrompt,
  seedMissionUsageBaselines,
  setMissionBudget,
  setStoppedStatus,
  snapshotMission,
  systemMissionPolicy,
  consumeContinuationDeferral,
} from "./core.js"

const PLUGIN_ID = "opencode-mission"
const DEFAULT_COMMAND = "mission"
const DEFAULT_ALIAS = "msn"
const continuationInFlight = new Set()
const continuationRechecks = new Map()

function unwrapData(value) {
  return value?.data ?? value
}

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

async function log(client, level, message, extra = undefined) {
  try {
    await client.app.log({
      body: { service: PLUGIN_ID, level, message, ...(extra ? { extra } : {}) },
    })
  } catch {
    // Logging must never affect Mission execution.
  }
}

async function listMessages(client, sessionID) {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const data = unwrapData(response)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

async function listChildren(client, sessionID) {
  try {
    const response = await client.session.children({ path: { id: sessionID } })
    const data = unwrapData(response)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/**
 * OpenCode exposes parent/child sessions rather than Codex's internal descendant
 * token accumulator. We reconstruct the same budget semantics by traversing the
 * session tree and accounting assistant-message deltas under the root Mission.
 */
async function collectUsageSamples(
  client,
  rootSessionID,
  { maxDepth = 6, maxSessions = 96 } = {},
) {
  const samples = []
  const queue = [{ id: rootSessionID, depth: 0 }]
  const seen = new Set()

  while (queue.length > 0 && seen.size < maxSessions) {
    const current = queue.shift()
    if (!current?.id || seen.has(current.id)) continue
    seen.add(current.id)

    const messages = await listMessages(client, current.id)
    for (const message of messages) {
      samples.push({
        sessionID: current.id,
        message,
        descendant: current.id !== rootSessionID,
      })
    }

    if (current.depth >= maxDepth) continue
    const children = await listChildren(client, current.id)
    for (const child of children) {
      const id = child?.id || child?.sessionID || child?.sessionId
      if (id && !seen.has(String(id))) queue.push({ id: String(id), depth: current.depth + 1 })
    }
  }

  return samples
}

async function accountLiveMission(client, stateDir, sessionID, missionID, options) {
  const samples = await collectUsageSamples(client, sessionID, {
    maxDepth: Math.max(0, Number(options?.descendant_max_depth ?? 6)),
    maxSessions: Math.max(1, Number(options?.descendant_max_sessions ?? 96)),
  })
  return accountMissionUsage(stateDir, sessionID, samples, { expectedMissionID: missionID })
}

async function sendPrompt(client, sessionID, text) {
  const response = await client.session.prompt({
    path: { id: sessionID },
    body: {
      parts: [{ type: "text", text, synthetic: true, metadata: { source: "opencode-mission" } }],
    },
  })
  return unwrapData(response)
}

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
  const raw = options?.max_mission_token_budget
  if (raw === undefined || raw === null || raw === "") return null
  const n = Number(raw)
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error("max_mission_token_budget must be a positive integer")
  return n
}

async function handleSlashCommand(client, stateDir, sessionID, rawArguments, options) {
  const parsed = parseMissionCommand(rawArguments)
  const maxBudget = getConfiguredMaxBudget(options)
  // Codex uses max_goal_token_budget as both the default and maximum for a newly-created Goal.
  const createOptions = { maxTokenBudget: maxBudget, defaultTokenBudget: maxBudget }

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

  if (parsed.op === "set") {
    if (!parsed.objective) throw new Error("Usage: /mission [--budget N] <objective>")
    let mission = await createMission(
      stateDir,
      sessionID,
      parsed.objective,
      parsed.tokenBudget,
      createOptions,
    )
    const baselineSamples = await collectUsageSamples(client, sessionID, {
      maxDepth: Math.max(0, Number(options?.descendant_max_depth ?? 6)),
      maxSessions: Math.max(1, Number(options?.descendant_max_sessions ?? 96)),
    })
    mission = (await seedMissionUsageBaselines(stateDir, sessionID, baselineSamples, {
      expectedMissionID: mission.missionID,
    })) || mission
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

function clearScheduledRecheck(sessionID) {
  const timer = continuationRechecks.get(sessionID)
  if (timer) clearTimeout(timer)
  continuationRechecks.delete(sessionID)
}

function scheduleRecheck(client, stateDir, sessionID, options, delayMs) {
  clearScheduledRecheck(sessionID)
  const timer = setTimeout(() => {
    continuationRechecks.delete(sessionID)
    void processIdle(client, stateDir, sessionID, options)
  }, Math.max(0, delayMs))
  continuationRechecks.set(sessionID, timer)
}

async function processIdle(client, stateDir, sessionID, options) {
  if (continuationInFlight.has(sessionID)) return
  continuationInFlight.add(sessionID)

  let shouldRecheck = false
  let recheckDelay = Math.max(50, Number(options?.min_continue_interval_ms ?? 250))

  try {
    let mission = await readMission(stateDir, sessionID)
    if (!mission) return
    const expectedMissionID = mission.missionID

    const rootMessages = await listMessages(client, sessionID)
    mission = (await recordRootTurnOutcomes(stateDir, sessionID, mission, rootMessages, options)) || mission
    if (mission.missionID !== expectedMissionID) return

    mission = (await accountLiveMission(client, stateDir, sessionID, expectedMissionID, options)) || mission
    if (mission.missionID !== expectedMissionID) return

    if (mission.status === "budget_limited") {
      if (!mission.budgetWrapupSent) {
        const marked = await markBudgetWrapupSent(stateDir, sessionID, expectedMissionID)
        if (marked) {
          const response = normalizePromptResponse(await sendPrompt(client, sessionID, budgetLimitPrompt(marked)))
          if (response) {
            await accountLiveMission(client, stateDir, sessionID, expectedMissionID, options)
            await recordMissionTurnOutcome(stateDir, sessionID, response, {
              expectedMissionID,
              automatic: false,
              failedExecThreshold: Math.max(1, Number(options?.failed_exec_threshold ?? 3)),
              emptyAutomaticThreshold: Math.max(1, Number(options?.empty_auto_threshold ?? 3)),
            })
          }
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

    mission = await markContinuationStarted(stateDir, sessionID, expectedMissionID)
    if (!mission) return

    // session.prompt is awaited, so this is one physical OpenCode turn, mirroring
    // Codex start_turn_if_idle rather than asking the same turn to recurse.
    const response = normalizePromptResponse(await sendPrompt(client, sessionID, continuationPrompt(mission)))
    if (response) {
      mission = (await accountLiveMission(client, stateDir, sessionID, expectedMissionID, options)) || mission
      if (mission.missionID !== expectedMissionID) return
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
    await log(client, "error", "Mission idle continuation failed", {
      sessionID,
      error: String(error?.stack || error),
    })
  } finally {
    continuationInFlight.delete(sessionID)
    if (shouldRecheck) scheduleRecheck(client, stateDir, sessionID, options, recheckDelay)
  }
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

export const MissionPlugin = async ({ client }, options = {}) => {
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
          mission = (await accountLiveMission(client, stateDir, context.sessionID, mission.missionID, options)) || mission
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
        },
        async execute(args, context) {
          let mission = await createMission(
            stateDir,
            context.sessionID,
            args.objective,
            args.token_budget ?? null,
            { maxTokenBudget: maxBudget, defaultTokenBudget: maxBudget },
          )
          const baselineSamples = await collectUsageSamples(client, context.sessionID, {
            maxDepth: Math.max(0, Number(options?.descendant_max_depth ?? 6)),
            maxSessions: Math.max(1, Number(options?.descendant_max_sessions ?? 96)),
          })
          mission = (await seedMissionUsageBaselines(stateDir, context.sessionID, baselineSamples, {
            expectedMissionID: mission.missionID,
          })) || mission
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

          // Mirror Codex: account the live turn before applying a stopped/completed status.
          mission = (await accountLiveMission(client, stateDir, context.sessionID, expectedMissionID, options)) || mission
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
          error: String(error?.message || error),
        })
      }
    },

    "command.execute.before": async (input, output) => {
      if (input.command !== commandName && input.command !== aliasName) return
      try {
        const prompt = await handleSlashCommand(client, stateDir, input.sessionID, input.arguments, options)
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
      const sessionID = getEventSessionID(event)
      if (!sessionID) return

      if (event.type === "session.idle" && autoContinue) {
        void processIdle(client, stateDir, sessionID, options)
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

