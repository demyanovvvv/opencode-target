import assert from "node:assert/strict"
import test from "node:test"
import { runContinuationPhases } from "../src/continuation.js"

function baseOperations(overrides = {}) {
  return {
    listMessages: async () => [],
    recordTargetTurnOutcome: async (_stateDir, _sessionID, _message, { expectedTargetID }) => ({
      targetID: expectedTargetID,
      status: "complete",
    }),
    accountLiveTarget: async (_host, _stateDir, _sessionID, expectedTargetID) => ({
      targetID: expectedTargetID,
      status: "active",
      lastContinuationAtMs: null,
    }),
    sendPrompt: async () => ({ info: { id: "assistant" }, parts: [] }),
    continuationPrompt: () => "continue",
    budgetLimitPrompt: () => "wrap up",
    markBudgetWrapupSent: async () => true,
    consumeContinuationDeferral: async () => false,
    markContinuationStarted: async (_stateDir, _sessionID, expectedTargetID) => ({
      targetID: expectedTargetID,
      status: "active",
      lastContinuationAtMs: Date.now(),
    }),
    ...overrides,
  }
}

test("runContinuationPhases returns a typed stop decision after a completed turn", async () => {
  const calls = []
  const result = await runContinuationPhases({
    scheduler: { resetRetries: (...args) => calls.push(args) },
    host: {},
    stateDir: "state",
    sessionID: "session",
    options: { min_continue_interval_ms: 0 },
    target: { targetID: "target", status: "active", lastContinuationAtMs: null },
    expectedTargetID: "target",
    leaseOwner: "owner",
    phaseContext: { value: "pre" },
    operations: baseOperations(),
  })

  assert.equal(result.decision, "stop")
  assert.equal(result.target.status, "complete")
  assert.equal(result.phase, "post")
  assert.deepEqual(calls.map(([sessionID, scope]) => `${sessionID}:${scope}`), ["session:pre", "session:prompt", "session:post"])
})

test("runContinuationPhases returns a recheck decision for a deferred continuation", async () => {
  const result = await runContinuationPhases({
    scheduler: { resetRetries() {} },
    host: {},
    stateDir: "state",
    sessionID: "session",
    options: { min_continue_interval_ms: 200 },
    target: { targetID: "target", status: "active", lastContinuationAtMs: null },
    expectedTargetID: "target",
    leaseOwner: "owner",
    phaseContext: { value: "pre" },
    operations: baseOperations({ consumeContinuationDeferral: async () => true }),
  })

  assert.equal(result.decision, "recheck")
  assert.equal(result.recheckDelay, 200)
  assert.equal(result.phase, "pre")
})
