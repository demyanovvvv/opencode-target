import assert from "node:assert/strict"
import test from "node:test"
import { UsageLedger } from "../src/ledger.js"

const assistant = (id, input, output, cached = 0, mode = "build") => ({
  info: { id, role: "assistant", mode, tokens: { input, output, cache: { read: cached } } },
})

const timedAssistant = (id, input, created, completed) => ({
  info: { id, role: "assistant", mode: "build", time: { created, completed }, tokens: { input, output: 0 } },
})

test("UsageLedger records only positive deltas and splits root from descendants", () => {
  const ledger = new UsageLedger({ createdAtMs: 100 })
  const result = ledger.record([
    { sessionID: "root", message: assistant("a", 10, 5, 2) },
    { sessionID: "child", message: assistant("b", 20, 10, 5) },
    { sessionID: "root", message: assistant("plan", 100, 100, 0, "plan") },
  ])
  assert.deepEqual(result, { rootDelta: 13, descendantDelta: 25, totalDelta: 38 })
  assert.deepEqual(ledger.record([{ sessionID: "root", message: assistant("a", 10, 5, 2) }]), {
    rootDelta: 0, descendantDelta: 0, totalDelta: 0,
  })
})

test("UsageLedger retains identity beyond its former cap across replay and restart", () => {
  const ledger = new UsageLedger({ createdAtMs: 0, maxEntries: 1 })
  const samples = ["a", "b", "c"].map(id => ({ sessionID: "root", message: assistant(id, 1, 1) }))
  assert.equal(ledger.record(samples).totalDelta, 6)
  assert.equal(ledger.record(samples).totalDelta, 0)
  const restored = new UsageLedger({ maxEntries: 1, usageByMessage: JSON.parse(JSON.stringify(Object.fromEntries(ledger.usageByMessage))) })
  assert.equal(restored.record(samples).totalDelta, 0)
  assert.equal(restored.completeness().truncated, false)
})

test("streaming growth, stale updates and a separate retry message survive restart", () => {
  const ledger = new UsageLedger()
  const sample = n => ({ sessionID: "root", message: assistant("stream", 10, n) })
  assert.equal(ledger.record([sample(0), sample(5), sample(3), sample(8), sample(8)]).totalDelta, 18)
  const restored = new UsageLedger({ usageByMessage: Object.fromEntries(ledger.usageByMessage) })
  assert.equal(restored.record([sample(5), sample(8)]).totalDelta, 0)
  assert.equal(restored.record([{ sessionID: "root", message: assistant("paid-retry", 10, 8) }]).totalDelta, 18)
  assert.equal(restored.record([{ sessionID: "child", message: assistant("stream", 10, 8) }]).descendantDelta, 18)
})

test("normalized SDK usage includes reasoning and cache creation but never subtracts cache reads twice", () => {
  const ledger = new UsageLedger()
  const message = assistant("normalized", 6221, 136, 19584)
  message.info.tokens.reasoning = 10
  message.info.tokens.cache.write = 20
  assert.equal(ledger.record([{ message }], { tokenSemantics: "opencode-normalized-v1" }).totalDelta, 6387)
})

test("distinct paid retries count once while message snapshots and duplicate parts do not add requests", () => {
  const ledger = new UsageLedger()
  const message = assistant("retry", 30, 0)
  message.parts = [{ id: "attempt-1", type: "step-finish", tokens: { input: 30 } }]
  assert.equal(ledger.record([{ message }]).totalDelta, 30)
  message.info.tokens.input = 40
  assert.equal(ledger.record([{ message }]).totalDelta, 10)
  message.parts.push({ id: "attempt-2", type: "step-finish", tokens: { input: 40 } })
  message.parts.push(message.parts[0])
  assert.equal(ledger.record([{ message }]).totalDelta, 30)
  assert.equal(ledger.record([{ message }]).totalDelta, 0)
  const restarted = new UsageLedger({ usageByMessage: Object.fromEntries(ledger.usageByMessage) })
  assert.equal(restarted.record([{ message }]).totalDelta, 0)
})

test("late-discovered pre-Target messages establish a zero-charge baseline then accrue deltas", () => {
  const ledger = new UsageLedger({ createdAtMs: 1000, rootSessionID: "root" })

  assert.deepEqual(ledger.record([
    { sessionID: "root", message: timedAssistant("late", 100, 900, 1100) },
  ]), { rootDelta: 0, descendantDelta: 0, totalDelta: 0 })
  assert.equal(ledger.usageByMessage.get("root:late"), 100)

  assert.deepEqual(ledger.record([
    { sessionID: "root", message: timedAssistant("late", 140, 900, 1200) },
  ]), { rootDelta: 40, descendantDelta: 0, totalDelta: 40 })
})

test("messages first observed after Target creation are charged normally", () => {
  const ledger = new UsageLedger({ createdAtMs: 1000, rootSessionID: "root" })
  assert.equal(ledger.record([
    { sessionID: "root", message: timedAssistant("new", 25, 1001, 1100) },
  ]).totalDelta, 25)
})
