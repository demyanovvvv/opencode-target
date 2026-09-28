import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createSignal } from "solid-js"
import { testRender } from "@opentui/solid"
import { createTarget, readTarget, setStoppedStatus, targetPath } from "../src/core.js"
import plugin from "../dist/target-tui.js"

// Exercise the generated plugin against the actual OpenTUI renderer, without a model/server.
const dir = await mkdtemp(path.join(os.tmpdir(), "target-tui-smoke-"))
const [route, setRoute] = createSignal({ name: "session", params: { sessionID: "session" } })
const [status, setStatus] = createSignal({ type: "busy" })
const [permissions, setPermissions] = createSignal([])
const [questions, setQuestions] = createSignal([])
const [animations, setAnimations] = createSignal(true)
const disposers = new Set()
const slots = []
const api = {
  route: { get current() { return route() } },
  state: { session: { status, permission: permissions, question: questions } },
  theme: { current: { accent: "#7aa2f7", warning: "#e0af68", error: "#f7768e", success: "#9ece6a", textMuted: "#737aa2" } },
  kv: { get: () => animations() },
  lifecycle: { onDispose: (fn) => { disposers.add(fn); return () => disposers.delete(fn) } },
  slots: { register: (value) => { slots.push(value); return "slot" } },
}
let screen
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function frameWith(text) {
  for (let attempt = 0; attempt < 100; attempt++) {
    await screen.renderOnce()
    const frame = screen.captureCharFrame()
    if (frame.includes(text)) return frame
    await pause(20)
  }
  assert.fail(`Expected ${JSON.stringify(text)} in frame:\n${screen.captureCharFrame()}`)
}
try {
  await createTarget(dir, "session", "Check rendered indicator", 120000)
  assert.equal(plugin.id, "opencode-target-tui")
  assert.equal(plugin.server, undefined)
  await plugin.tui(api, { state_dir: dir })
  assert.equal(slots.length, 1)
  assert.equal(typeof slots[0].slots.app_bottom, "function")
  screen = await testRender(() => slots[0].slots.app_bottom(), { width: 80, height: 4 })
  const working = await frameWith("working")
  assert.match(working, /0 \/ 120k/)
  await pause(120)
  await screen.renderOnce()
  assert.notEqual(screen.captureCharFrame(), working, "working animates")
  setAnimations(false)
  const still = await frameWith("● Target")
  await pause(120)
  await screen.renderOnce()
  assert.equal(screen.captureCharFrame(), still)
  setAnimations(true)
  setStatus({ type: "idle" })
  await frameWith("waiting")
  setStatus({ type: "retry", attempt: 1, message: "retry", next: Date.now() + 1000 })
  await frameWith("retrying")
  setPermissions([{}])
  await frameWith("needs input")
  setPermissions([])
  setQuestions([{}])
  await frameWith("needs input")
  setQuestions([])
  for (const [state, label] of [["paused", "paused"], ["active", "working"], ["blocked", "blocked"], ["budget_limited", "budget limit"], ["usage_limited", "usage limit"], ["complete", "complete"]]) {
    const target = await readTarget(dir, "session")
    if (state === "paused") await setStoppedStatus(dir, "session", state, "test", target.targetID)
    else await writeFile(targetPath(dir, "session"), JSON.stringify({ ...target, status: state }))
    setStatus({ type: "busy" })
    await frameWith(label)
  }
  screen.resize(24, 4)
  const narrow = await frameWith("complete")
  assert.doesNotMatch(narrow, /120k/)
  setRoute({ name: "session", params: { sessionID: "empty" } })
  await pause(80)
  await screen.renderOnce()
  assert.equal(screen.captureCharFrame().trim(), "", "new session must not display the old Target")
  setRoute({ name: "session", params: { sessionID: "session" } })
  await frameWith("complete")
  await rm(targetPath(dir, "session"))
  await pause(600)
  await screen.renderOnce()
  assert.equal(screen.captureCharFrame().trim(), "", "cleared Target is hidden")
  await writeFile(targetPath(dir, "session"), "{")
  await frameWith("unavailable")
  setRoute({ name: "home" })
  await pause(80)
  await screen.renderOnce()
  assert.equal(screen.captureCharFrame().trim(), "")
  for (const dispose of [...disposers]) dispose()
  setRoute({ name: "session", params: { sessionID: "session" } })
  await pause(80)
  await screen.renderOnce()
  assert.equal(screen.captureCharFrame().trim(), "", "plugin disposal stops updates")
  console.log("TUI smoke passed: real OpenTUI rendering, animation, all states, resize, navigation, clear, disposal")
} finally {
  screen?.renderer.destroy()
  await rm(dir, { recursive: true, force: true })
}
