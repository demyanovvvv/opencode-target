import assert from "node:assert/strict"
import test from "node:test"
import { createHostSessionAdapter, normalizePromptResponse } from "../src/host.js"

test("host session adapter uses an existing adapter and normalizes prompt envelopes", async () => {
  const calls = []
  const adapter = createHostSessionAdapter({
    adapter: {
      messages: async (id) => { calls.push(["messages", id]); return ["message"] },
      children: async (id) => { calls.push(["children", id]); return ["child"] },
      prompt: async (id, text) => { calls.push(["prompt", id, text]); return { info: { id: "reply" }, parts: [] } },
    },
  })

  assert.deepEqual(await adapter.messages("s"), ["message"])
  assert.deepEqual(await adapter.children("s"), ["child"])
  assert.deepEqual(await adapter.prompt("s", "continue"), { info: { id: "reply" }, parts: [] })
  assert.deepEqual(calls, [["messages", "s"], ["children", "s"], ["prompt", "s", "continue"]])
})

test("prompt normalization accepts direct and message envelopes, rejects malformed values", () => {
  const direct = { info: { id: "reply" }, parts: [] }
  assert.equal(normalizePromptResponse(direct), direct)
  assert.deepEqual(normalizePromptResponse({ message: direct }), direct)
  assert.equal(normalizePromptResponse(null), null)
  assert.equal(normalizePromptResponse({ info: {} }), null)
})
