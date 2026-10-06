function sameTarget(target, expectedTargetID) {
  return target?.targetID === expectedTargetID
}

function result(target, phase, decision, recheckDelay, error = null, awaitingIdle = false) {
  return { target, phase, decision, recheckDelay, error, awaitingIdle }
}

export async function runContinuationPhases({
  scheduler,
  host,
  stateDir,
  sessionID,
  options = {},
  target,
  expectedTargetID,
  leaseOwner,
  phaseContext = { value: "pre" },
  operations,
}) {
  const {
    listMessages,
    recordTargetTurnOutcome,
    recordTargetTurnOutcomes,
    accountLiveTarget,
    sendPrompt,
    sendPromptAsync,
    continuationPrompt,
    budgetLimitPrompt,
    markBudgetWrapupSent,
    consumeContinuationDeferral,
    markContinuationStarted,
  } = operations
  phaseContext.value = "pre"
  const defaultDelay = Math.max(50, Number(options.min_continue_interval_ms ?? 250))
  let recheckDelay = defaultDelay

  const rootMessages = await listMessages(host, sessionID)
  const newMessages = []
  for (const message of rootMessages) {
    const info = message?.info ?? message
    if (info?.role !== "assistant") continue
    const createdAt = Number(info?.time?.created) || 0
    if (createdAt && createdAt < target.createdAtMs) continue
    if (info?.time && !info.time.completed) continue
    if (target.runtime?.evaluatedAssistantMessageIDs?.includes(info.id)) continue
    if (Number(info?.time?.completed) < (target.runtime?.evaluatedThroughMs || 0)) continue
    if (recordTargetTurnOutcomes) { newMessages.push(message); continue }
    target = (await recordTargetTurnOutcome(stateDir, sessionID, message, {
      expectedTargetID,
      automatic: false,
      failedExecThreshold: Math.max(1, Number(options.failed_exec_threshold ?? 3)),
      emptyAutomaticThreshold: Math.max(1, Number(options.empty_auto_threshold ?? 3)),
      execToolNames: Array.isArray(options.exec_tool_names) ? options.exec_tool_names : undefined,
    })) || target
    if (!sameTarget(target, expectedTargetID)) {
      return result(target, phaseContext.value, "stop", recheckDelay)
    }
    if (target.status !== "active" && target.status !== "budget_limited") {
      return result(target, phaseContext.value, "stop", recheckDelay)
    }
  }
  if (recordTargetTurnOutcomes && newMessages.length) {
    target = (await recordTargetTurnOutcomes(stateDir, sessionID, newMessages, {
      expectedTargetID,
      failedExecThreshold: options.failed_exec_threshold ?? 3,
      emptyAutomaticThreshold: options.empty_auto_threshold ?? 3,
      execToolNames: options.exec_tool_names,
    })) || target
    if (!sameTarget(target, expectedTargetID) || !["active", "budget_limited"].includes(target.status)) return result(target, phaseContext.value, "stop", recheckDelay)
  }

  target = (await accountLiveTarget(host, stateDir, sessionID, expectedTargetID, options, rootMessages)) || target
  if (!sameTarget(target, expectedTargetID)) return result(target, phaseContext.value, "stop", recheckDelay)
  scheduler.resetRetries(sessionID, "pre")

  if (target.status === "budget_limited") {
    if (!target.budgetWrapupSent) {
      phaseContext.value = "prompt"
      const response = await sendPrompt(host, sessionID, budgetLimitPrompt(target))
      if (response) {
        scheduler.resetRetries(sessionID, "prompt")
        phaseContext.value = "post"
        const marked = await markBudgetWrapupSent(stateDir, sessionID, expectedTargetID)
        if (!marked) return result(target, phaseContext.value, "stop", recheckDelay)
        await accountLiveTarget(host, stateDir, sessionID, expectedTargetID, options)
        await recordTargetTurnOutcome(stateDir, sessionID, response, {
          expectedTargetID,
          automatic: false,
          failedExecThreshold: Math.max(1, Number(options.failed_exec_threshold ?? 3)),
          emptyAutomaticThreshold: Math.max(1, Number(options.empty_auto_threshold ?? 3)),
        })
      }
    }
    return result(target, phaseContext.value, "stop", recheckDelay)
  }

  if (target.status !== "active") return result(target, phaseContext.value, "stop", recheckDelay)

  if (await consumeContinuationDeferral(stateDir, sessionID, expectedTargetID)) {
    return result(target, phaseContext.value, "recheck", recheckDelay)
  }

  const minIntervalMs = Math.max(0, Number(options.min_continue_interval_ms ?? 250))
  if (target.lastContinuationAtMs) {
    const elapsed = Date.now() - target.lastContinuationAtMs
    if (elapsed < minIntervalMs) {
      recheckDelay = minIntervalMs - elapsed
      return result(target, phaseContext.value, "recheck", recheckDelay)
    }
  }

  target = await markContinuationStarted(stateDir, sessionID, expectedTargetID, leaseOwner)
  if (!target) return result(target, phaseContext.value, "stop", recheckDelay)

  phaseContext.value = "prompt"
  if (sendPromptAsync) {
    await sendPromptAsync(host, sessionID, continuationPrompt(target))
    scheduler.resetRetries(sessionID, "prompt")
    return result(target, phaseContext.value, "stop", recheckDelay, null, true)
  }

  const response = await sendPrompt(host, sessionID, continuationPrompt(target))
  if (response) {
    scheduler.resetRetries(sessionID, "prompt")
    phaseContext.value = "post"
    target = (await accountLiveTarget(host, stateDir, sessionID, expectedTargetID, options)) || target
    if (!sameTarget(target, expectedTargetID)) return result(target, phaseContext.value, "stop", recheckDelay)
    scheduler.resetRetries(sessionID, "post")
    target = (await recordTargetTurnOutcome(stateDir, sessionID, response, {
      expectedTargetID,
      automatic: true,
      failedExecThreshold: Math.max(1, Number(options.failed_exec_threshold ?? 3)),
      emptyAutomaticThreshold: Math.max(1, Number(options.empty_auto_threshold ?? 3)),
      execToolNames: Array.isArray(options.exec_tool_names) ? options.exec_tool_names : undefined,
    })) || target
  }

  return result(
    target,
    phaseContext.value,
    sameTarget(target, expectedTargetID) && target.status === "active" ? "recheck" : "stop",
    recheckDelay,
  )
}
