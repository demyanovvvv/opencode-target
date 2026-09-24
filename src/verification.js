export function normalizeVerificationResult(result, { attempts = 1, retryableFailure = attempts > 1 } = {}) {
  const exitCode = Number(result?.exitCode ?? result?.exit_code ?? 1)
  const passed = exitCode === 0
  const output = String(result?.stdout || result?.stderr || result || "").trim()
  return {
    passed,
    attempts: Math.max(1, Number(attempts) || 1),
    retryableFailure: Boolean(retryableFailure),
    output,
    errorKind: passed ? null : "exit_code",
  }
}
