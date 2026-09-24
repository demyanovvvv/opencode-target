import { isRetryableVerificationFailure, normalizeRetryPolicy } from "./core.js"
import { normalizeVerificationResult } from "./verification.js"

export async function runGateCommand(run, command, policy, { sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  let result
  let attempts = 0
  let lastError = null
  while (attempts < policy.maxAttempts) {
    attempts += 1
    try {
      result = await run(command)
      break
    } catch (error) {
      lastError = error
      if (!isRetryableVerificationFailure(error) || attempts >= policy.maxAttempts) throw error
      const delay = Math.min(policy.maxDelayMs, policy.baseDelayMs * (2 ** (attempts - 1)))
      await sleep(delay)
    }
  }
  if (!result && lastError) throw lastError
  return { result, attempts }
}

export function verificationSummary(gate, verification) {
  const suffix = verification.output ? ` — ${verification.output.slice(0, 700)}` : ""
  return `${gate.command}: ${verification.passed ? "passed" : "failed"} (attempts: ${verification.attempts})${suffix}`
}

export async function executeVerificationGate({
  gate,
  run,
  cwd,
  fingerprint,
  stateDir,
  sessionID,
  target,
  refreshTargetEvidence,
  recordVerificationResult,
  sleep,
}) {
  const policy = normalizeRetryPolicy(gate.retry)
  const { result, attempts } = await runGateCommand((command) => run(command), gate.command, policy, { sleep })
  const observedFingerprint = await fingerprint(cwd)
  target = (await refreshTargetEvidence(stateDir, sessionID, observedFingerprint, target.targetID)) || target
  const verification = normalizeVerificationResult(result, { attempts, retryableFailure: attempts > 1 })
  const updated = await recordVerificationResult(stateDir, sessionID, gate.id, {
    ...verification,
    summary: verificationSummary(gate, verification),
    fingerprint: observedFingerprint,
  }, target.targetID)
  if (!updated) throw new Error("Target changed concurrently; verification result rejected.")
  return { updated, passed: verification.passed, output: verification.output }
}
