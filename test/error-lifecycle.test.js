import assert from "node:assert/strict"
import test from "node:test"
import { errorStopReason, handleSessionError, resolveErrorStatus } from "../src/error-lifecycle.js"

test("resolveErrorStatus lets usage limits supersede budget limits but not other stops", () => {
  assert.equal(resolveErrorStatus("HTTP 429 rate limit", "active"), "usage_limited")
  assert.equal(resolveErrorStatus("HTTP 429 rate limit", "budget_limited"), "usage_limited")
  assert.equal(resolveErrorStatus("ordinary failure", "budget_limited"), null)
  assert.equal(resolveErrorStatus("request aborted", "active"), "paused")
  assert.equal(resolveErrorStatus("runtime boom", "active"), "blocked")
})

test("errorStopReason produces stable bounded reasons", () => {
  assert.equal(errorStopReason("usage_limited", "HTTP 429"), "HTTP 429")
  assert.equal(errorStopReason("usage_limited", ""), "Usage limit reached")
  assert.equal(errorStopReason("paused", "anything"), "Session interrupted/aborted")
  assert.equal(errorStopReason("blocked", "boom"), "boom")
  assert.equal(errorStopReason("blocked", ""), "Session runtime error")
  const long = "x".repeat(1000)
  assert.equal(errorStopReason("blocked", long).length, 500)
})

test("handleSessionError ignores non-active targets and persists classified stops", async () => {
  const calls = []
  const base = {
    stateDir: "dir",
    sessionID: "s",
    options: {},
    readTarget: async () => ({ targetID: "t1", status: "active" }),
    accountLiveTarget: async () => ({ targetID: "t1", status: "active" }),
    setStoppedStatus: async (...args) => { calls.push(args); return { targetID: "t1" } },
  }

  const ignored = await handleSessionError({ error: "boom" }, { ...base, readTarget: async () => ({ targetID: "t1", status: "paused" }) })
  assert.equal(ignored, null)
  assert.equal(calls.length, 0)

  await handleSessionError({ properties: { error: "HTTP 429" } }, base)
  assert.deepEqual(calls.at(-1), ["dir", "s", "usage_limited", "HTTP 429", "t1"])

  await handleSessionError({ error: "runtime boom" }, base)
  assert.deepEqual(calls.at(-1), ["dir", "s", "blocked", "runtime boom", "t1"])
})

test("handleSessionError honors accounting-driven budget limit and stale writes", async () => {
  const calls = []
  const options = { stateDir: "dir", sessionID: "s", options: {}, readTarget: async () => ({ targetID: "t1", status: "active" }), setStoppedStatus: async (...args) => { calls.push(args) } }

  const budgetStopped = await handleSessionError({ error: "boom" }, {
    ...options,
    accountLiveTarget: async () => ({ targetID: "t1", status: "budget_limited" }),
  })
  assert.equal(budgetStopped, null)
  assert.equal(calls.length, 0)

  const stale = await handleSessionError({ error: "HTTP 429" }, {
    ...options,
    accountLiveTarget: async () => ({ targetID: "t2", status: "active" }),
  })
  assert.equal(stale, null)
  assert.equal(calls.length, 0)
})
test("abort persists pause before accounting and survives accounting failure", async () => {
  const calls = []
  const stopped = { targetID: "t1", status: "paused" }
  const result = await handleSessionError({ error: "request aborted" }, {
    stateDir: "dir", sessionID: "s", options: {},
    readTarget: async () => ({ targetID: "t1", status: "active" }),
    setStoppedStatus: async (...args) => { calls.push(["stop", ...args]); return stopped },
    accountLiveTarget: async () => { calls.push(["account"]); throw new Error("offline") },
  })
  assert.equal(result, stopped)
  assert.deepEqual(calls[0], ["stop", "dir", "s", "paused", "Session interrupted/aborted", "t1"])
})
