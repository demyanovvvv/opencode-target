import assert from "node:assert/strict"
import test from "node:test"

import { collectSessionUsage } from "../src/traversal.js"

function adapter(tree, messages = {}) {
  return {
    async children(sessionID) {
      return (tree[sessionID] || []).map((id) => ({ id }))
    },
    async messages(sessionID) {
      return messages[sessionID] || []
    },
  }
}

test("collectSessionUsage traverses nested sessions breadth-first and deduplicates cycles", async () => {
  const host = adapter(
    {
      root: ["child-a", "child-b", "child-a"],
      "child-a": ["root", "grandchild"],
      "child-b": ["grandchild"],
      grandchild: [],
    },
    {
      root: [{ info: { id: "m-root" } }],
      "child-a": [{ info: { id: "m-a" } }],
      "child-b": [{ info: { id: "m-b" } }],
      grandchild: [{ info: { id: "m-grandchild" } }],
    },
  )

  const samples = await collectSessionUsage(host, "root")

  assert.deepEqual(samples.map(({ sessionID, descendant }) => ({ sessionID, descendant })), [
    { sessionID: "root", descendant: false },
    { sessionID: "child-a", descendant: true },
    { sessionID: "child-b", descendant: true },
    { sessionID: "grandchild", descendant: true },
  ])
})

test("collectSessionUsage accepts all supported child session identity fields", async () => {
  const host = {
    async children(sessionID) {
      return sessionID === "root"
        ? [{ sessionID: "child-a" }, { sessionId: "child-b" }, { id: "child-c" }]
        : []
    },
    async messages(sessionID) {
      return [{ info: { id: `message-${sessionID}` } }]
    },
  }

  const samples = await collectSessionUsage(host, "root")
  assert.deepEqual(samples.map((sample) => sample.sessionID), ["root", "child-a", "child-b", "child-c"])
})

test("collectSessionUsage fails closed when depth would omit descendants", async () => {
  const host = adapter({ root: ["child"], child: ["grandchild"], grandchild: [] })

  await assert.rejects(
    collectSessionUsage(host, "root", { maxDepth: 1 }),
    (error) => error.code === "ACCOUNTING_TRAVERSAL_INCOMPLETE" && error.reason === "max_depth",
  )
})

test("collectSessionUsage fails closed before exceeding the session limit", async () => {
  const host = adapter({ root: ["child-a", "child-b"], "child-a": [], "child-b": [] })

  await assert.rejects(
    collectSessionUsage(host, "root", { maxSessions: 2 }),
    (error) => error.code === "ACCOUNTING_TRAVERSAL_INCOMPLETE" && error.reason === "max_sessions",
  )
})

test("collectSessionUsage propagates typed host failures without returning partial samples", async () => {
  const failure = new Error("children unavailable")
  failure.code = "OPENCODE_CHILDREN_FAILED"
  const host = {
    async messages() {
      return [{ info: { id: "partial" } }]
    },
    async children() {
      throw failure
    },
  }

  await assert.rejects(collectSessionUsage(host, "root"), (error) => error === failure)
})

test("usage traversal runs bounded concurrent requests and reuses root messages", async () => {
  let active = 0
  let peak = 0
  const host = {
    async messages(id) {
      assert.notEqual(id, "root")
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return [{ info: { id } }]
    },
    async children(id) { return id === "root" ? [{ id: "a" }, { id: "b" }, { id: "c" }] : [] },
  }
  const samples = await collectSessionUsage(host, "root", { rootMessages: [], concurrency: 2 })
  assert.equal(peak, 2)
  assert.deepEqual(samples.map((s) => s.sessionID), ["a", "b", "c"])
})

test("benchmark bounded traversal against sequential host latency", async () => {
  for (const count of [1, 16, 96]) {
    let calls = 0
    const request = async (value) => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 2)); return value }
    const host = {
      messages: () => request([]),
      children: (id) => request(id === "root" ? Array.from({ length: count - 1 }, (_, i) => ({ id: `c-${i}` })) : []),
    }
    const start = performance.now()
    await host.messages("root")
    for (let i = 0; i < count; i++) { await host.messages(i ? `c-${i - 1}` : "root"); await host.children(i ? `c-${i - 1}` : "root") }
    const baselineMs = performance.now() - start
    const baselineCalls = calls
    calls = 0
    const optimizedStart = performance.now()
    await collectSessionUsage(host, "root", { rootMessages: [] })
    const optimizedMs = performance.now() - optimizedStart
    console.log(`traversal benchmark sessions=${count}: sequential=${baselineMs.toFixed(1)}ms/${baselineCalls} calls; optimized=${optimizedMs.toFixed(1)}ms/${calls} calls`)
    assert.equal(calls, count * 2 - 1)
  }
})
