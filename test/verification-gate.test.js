import assert from "node:assert/strict"
import test from "node:test"
import { executeVerificationGate, runGateCommand, verificationSummary } from "../src/verification-gate.js"

test("runGateCommand retries transient failures with backoff then succeeds", async () => {
  const delays = []
  let calls = 0
  const outcome = await runGateCommand(
    async () => {
      calls += 1
      if (calls < 3) {
        const error = new Error("connection reset")
        error.code = "ECONNRESET"
        throw error
      }
      return { exitCode: 0, stdout: "ok" }
    },
    "npm test",
    { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 5000 },
    { sleep: async (ms) => delays.push(ms) },
  )
  assert.equal(calls, 3)
  assert.equal(outcome.attempts, 3)
  assert.deepEqual(delays, [100, 200])
  assert.deepEqual(outcome.result, { exitCode: 0, stdout: "ok" })
})

test("runGateCommand does not retry non-retryable failures", async () => {
  let calls = 0
  await assert.rejects(
    () => runGateCommand(async () => { calls += 1; throw new Error("syntax error") }, "cmd", { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 1 }),
    /syntax error/,
  )
  assert.equal(calls, 1)
})

test("runGateCommand gives up after maxAttempts on persistent transient failures", async () => {
  let calls = 0
  await assert.rejects(
    () => runGateCommand(async () => { calls += 1; const e = new Error("timed out"); e.code = "ETIMEDOUT"; throw e }, "cmd", { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 1 }, { sleep: async () => {} }),
    /timed out/,
  )
  assert.equal(calls, 2)
})

test("verificationSummary reports command, status, attempts, and bounded output", () => {
  assert.equal(
    verificationSummary({ command: "npm test" }, { passed: true, attempts: 1, output: "" }),
    "npm test: passed (attempts: 1)",
  )
  const long = "x".repeat(900)
  const summary = verificationSummary({ command: "go test" }, { passed: false, attempts: 2, output: long })
  assert.match(summary, /^go test: failed \(attempts: 2\) — x+$/)
  assert.equal(summary.length, "go test: failed (attempts: 2) — ".length + 700)
})

test("executeVerificationGate records a normalized result against the refreshed target", async () => {
  const recorded = []
  const refreshed = { targetID: "t1" }
  const outcome = await executeVerificationGate({
    gate: { id: "g1", command: "npm test", retry: { maxAttempts: 1 } },
    run: async () => ({ exitCode: 0, stdout: "all good" }),
    cwd: "/work",
    fingerprint: async () => "fp",
    stateDir: "dir",
    sessionID: "s",
    target: { targetID: "t1" },
    refreshTargetEvidence: async (stateDir, sessionID, fingerprint, targetID) => {
      assert.deepEqual([stateDir, sessionID, fingerprint, targetID], ["dir", "s", "fp", "t1"])
      return refreshed
    },
    recordVerificationResult: async (...args) => {
      recorded.push(args)
      return { targetID: "t1", status: "active" }
    },
  })
  assert.equal(outcome.passed, true)
  assert.equal(outcome.output, "all good")
  assert.equal(recorded.length, 1)
  const [stateDir, sessionID, gateID, payload, targetID] = recorded[0]
  assert.deepEqual([stateDir, sessionID, gateID, targetID], ["dir", "s", "g1", "t1"])
  assert.equal(payload.passed, true)
  assert.equal(payload.attempts, 1)
  assert.equal(payload.errorKind, null)
  assert.equal(payload.fingerprint, "fp")
  assert.equal(payload.summary, "npm test: passed (attempts: 1) — all good")
})

test("executeVerificationGate rejects stale writes when the target changed", async () => {
  await assert.rejects(
    () => executeVerificationGate({
      gate: { id: "g1", command: "npm test", retry: {} },
      run: async () => ({ exitCode: 1, stderr: "boom" }),
      cwd: "/work",
      fingerprint: async () => "fp",
      stateDir: "dir",
      sessionID: "s",
      target: { targetID: "t1" },
      refreshTargetEvidence: async () => ({ targetID: "t1" }),
      recordVerificationResult: async () => null,
    }),
    /Target changed concurrently/,
  )
})
