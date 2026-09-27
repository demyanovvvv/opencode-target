import assert from "node:assert/strict"
import test from "node:test"
import { createGitAdapter, createOpenCodeAdapter } from "../src/adapter.js"

test("Git adapter builds a stable fingerprint from HEAD and porcelain status", async () => {
  const calls = []
  const git = createGitAdapter({
    exec: async (file, args, options) => {
      calls.push({ file, args, options })
      return { stdout: args[0] === "rev-parse" ? "abc123\n" : " M src/core.js\n" }
    },
  })
  assert.equal(await git.fingerprint("/repo"), "abc123| M src/core.js\n")
  assert.equal(calls.length, 2)
})

test("OpenCode adapter preserves typed host API failures", async () => {
  const adapter = createOpenCodeAdapter({
    session: {
      messages: async () => { throw new Error("offline") },
      children: async () => ({ data: [] }),
      prompt: async () => ({ data: { info: { id: "reply", role: "assistant" }, parts: [] } }),
    },
  })
  await assert.rejects(() => adapter.messages("s"), (error) => error.code === "OPENCODE_MESSAGES_FAILED")
  assert.deepEqual(await adapter.children("s"), [])
  assert.deepEqual(await adapter.prompt("s", "continue"), { info: { id: "reply", role: "assistant" }, parts: [] })
})

test("OpenCode adapter rejects malformed successful list payloads", async () => {
  const adapter = createOpenCodeAdapter({
    session: {
      messages: async () => ({ data: { unexpected: true } }),
      children: async () => ({ data: null }),
      prompt: async () => ({ data: {} }),
    },
  })

  await assert.rejects(
    adapter.messages("messages-session"),
    (error) => error.code === "OPENCODE_MESSAGES_FAILED" && /expected an array/.test(error.message),
  )
  await assert.rejects(
    adapter.children("children-session"),
    (error) => error.code === "OPENCODE_CHILDREN_FAILED" && /expected an array/.test(error.message),
  )
})

test("OpenCode adapter bounds a hanging host API call", async () => {
  const adapter = createOpenCodeAdapter({
    session: {
      messages: async () => new Promise(() => {}),
      children: async () => ({ data: [] }),
      prompt: async () => ({ data: { info: { id: "reply", role: "assistant" }, parts: [] } }),
    },
  }, { timeoutMs: 10 })

  await assert.rejects(
    adapter.messages("hanging-session"),
    (error) => error.code === "OPENCODE_MESSAGES_FAILED" && error.cause?.code === "OPENCODE_HOST_TIMEOUT",
  )
})

test("OpenCode adapter accepts direct arrays and SDK data envelopes", async () => {
  const directMessage = { info: { id: "m" } }
  const child = { id: "child" }
  const adapter = createOpenCodeAdapter({
    session: {
      messages: async () => [directMessage],
      children: async () => ({ data: [child] }),
      prompt: async () => ({ data: {} }),
    },
  })

  assert.deepEqual(await adapter.messages("s"), [directMessage])
  assert.deepEqual(await adapter.children("s"), [child])
})

test("OpenCode adapter rejects malformed prompt success payloads", async () => {
  const adapter = createOpenCodeAdapter({
    session: {
      messages: async () => ({ data: [] }),
      children: async () => ({ data: [] }),
      prompt: async () => ({ data: { ok: true } }),
    },
  })

  await assert.rejects(
    adapter.prompt("prompt-session", "continue"),
    (error) => error.code === "OPENCODE_PROMPT_FAILED" && /expected an assistant message/.test(error.message),
  )
})
