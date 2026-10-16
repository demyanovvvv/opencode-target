import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { TargetPlugin } from "../src/server.js"
import { TargetPlugin as GeneratedTargetPlugin } from "../dist/target.js"
import { readTarget, setStoppedStatus } from "../src/core.js"

for (const [name, Plugin, autoContinue] of [["source", TargetPlugin, true], ["generated", GeneratedTargetPlugin, true], ["manual continuation", TargetPlugin, false]]) {
test(`${name}: native compaction preserves the goal and dispatches only the configured continuation`, { timeout: 5000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "target-context-integration-"))
  const history = []
  let compactions = 0
  let prompts = 0
  let complete
  let started
  const ready = new Promise((resolve) => { started = resolve })
  const client = {
    app: { log: async () => ({}) },
    provider: { list: async () => ({ data: { all: [{ id: "p", models: { m: { limit: { context: 200000 } } } }] } }) },
    session: {
      messages: async () => ({ data: history }), children: async () => ({ data: [] }),
      summarize: async ({ path, body }) => {
        assert.equal(path.id, "s")
        assert.equal(body.auto, false)
        compactions += 1
        const output = { context: [] }
        await hooks["experimental.session.compacting"]({ sessionID: "s" }, output)
        assert.match(output.context.join("\n"), /Preserve this complete objective/)
        const continuation = { enabled: true }
        await hooks["experimental.compaction.autocontinue"]({ sessionID: "s" }, continuation)
        assert.equal(continuation.enabled, false)
        started()
        await new Promise((resolve) => { complete = resolve })
        const at = Date.now() + 10
        history.push({ info: { id: "summary", role: "assistant", summary: true, time: { created: at, completed: at + 1 }, tokens: { input: 110000, output: 2000 } }, parts: [] })
        return { data: true }
      },
      promptAsync: async () => {
        prompts += 1
        const target = await readTarget(dir, "s")
        await setStoppedStatus(dir, "s", "complete", "integration verified", target.targetID)
        return { data: undefined }
      },
    },
  }
  let hooks
  try {
    hooks = await Plugin({ client }, { state_dir: dir, min_continue_interval_ms: 0, auto_continue: autoContinue })
    const output = { parts: [] }
    await hooks["command.execute.before"]({ command: "target", sessionID: "s", arguments: "context default 100k" }, output)
    await hooks.tool.create_target.execute({ objective: "Preserve this complete objective" }, { sessionID: "s" })
    const at = Date.now()
    const info = { id: "work", role: "assistant", sessionID: "s", providerID: "p", modelID: "m", time: { created: at, completed: at + 1 }, tokens: { input: 10000, output: 1000, cache: { read: 89000, write: 0 } } }
    history.push({ info, parts: [{ type: "text", text: "work" }] })
    await hooks.event({ event: { type: "message.updated", properties: { info } } })
    await ready
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "s" } } })
    assert.equal(prompts, 0)
    complete()
    await hooks.whenIdle("s")
    assert.equal(compactions, 1)
    assert.equal(prompts, autoContinue ? 1 : 0)
    assert.equal((await readTarget(dir, "s")).objective, "Preserve this complete objective")
  } finally {
    complete?.()
    await hooks?.event({ event: { type: "server.instance.disposed" } })
    await rm(dir, { recursive: true, force: true })
  }
})
}
