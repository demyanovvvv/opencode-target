import {
  addTargetCheckpoint,
  conciseStatus,
  continuationPrompt,
  createTarget,
  deferNextContinuation,
  deleteTarget,
  editTarget,
  getTargetHistory,
  objectiveUpdatedPrompt,
  parseTargetCommand,
  pauseTarget,
  readTarget,
  resumePrompt,
  resumeTarget,
  setTargetBudget,
  targetHelp,
  targetReport,
} from "./core.js"
import { ContextSettings, contextStatus, parseContextCommand } from "./context.js"

function commandResultPrompt(action, target, continueNow = false, extraContext = "") {
  if (continueNow && target?.status === "active") {
    const blocks = [action, extraContext, continuationPrompt(target)].filter(Boolean)
    return blocks.join("\n\n")
  }
  return `${action}\n\nRespond with only a concise acknowledgement/status. Do not start unrelated or new Target work in this control-command turn.`
}

function getConfiguredMaxBudget(options) {
  return options?.max_target_token_budget ?? null
}

export async function handleSlashCommand(host, $, workspaceDirectory, stateDir, sessionID, rawArguments, options, dependencies) {
  const {
    collectSessionUsage,
    getWorktreeFingerprint,
    targetDiagnostics,
    executeVerificationGate,
  } = dependencies
  const client = host.adapter || host
  const parsed = parseTargetCommand(rawArguments)
  const commandName = options.command_name || "target"
  const aliasName = options.alias === false ? null : (options.alias || "t")
  const maxBudget = getConfiguredMaxBudget(options)
  const createOptions = {
    maxTokenBudget: maxBudget,
    defaultTokenBudget: maxBudget,
    maxAutomaticTurns: options.max_automatic_turns,
    maxActiveSeconds: options.max_active_seconds,
    maxNoProgressTurns: options.max_no_progress_turns,
  }

  if (parsed.op === "context") {
    const command = parseContextCommand(parsed.arguments)
    const settings = dependencies.contextSettings ?? new ContextSettings(stateDir)
    const record = await settings.command(sessionID, command)
    const target = await readTarget(stateDir, sessionID)
    if (target?.status === "active") await deferNextContinuation(stateDir, sessionID, 1, target.targetID)
    const text = command.scope === "session" && dependencies.contextStatus
      ? await dependencies.contextStatus(sessionID)
      : contextStatus(record, { scope: command.scope, active: target?.status === "active" })
    return commandResultPrompt(text, target, false)
  }

  if (parsed.op === "view") {
    const target = await readTarget(stateDir, sessionID)
    if (target?.status === "active") await deferNextContinuation(stateDir, sessionID, 1, target.targetID)
    const context = dependencies.contextStatus ? `\n\n${await dependencies.contextStatus(sessionID)}` : ""
    return commandResultPrompt(`Target control — current state:\n${conciseStatus(target)}${context}`, target, false)
  }

  if (parsed.op === "help") {
    const target = await readTarget(stateDir, sessionID)
    if (target?.status === "active") await deferNextContinuation(stateDir, sessionID, 1, target.targetID)
    return commandResultPrompt(targetHelp(commandName, aliasName), target, false)
  }

  if (parsed.op === "doctor") {
    const context = dependencies.contextStatus ? `\n\n${await dependencies.contextStatus(sessionID)}` : ""
    return commandResultPrompt(`${await targetDiagnostics(client, stateDir, sessionID)}${context}`, null, false)
  }

  if (parsed.op === "history" || parsed.op === "explain" || parsed.op === "report") {
    if (parsed.op === "report") return commandResultPrompt(JSON.stringify(await targetReport(stateDir, sessionID), null, 2), null, false)
    const history = await getTargetHistory(stateDir, sessionID)
    const text = parsed.op === "explain"
      ? `Target decisions\n${history.map((event) => `- #${event.seq} ${event.type}: ${JSON.stringify(event.details)}`).join("\n") || "- no events"}`
      : `Target history\n${history.map((event) => `- #${event.seq} ${event.type} @ ${new Date(event.atMs).toISOString()}`).join("\n") || "- no events"}`
    return commandResultPrompt(text, null, false)
  }

  if (parsed.op === "verify") {
    let target = await readTarget(stateDir, sessionID)
    if (!target) throw new Error("No Target exists for this session.")
    const gates = parsed.verificationID
      ? target.verification.filter((gate) => gate.id === parsed.verificationID)
      : target.verification
    if (gates.length === 0) throw new Error(parsed.verificationID
      ? `Unknown Target verification gate: ${parsed.verificationID}`
      : "No verification gates are configured for this Target.")
    const results = []
    for (const gate of gates) {
      const result = await executeVerificationGate($, workspaceDirectory, stateDir, sessionID, target, gate)
      target = result.updated
      results.push(`${gate.id}: ${result.passed ? "passed" : "failed"}`)
    }
    return commandResultPrompt(`Target verification\n${results.map((result) => `- ${result}`).join("\n")}`, target, false)
  }

  if (parsed.op === "checkpoint") {
    const target = await readTarget(stateDir, sessionID)
    if (!target) throw new Error("No Target exists for this session.")
    const fingerprint = await getWorktreeFingerprint(workspaceDirectory)
    const result = await addTargetCheckpoint(stateDir, sessionID, {
      fingerprint,
      summary: parsed.summary || "Manual checkpoint",
    }, target.targetID)
    return commandResultPrompt(`Target checkpoint created\n${JSON.stringify(result.checkpoints.at(-1), null, 2)}`, result, false)
  }

  if (parsed.op === "set") {
    if (!parsed.objective) throw new Error("Usage: /target [--budget N] <objective>")
    const baselineSamples = await collectSessionUsage(client, sessionID, {
      maxDepth: Math.max(0, Number(options?.descendant_max_depth ?? 6)),
      maxSessions: Math.max(1, Number(options?.descendant_max_sessions ?? 96)),
    })
    await (dependencies.contextSettings ?? new ContextSettings(stateDir)).session(sessionID)
    const target = await createTarget(stateDir, sessionID, parsed.objective, parsed.tokenBudget, {
      ...createOptions,
      baselineSamples,
    })
    return commandResultPrompt(`Target activated.\n${conciseStatus(target)}`, target, true)
  }

  if (parsed.op === "edit") {
    if (!parsed.objective) throw new Error("Usage: /target edit <new objective>")
    const current = await readTarget(stateDir, sessionID)
    if (!current) throw new Error("No Target exists for this session.")
    const target = await editTarget(stateDir, sessionID, parsed.objective, current.targetID)
    if (!target) throw new Error("Target changed concurrently; retry the edit.")
    return commandResultPrompt(`Target objective updated.\n${conciseStatus(target)}`, target, target.status === "active", objectiveUpdatedPrompt(target))
  }

  if (parsed.op === "pause") {
    const current = await readTarget(stateDir, sessionID)
    if (!current) throw new Error("No Target exists for this session.")
    const target = await pauseTarget(stateDir, sessionID, parsed.reason || "Paused by user", current.targetID)
    return commandResultPrompt(`Target paused.\n${conciseStatus(target)}`, target, false)
  }

  if (parsed.op === "resume") {
    const current = await readTarget(stateDir, sessionID)
    if (!current) throw new Error("No Target exists for this session.")
    const target = await resumeTarget(stateDir, sessionID, current.targetID)
    if (!target) throw new Error("Target changed concurrently; retry resume.")
    return commandResultPrompt(
      target.status === "active" ? `Target resumed.\n${conciseStatus(target)}` : `Target could not resume.\n${conciseStatus(target)}`,
      target,
      target.status === "active",
      target.status === "active" ? resumePrompt(target) : "",
    )
  }

  if (parsed.op === "budget_view") {
    const target = await readTarget(stateDir, sessionID)
    if (!target) throw new Error("No Target exists for this session.")
    if (target.status === "active") await deferNextContinuation(stateDir, sessionID, 1, target.targetID)
    return commandResultPrompt(`Target budget — current state:\n${conciseStatus(target)}`, target, false)
  }

  if (parsed.op === "budget") {
    const current = await readTarget(stateDir, sessionID)
    if (!current) throw new Error("No Target exists for this session.")
    const target = await setTargetBudget(stateDir, sessionID, parsed.tokenBudget, {
      maxTokenBudget: maxBudget,
      expectedTargetID: current.targetID,
    })
    if (!target) throw new Error("Target changed concurrently; retry budget update.")
    const note = target.status === "budget_limited"
      ? "Budget changed. The Target remains budget_limited until /target resume; resume succeeds only if the new budget exceeds tokens already used."
      : "Target budget updated."
    return commandResultPrompt(`${note}\n${conciseStatus(target)}`, target, false)
  }

  if (parsed.op === "clear") {
    const old = await readTarget(stateDir, sessionID)
    await deleteTarget(stateDir, sessionID)
    return commandResultPrompt(old ? "Target cleared." : "No Target was set.", null, false)
  }

  throw new Error(`Unknown Target command operation: ${parsed.op}`)
}
