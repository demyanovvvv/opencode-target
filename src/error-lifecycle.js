import { eventErrorText, isAbortError, isUsageLimitError } from "./errors.js"

export function resolveErrorStatus(text, targetStatus) {
  // Codex allows usage_limited to supersede a just-crossed budget limit,
  // while pause/blocked do not override budget_limited.
  if (isUsageLimitError(text)) return "usage_limited"
  if (targetStatus === "budget_limited") return null
  if (isAbortError(text)) return "paused"
  return "blocked"
}

export function errorStopReason(status, text) {
  if (status === "usage_limited") return text.slice(0, 500) || "Usage limit reached"
  if (status === "paused") return "Session interrupted/aborted"
  return text.slice(0, 500) || "Session runtime error"
}

export async function handleSessionError(event, { stateDir, sessionID, options, readTarget, accountLiveTarget, setStoppedStatus, log }) {
  const target = await readTarget(stateDir, sessionID)
  if (!target || target.status !== "active") return null
  const expectedTargetID = target.targetID
  const text = eventErrorText(event)
  const status = resolveErrorStatus(text, target.status)
  if (status === null) return null
  if (status === "paused") {
    // Interrupts are control-plane operations: persist before any host API wait.
    const stopped = await setStoppedStatus(stateDir, sessionID, status, errorStopReason(status, text), expectedTargetID)
    if (stopped) void Promise.resolve().then(() => accountLiveTarget(stateDir, sessionID, expectedTargetID, options)).catch(() => {})
    return stopped
  }
  const accounted = await accountLiveTarget(stateDir, sessionID, expectedTargetID, options)
  if (accounted && accounted.targetID !== expectedTargetID) return null
  const activeStatus = accounted?.status ?? target.status
  const resolved = resolveErrorStatus(text, activeStatus)
  if (resolved === null) return null
  return setStoppedStatus(stateDir, sessionID, resolved, errorStopReason(resolved, text), expectedTargetID)
}
