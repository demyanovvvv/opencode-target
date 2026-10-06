const ACCOUNTABLE_STATUSES = new Set(["active", "budget_limited"])

export function rootMessageSamples(sessionID, messages) {
  return messages.map((message) => ({ sessionID, message }))
}

export function isAccountableTarget(target) {
  return Boolean(target && ACCOUNTABLE_STATUSES.has(target.status))
}

export async function accountToolBoundary({ stateDir, sessionID, readTarget, listMessages, accountTargetUsage, incrementalMessages }) {
  const target = await readTarget(stateDir, sessionID)
  if (!isAccountableTarget(target)) return null
  const messages = incrementalMessages ?? await listMessages(sessionID)
  return accountTargetUsage(
    stateDir,
    sessionID,
    rootMessageSamples(sessionID, messages),
    { expectedTargetID: target.targetID },
  )
}
