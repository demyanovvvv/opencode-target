import assert from "node:assert/strict"
import test from "node:test"
import { applyCompactionContext, applySystemPolicy, disableCompactionAutocontinue } from "../src/context-hooks.js"

const active = { status: "active", targetID: "target-1" }
const paused = { status: "paused", targetID: "target-2" }

test("system policy hook ignores missing sessions and appends policy only for active targets", async () => {
  const calls = []
  const readTarget = async (_dir, id) => { calls.push(id); return active }
  const output = { system: ["base"] }
  await applySystemPolicy({ input: { sessionID: "s" }, output, stateDir: "/state", readTarget, systemTargetPolicy: () => "policy" })
  await applySystemPolicy({ input: {}, output, stateDir: "/state", readTarget, systemTargetPolicy: () => "policy" })
  assert.deepEqual(output.system, ["base", "policy"])
  assert.deepEqual(calls, ["s"])
})

test("compaction hook preserves context and disables generic continuation only while active", async () => {
  const targets = new Map([["active", active], ["paused", paused]])
  const readTarget = async (_dir, id) => targets.get(id) ?? null
  const context = ["existing"]
  await applyCompactionContext({ input: { sessionID: "active" }, output: { context }, stateDir: "/state", readTarget, compactionTargetContext: () => "durable" })
  await applyCompactionContext({ input: { sessionID: "missing" }, output: { context }, stateDir: "/state", readTarget, compactionTargetContext: () => "durable" })
  assert.deepEqual(context, ["existing", "durable"])

  const activeOutput = { enabled: true }
  await disableCompactionAutocontinue({ input: { sessionID: "active" }, output: activeOutput, stateDir: "/state", readTarget })
  assert.equal(activeOutput.enabled, false)
  const pausedOutput = { enabled: true }
  await disableCompactionAutocontinue({ input: { sessionID: "paused" }, output: pausedOutput, stateDir: "/state", readTarget })
  assert.equal(pausedOutput.enabled, true)
})
