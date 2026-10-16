import assert from "node:assert/strict"
import test from "node:test"
import { createGitAdapter, createOpenCodeAdapter } from "../src/adapter.js"

test("native compaction uses the session summarize endpoint and passes the selected model", async () => {
  const calls = []
  const adapter = createOpenCodeAdapter({ session: { summarize: async (input) => { calls.push(input); return { data: true } } } })
  assert.equal(await adapter.summarize("s", { providerID: "p", modelID: "m" }), true)
  assert.deepEqual(calls[0].path, { id: "s" })
  assert.deepEqual(calls[0].body, { providerID: "p", modelID: "m", auto: false })
  assert.equal(typeof createOpenCodeAdapter({ session: {} }).summarize, "undefined")
})

test("compaction timeout fences retries while the original request is unsettled", async () => {
  let calls = 0
  const adapter = createOpenCodeAdapter({ session: { summarize: () => { calls += 1; return new Promise(() => {}) } } }, { compactionTimeoutMs: 10 })
  await assert.rejects(adapter.summarize("s", { providerID: "p", modelID: "m" }), (error) => error.code === "OPENCODE_COMPACTION_UNCERTAIN")
  await assert.rejects(adapter.summarize("s", { providerID: "p", modelID: "m" }), (error) => error.code === "OPENCODE_COMPACTION_UNCERTAIN")
  assert.equal(calls, 1)
})

test("model lookup resolves configured windows by provider identity", async () => {
  const adapter = createOpenCodeAdapter({ provider: { list: async () => ({ data: { all: [{ id: "p", models: { m: { limit: { context: 200000 } } } }] } }) } })
  assert.equal((await adapter.model("p", "m")).limit.context, 200000)
  assert.equal(await adapter.model("missing", "m"), null)
})

test("timed-out prompts cancel transport and never overlap an unsettled request", async () => {
  let calls = 0
  let signal
  const adapter = createOpenCodeAdapter({ session: {
    prompt: async (input) => {
      calls += 1
      signal = input.signal
      return new Promise(() => {})
    },
  } }, { timeoutMs: 10 })
  await assert.rejects(adapter.prompt("s", "continue"))
  assert.equal(signal?.aborted, true)
  await assert.rejects(adapter.prompt("s", "retry"), (error) => error.code === "OPENCODE_PROMPT_PENDING")
  assert.equal(calls, 1)
})

test("promptAsync dispatches without waiting for the assistant response", async () => {
  let promptCalls = 0
  let asyncCalls = 0
  const adapter = createOpenCodeAdapter({ session: {
    prompt: async () => {
      promptCalls += 1
      throw new Error("sync prompt must not be used")
    },
    promptAsync: async ({ path, body, signal }) => {
      asyncCalls += 1
      assert.equal(path.id, "s")
      assert.equal(body.parts[0].text, "continue")
      assert.equal(signal.aborted, false)
      return { data: undefined }
    },
  } }, { timeoutMs: 100 })

  assert.equal(await adapter.promptAsync("s", "continue"), undefined)
  assert.equal(asyncCalls, 1)
  assert.equal(promptCalls, 0)
})

test("prompt guard rejects concurrent calls and releases after settlement", async () => {
  let finish
  let started
  const ready = new Promise((resolve) => { started = resolve })
  const reply = { info: { id: "reply", role: "assistant" }, parts: [] }
  const adapter = createOpenCodeAdapter({ session: { prompt: () => {
    started()
    return new Promise((resolve) => { finish = resolve })
  } } })
  const first = adapter.prompt("s", "first")
  await ready
  await assert.rejects(adapter.prompt("s", "second"), (error) => error.code === "OPENCODE_PROMPT_PENDING")
  finish({ data: reply })
  assert.deepEqual(await first, reply)
  const next = adapter.prompt("s", "next")
  await Promise.resolve()
  finish({ data: reply })
  assert.deepEqual(await next, reply)
})

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
test("promptAsync rejects resolved SDK HTTP failures", async () => {
  const adapter = createOpenCodeAdapter({ session: {
    promptAsync: async () => ({ error: { message: "missing session" }, response: { ok: false, status: 404 } }),
  } })
  await assert.rejects(adapter.promptAsync("missing", "continue"), (error) => error.code === "OPENCODE_PROMPT_FAILED")
})

test("concurrent message reads share transport but settled reads stay fresh", async () => {
  let calls = 0
  const adapter = createOpenCodeAdapter({ session: { messages: async () => {
    calls += 1
    await new Promise((resolve) => setTimeout(resolve, 5))
    return { data: [] }
  } } })
  await Promise.all([adapter.messages("s"), adapter.messages("s")])
  assert.equal(calls, 1)
  await adapter.messages("s")
  assert.equal(calls, 2)
})
