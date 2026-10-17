import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { TargetPlugin } from "../src/server.js"
import { TargetPlugin as GeneratedTargetPlugin } from "../dist/target.js"
import { readTarget, setStoppedStatus } from "../src/core.js"
import { ContextSettings, parseContextCommand } from "../src/context.js"

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

async function waitFor(predicate) {
  const deadline = Date.now() + 3000
  while (!await predicate()) {
    assert.ok(Date.now() < deadline, "Expected compaction/continuation state was not reached")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

for (const [name, Plugin] of [["source", TargetPlugin], ["generated", GeneratedTargetPlugin]]) {
  for (const scenario of ["summary before response", "uncertain response", "restart polling"]) {
    test(`${name}: ${scenario} continues once after late compaction while respecting host busy state`, { timeout: 6000 }, async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "target-late-compaction-"))
      const settings = new ContextSettings(dir)
      const history = []
      let compactions = 0
      let prompts = 0
      let finish
      let status = "busy"
      const client = {
        app: { log: async () => ({}) },
        provider: { list: async () => ({ data: { all: [{ id: "p", models: { m: { limit: { context: 200000 } } } }] } }) },
        session: {
          messages: async () => ({ data: history }), children: async () => ({ data: [] }),
          status: async () => ({ data: { s: { type: status } } }),
          summarize: async () => {
            compactions += 1
            if (scenario === "uncertain response") throw new Error("summarize transport timed out")
            await new Promise((resolve) => { finish = resolve })
            return { data: true }
          },
          promptAsync: async () => { prompts += 1; status = "busy"; return { data: undefined } },
        },
      }
      let hooks
      try {
        hooks = await Plugin({ client }, { state_dir: dir, min_continue_interval_ms: 0 })
        await settings.command("s", parseContextCommand("100k"))
        await hooks.tool.create_target.execute({ objective: "Continue after a slow compact" }, { sessionID: "s" })
        const at = Date.now()
        const info = { id: "work", role: "assistant", sessionID: "s", providerID: "p", modelID: "m", time: { created: at, completed: at + 1 }, tokens: { input: 100000, output: 0 } }
        history.push({ info, parts: [{ type: "text", text: "Work before compaction" }] })
        if (scenario === "restart polling") {
          await hooks["experimental.session.compacting"]({ sessionID: "s" }, { context: [] })
          await hooks.event({ event: { type: "server.instance.disposed" } })
          await settings.mutate("s", (record) => { record.runtime.pending.startedAtMs = Date.now() - 121000; return record })
          hooks = await Plugin({ client }, { state_dir: dir, min_continue_interval_ms: 0 })
          await hooks.event({ event: { type: "session.idle", properties: { sessionID: "s" } } })
        } else {
          await hooks.event({ event: { type: "message.updated", properties: { info } } })
          await waitFor(() => compactions === 1)
        }
        if (scenario !== "summary before response") await waitFor(async () => Boolean((await settings.session("s")).runtime.pending?.uncertainAtMs))
        assert.equal((await readTarget(dir, "s")).status, "active")
        assert.equal(prompts, 0)
        const summaryAt = Date.now() + 10
        const summary = { id: "late-summary", role: "assistant", sessionID: "s", summary: true, time: { created: summaryAt, completed: summaryAt + 1 }, tokens: { input: 110000, output: 1000 } }
        history.push({ info: summary, parts: [] })
        if (scenario !== "restart polling") {
          await hooks.event({ event: { type: "session.compacted", properties: { sessionID: "s" } } })
          await hooks.event({ event: { type: "message.updated", properties: { info: summary } } })
        }
        await waitFor(async () => (await settings.session("s")).runtime.pending === null)
        assert.equal(prompts, 0, "Compaction completion must not prompt a busy host")
        status = "idle" // No subsequent idle event: reconciliation must wake the scheduler itself.
        await waitFor(() => prompts === 1)
        for (let i = 0; i < 3; i++) await hooks.event({ event: { type: "session.compacted", properties: { sessionID: "s" } } })
        finish?.()
        await hooks.whenIdle("s")
        assert.equal(prompts, 1)
        assert.equal(compactions, scenario === "restart polling" ? 0 : 1)
        assert.equal((await readTarget(dir, "s")).status, "active")
      } finally {
        finish?.()
        if (hooks) await hooks.event({ event: { type: "server.instance.disposed" } })
        await rm(dir, { recursive: true, force: true })
      }
    })
  }
}
