export async function applySystemPolicy({ input, output, stateDir, readTarget, systemTargetPolicy }) {
  if (!input.sessionID) return
  const target = await readTarget(stateDir, input.sessionID)
  const policy = target && systemTargetPolicy(target)
  if (policy) output.system.push(policy)
}

export async function applyCompactionContext({ input, output, stateDir, readTarget, compactionTargetContext }) {
  const target = await readTarget(stateDir, input.sessionID)
  if (target) output.context.push(compactionTargetContext(target))
}

export async function disableCompactionAutocontinue({ input, output, stateDir, readTarget }) {
  const target = await readTarget(stateDir, input.sessionID)
  // Target owns continuation while active; avoid two independent continuation loops.
  if (target?.status === "active") output.enabled = false
}
