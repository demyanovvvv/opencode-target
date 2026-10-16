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

test("a pending compaction gates continuation before it is marked or dispatched", async () => {
  let prompts = 0
  const result = await runContinuationPhases({
    scheduler: { resetRetries() {} }, host: {}, stateDir: "s", sessionID: "s",
    target: { targetID: "t", status: "active" }, expectedTargetID: "t", leaseOwner: "owner",
    operations: baseOperations({
      checkContext: async (_id, options) => { assert.equal(options.leaseOwner, "owner"); return true },
      sendPrompt: async () => { prompts += 1 },
    }),
  })
  assert.equal(result.decision, "stop")
  assert.equal(prompts, 0)
})

test("a pending compaction also gates budget wrap-up prompts", async () => {
  let prompts = 0
  const result = await runContinuationPhases({
    scheduler: { resetRetries() {} }, host: {}, stateDir: "s", sessionID: "s",
    target: { targetID: "t", status: "active" }, expectedTargetID: "t", leaseOwner: "owner",
    operations: baseOperations({
      accountLiveTarget: async () => ({ targetID: "t", status: "budget_limited", budgetWrapupSent: false }),
      checkContext: async () => true,
      sendPrompt: async () => { prompts += 1 },
    }),
  })
  assert.equal(result.decision, "stop")
  assert.equal(prompts, 0)
})

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

test("idle only classifies completed new messages and reuses root history", async () => {
  const calls = []
  const messages = [
    { info: { id: "old", role: "assistant", time: { created: 1, completed: 2 } } },
    { info: { id: "new", role: "assistant", time: { created: 3, completed: 4 } } },
    { info: { id: "streaming", role: "assistant", time: { created: 5 } } },
  ]
  const target = { targetID: "t", status: "active", runtime: { evaluatedAssistantMessageIDs: ["old"], evaluatedThroughMs: 2 } }
  await runContinuationPhases({ scheduler: { resetRetries() {} }, host: {}, stateDir: "s", sessionID: "s", target, expectedTargetID: "t", options: { min_continue_interval_ms: 0 }, operations: baseOperations({
    listMessages: async () => messages,
    recordTargetTurnOutcome: async (_dir, _id, message) => { calls.push(message.info.id); return target },
    accountLiveTarget: async (_host, _dir, _id, _target, _options, rootMessages) => { assert.equal(rootMessages, messages); return { ...target, status: "complete" } },
  }) })
  assert.deepEqual(calls, ["new"])
})
