import assert from "node:assert/strict"
import test from "node:test"
import { accountToolBoundary, isAccountableTarget, rootMessageSamples } from "../src/tool-accounting.js"

test("isAccountableTarget only accepts active and budget_limited", () => {
  for (const status of ["active", "budget_limited"]) assert.equal(isAccountableTarget({ status }), true, status)
  for (const status of ["paused", "blocked", "usage_limited", "complete"]) assert.equal(isAccountableTarget({ status }), false, status)
  assert.equal(isAccountableTarget(null), false)
})

test("rootMessageSamples tags each message with the root session", () => {
  assert.deepEqual(rootMessageSamples("s", [{ id: 1 }, { id: 2 }]), [
    { sessionID: "s", message: { id: 1 } },
    { sessionID: "s", message: { id: 2 } },
  ])
  assert.deepEqual(rootMessageSamples("s", []), [])
})

test("accountToolBoundary skips non-accountable or missing targets without listing messages", async () => {
  let listed = false
  const deps = {
    stateDir: "dir",
    sessionID: "s",
    readTarget: async () => null,
    listMessages: async () => { listed = true; return [] },
    accountTargetUsage: async () => { listed = true },
  }
  assert.equal(await accountToolBoundary(deps), null)
  assert.equal(listed, false)

  const paused = await accountToolBoundary({ ...deps, readTarget: async () => ({ targetID: "t", status: "paused" }) })
  assert.equal(paused, null)
  assert.equal(listed, false)
})

test("accountToolBoundary accounts root messages against the current target", async () => {
  const calls = []
  const result = await accountToolBoundary({
    stateDir: "dir",
    sessionID: "s",
    readTarget: async () => ({ targetID: "t1", status: "active" }),
    listMessages: async (sessionID) => [{ id: 1 }],
    accountTargetUsage: async (...args) => { calls.push(args); return { targetID: "t1" } },
  })
  assert.deepEqual(result, { targetID: "t1" })
  assert.deepEqual(calls, [["dir", "s", [{ sessionID: "s", message: { id: 1 } }], { expectedTargetID: "t1" }]])
})

test("tool accounting prefers streamed usage updates without fetching history", async () => {
  let samples
  await accountToolBoundary({ stateDir: "d", sessionID: "s",
    readTarget: async () => ({ targetID: "t", status: "active" }),
    listMessages: async () => { assert.fail("history must not be fetched") },
    incrementalMessages: [{ info: { id: "m", role: "assistant", tokens: { output: 10 } } }],
    accountTargetUsage: async (_dir, _id, value) => { samples = value },
  })
  assert.equal(samples[0].message.info.tokens.output, 10)
})
