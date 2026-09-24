import test from "node:test"
import assert from "node:assert/strict"
import { normalizePluginOptions } from "../src/options.js"

test("normalizes plugin defaults and nested verification retry policy", () => {
  const options = normalizePluginOptions({
    verification: [{ id: "  lint ", command: " npm run lint ", retry: { maxAttempts: 4 } }],
    exec_tool_names: [" bash ", "custom"],
  })

  assert.equal(options.command_name, "target")
  assert.equal(options.alias, "t")
  assert.equal(options.auto_continue, true)
  assert.equal(options.scheduler_lease_ms, 30_000)
  assert.deepEqual(options.verification, [{
    id: "lint",
    command: "npm run lint",
    requirementID: null,
    retry: { maxAttempts: 4, baseDelayMs: 250, maxDelayMs: 5000 },
  }])
  assert.deepEqual(options.exec_tool_names, ["bash", "custom"])
  assert.ok(Object.isFrozen(options))
})

test("rejects malformed plugin options with stable validation errors", () => {
  assert.throws(() => normalizePluginOptions([]), /options must be an object/)
  assert.throws(() => normalizePluginOptions({ command_name: "two words" }), /command_name/)
  assert.throws(() => normalizePluginOptions({ scheduler_lease_ms: 999 }), /scheduler_lease_ms/)
  assert.throws(() => normalizePluginOptions({ verification: [{ command: " " }] }), /verification entries/)
  assert.throws(() => normalizePluginOptions({ exec_tool_names: [" "] }), /exec_tool_names/)
})
