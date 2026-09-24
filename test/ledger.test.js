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

test("UsageLedger exposes completeness when traversal is capped", () => {
  const ledger = new UsageLedger({ createdAtMs: 0, maxEntries: 1 })
  ledger.record([{ sessionID: "root", message: assistant("a", 1, 1) }])
  ledger.record([{ sessionID: "root", message: assistant("b", 1, 1) }])
  assert.equal(ledger.completeness().truncated, true)
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
