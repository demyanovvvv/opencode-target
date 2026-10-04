import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { createTarget, defaultStateDir, targetPath } from "../src/core.js"
import { createTargetObserver, indicatorView, readIndicatorState, resolveIndicatorLanguage, resolveIndicatorStateDir } from "../src/tui-state.js"

const target = { version: 3, sessionID: "session", targetID: "target-1", status: "active", tokensUsed: 24800, tokenBudget: 120000 }
const snapshot = (status = "active") => ({ kind: "target", target: { ...target, status } })

test("indicator reads current state without modifying or quarantining it", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "target-indicator-"))
  try {
    assert.deepEqual(await readIndicatorState(dir, "session"), { kind: "missing" })
    assert.deepEqual(await readdir(dir), [])
    await createTarget(dir, "session", "Check real persisted Target compatibility")
    assert.equal((await readIndicatorState(dir, "session")).kind, "target")
    const file = targetPath(dir, "session")
    for (const version of [2, 3]) {
      await writeFile(file, JSON.stringify({ ...target, version }))
      const result = await readIndicatorState(dir, "session")
      assert.equal(result.kind, "target")
      assert.equal(result.target.status, "active")
    }
    for (const invalid of ["{", "null", JSON.stringify({ ...target, version: 99 }),
      JSON.stringify({ ...target, sessionID: "other" }), JSON.stringify({ ...target, status: "invented" }),
      JSON.stringify({ ...target, tokensUsed: -1 }), JSON.stringify({ ...target, tokenBudget: "oops" })]) {
      await writeFile(file, invalid)
      assert.deepEqual(await readIndicatorState(dir, "session"), { kind: "unavailable" })
      assert.equal(await readFile(file, "utf8"), invalid)
      assert.deepEqual(await readdir(path.join(dir, "corrupt")), [])
    }
    await rm(file)
    assert.equal((await readIndicatorState(dir, "session")).kind, "missing")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("indicator state directory follows Target defaults and explicit local override", () => {
  assert.equal(resolveIndicatorStateDir(), defaultStateDir())
  assert.equal(resolveIndicatorStateDir({ state_dir: "custom" }), path.resolve("custom"))
})

test("indicator combines lifecycle with live session activity; stopped states win", () => {
  assert.equal(indicatorView(snapshot(), { type: "busy" }).label, "working")
  assert.equal(indicatorView(snapshot(), { type: "idle" }).label, "waiting")
  assert.equal(indicatorView(snapshot(), { type: "retry" }).label, "retrying")
  assert.equal(indicatorView(snapshot(), { type: "busy", needsInput: true }).label, "needs input")
  assert.equal(indicatorView(snapshot(), { needsInput: true }).intervalMs, 0)
  for (const [status, label] of Object.entries({ paused: "paused", blocked: "blocked", complete: "complete", usage_limited: "usage limit", budget_limited: "budget limit" })) {
    const view = indicatorView(snapshot(status), { type: "busy", needsInput: true })
    assert.equal(view.label, label)
    assert.equal(view.intervalMs, 0)
  }
  assert.equal(indicatorView({ kind: "missing" }), null)
  assert.equal(indicatorView({ kind: "loading" }), null)
  assert.equal(indicatorView({ kind: "unavailable" }).label, "unavailable")
})

test("indicator explains stopped states, distinguishes runtime errors, and localizes labels", () => {
  const paused = indicatorView({ kind: "target", target: { ...target, status: "paused", stopReason: "User request" } }, {}, { language: "ru" })
  assert.match(paused.text, /Target · Пауза/)
  assert.match(paused.text, /\/target resume/)
  assert.match(paused.text, /User request/)
  const error = indicatorView({ kind: "target", target: { ...target, status: "blocked", lastError: "API\n\u001b[31mfailed" } }, {}, { language: "ru" })
  assert.equal(error.label, "Ошибка")
  assert.match(error.text, /API failed/)
  assert.doesNotMatch(error.text, /\u001b|\n/)
  assert.equal(error.intervalMs, 0)
  assert.equal(indicatorView(snapshot("blocked")).label, "blocked")
  assert.match(indicatorView(snapshot(), { type: "retry", attempt: 2 }, { language: "ru" }).text, /Повтор запроса · попытка 2/)
  assert.match(indicatorView(snapshot(), { needsInput: true, permission: true }, { language: "ru" }).text, /Нужно разрешение/)
  assert.match(indicatorView(snapshot(), { needsInput: true }, { language: "ru" }).text, /Нужен ответ/)
  assert.match(indicatorView(snapshot(), { type: "busy" }, { language: "ru", width: 20 }).text, /Target/)
  assert.equal(resolveIndicatorLanguage({ language: "ru" }), "ru")
  assert.equal(resolveIndicatorLanguage({}, { LANG: "ru_RU.UTF-8" }), "ru")
  assert.equal(resolveIndicatorLanguage({ language: "en" }, { LANG: "ru_RU" }), "en")
})

test("animation is independent from state reads and honors disabled animations", () => {
  const first = indicatorView(snapshot(), { type: "busy" }, { frame: 0 })
  const next = indicatorView(snapshot(), { type: "busy" }, { frame: 1 })
  assert.notEqual(first.text, next.text)
  assert.equal(first.intervalMs, 80)
  assert.equal(indicatorView(snapshot(), { type: "idle" }).intervalMs, 400)
  const still = indicatorView(snapshot(), { type: "busy" }, { animations: false, frame: 0 })
  assert.equal(still.text, indicatorView(snapshot(), { type: "busy" }, { animations: false, frame: 9 }).text)
  assert.equal(still.intervalMs, 0)
})

test("indicator drops token details first on narrow terminals and handles absent budgets", () => {
  const full = indicatorView(snapshot(), { type: "busy" }, { width: 80 }).text
  assert.match(full, /24\.8k \/ 120k/)
  const narrow = indicatorView(snapshot(), { type: "busy" }, { width: 22 }).text
  assert.match(narrow, /Target.*working/)
  assert.doesNotMatch(narrow, /24\.8/)
  for (const width of [1, 8, 16, 22, 40]) {
    assert.ok([...indicatorView(snapshot("budget_limited"), {}, { width }).text].length <= width)
  }
  assert.match(indicatorView({ kind: "target", target: { ...target, tokenBudget: null } }).text, /24\.8k tokens/)
})

function fakeTimers() {
  const pending = new Map()
  let next = 0
  return {
    pending,
    setTimeout(fn) { pending.set(++next, fn); return next },
    clearTimeout(id) { pending.delete(id) },
    async tick() {
      const [id, fn] = pending.entries().next().value
      pending.delete(id)
      await fn()
    },
  }
}
const flush = () => new Promise((resolve) => setImmediate(resolve))

test("observer rejects late reads after navigation and disposal, with one polling timer", async () => {
  const timers = fakeTimers()
  const reads = []
  const updates = []
  const observer = createTargetObserver({
    timers,
    read: (sessionID, { signal }) => new Promise((resolve) => reads.push({ sessionID, signal, resolve })),
    onChange: (value) => updates.push(value),
  })
  observer.setSession("a")
  observer.setSession("a")
  assert.equal(reads.length, 1)
  observer.setSession("b")
  assert.equal(reads[0].signal.aborted, true)
  reads[1].resolve(snapshot("paused"))
  await flush()
  reads[0].resolve(snapshot())
  await flush()
  assert.equal(updates.at(-1).sessionID, "b")
  assert.equal(updates.at(-1).target.status, "paused")
  assert.equal(timers.pending.size, 1)
  const polling = timers.tick()
  observer.dispose()
  reads[2].resolve(snapshot("complete"))
  await polling
  assert.equal(updates.at(-1).target.status, "paused")
  assert.equal(timers.pending.size, 0)
  observer.setSession("c")
  assert.equal(reads.length, 3)
})

test("observer recovers from read failures, detects clear and stops polling on home", async () => {
  const timers = fakeTimers()
  const updates = []
  const results = [new Error("permission denied"), snapshot("paused"), { kind: "missing" }]
  const observer = createTargetObserver({ timers, onChange: (value) => updates.push(value), read: async () => {
    const result = results.shift()
    if (result instanceof Error) throw result
    return result
  } })
  observer.setSession("session")
  await flush()
  assert.equal(updates.at(-1).kind, "unavailable")
  await timers.tick()
  assert.equal(updates.at(-1).target.status, "paused")
  await timers.tick()
  assert.equal(updates.at(-1).kind, "missing")
  observer.setSession(null)
  assert.equal(timers.pending.size, 0)
  assert.equal(updates.at(-1).sessionID, null)
  observer.dispose()
})
