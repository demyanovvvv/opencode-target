import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ContextSettings, parseContextCommand } from "../src/context.js"
import { ContextCompactor } from "../src/context-compaction.js"
import { createTarget, readTarget, recordTargetTurnOutcomes, setStoppedStatus, setTargetBudget } from "../src/core.js"

const message = (id, tokens, at = Date.now(), summary = false) => ({ info: { id, role: "assistant", sessionID: "s", providerID: "p", modelID: "m", time: { created: at, completed: at + 1 }, tokens: { input: tokens, output: 0, cache: { read: 0, write: 0 } }, summary } })

test("compaction summaries do not consume pending automatic work or alter progress streaks", async () => {
  await fixture(async ({ dir }) => {
    const before = await readTarget(dir, "s")
    const after = await recordTargetTurnOutcomes(dir, "s", [message("summary-only", 110000, Date.now() + 10, true)], { expectedTargetID: before.targetID, automatic: true })
    assert.equal(after.runtime.noProgressStreak, before.runtime.noProgressStreak)
    assert.equal(after.runtime.emptyAutomaticStreak, before.runtime.emptyAutomaticStreak)
  })
})

async function fixture(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "target-compaction-"))
  const settings = new ContextSettings(dir)
  await settings.command("s", parseContextCommand("100k"))
  await createTarget(dir, "s", "Keep the full objective")
  const history = [message("work", 100000)]
  const calls = []
  let finish
  const adapter = {
    messages: async () => history,
    model: async () => ({ limit: { context: 200000 } }),
    summarize: (sessionID, model) => { calls.push({ sessionID, model }); return new Promise((resolve) => { finish = resolve }) },
  }
  const controller = new ContextCompactor({ stateDir: dir, settings, adapter, timeoutMs: 10000 })
  try { await run({ dir, settings, history, calls, controller, finish: () => finish?.(true) }) }
  finally { controller.dispose(); finish?.(true); await rm(dir, { recursive: true, force: true }) }
}

test("context threshold queues exactly one native compaction and waits for its result", async () => {
  await fixture(async ({ dir, controller, calls, history, finish }) => {
    assert.equal(await controller.check("s"), true)
    assert.equal(await controller.check("s"), true)
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0], { sessionID: "s", model: { providerID: "p", modelID: "m" } })
    history.push(message("summary", 120000, Date.now() + 10, true))
    finish()
    await controller.settled("s")
    assert.equal(await controller.check("s"), false)
    assert.equal((await readTarget(dir, "s")).objective, "Keep the full objective")
  })
})

test("compaction does not loop when the first fresh context still exceeds the threshold", async () => {
  await fixture(async ({ controller, history, calls, finish, settings }) => {
    await controller.check("s")
    const at = Date.now() + 10
    history.push(message("summary", 120000, at, true))
    finish()
    await controller.settled("s")
    history.push(message("too-large", 105000, at + 10))
    await controller.check("s")
    await controller.check("s")
    assert.equal(calls.length, 1)
    assert.match((await settings.session("s")).runtime.reason, /threshold/i)
    history.push(message("small", 80000, at + 20))
    await controller.check("s")
    history.push(message("large-again", 100000, at + 30))
    await controller.check("s")
    assert.equal(calls.length, 2)
  })
})

test("paused targets and disabled session settings never request compaction", async () => {
  await fixture(async ({ dir, controller, calls, settings }) => {
    await settings.command("s", parseContextCommand("off"))
    assert.equal(await controller.check("s"), false)
    await settings.command("s", parseContextCommand("on"))
    const target = await readTarget(dir, "s")
    await setStoppedStatus(dir, "s", "paused", "user", target.targetID)
    assert.equal(await controller.check("s"), false)
    assert.equal(calls.length, 0)
  })
})

test("a restarted controller reconciles a completed summary without submitting twice", async () => {
  await fixture(async ({ dir, controller, settings, history, calls }) => {
    await controller.check("s")
    controller.dispose()
    history.push(message("summary", 120000, Date.now() + 10, true))
    const restarted = new ContextCompactor({ stateDir: dir, settings, adapter: { messages: async () => history, model: async () => null, summarize: async () => { throw new Error("duplicate") } } })
    try {
      assert.equal(await restarted.check("s"), false)
      assert.equal((await settings.session("s")).runtime.pending, null)
      assert.equal(calls.length, 1)
    } finally { restarted.dispose() }
  })
})

test("a manual compaction in progress prevents an additional automatic request", async () => {
  await fixture(async ({ controller, calls, history }) => {
    await controller.compacting("s")
    assert.equal(await controller.check("s"), true)
    assert.equal(calls.length, 0)
    history.push(message("manual-summary", 110000, Date.now() + 10, true))
    assert.equal(await controller.check("s"), false)
  })
})

test("simultaneous controllers share the durable compaction fence", async () => {
  await fixture(async ({ dir, settings, history, controller, calls }) => {
    const other = new ContextCompactor({ stateDir: dir, settings, adapter: {
      messages: async () => history, model: async () => null,
      summarize: async () => { calls.push("duplicate") },
    } })
    try {
      await Promise.all([controller.check("s"), other.check("s")])
      assert.equal(calls.length, 1)
    } finally { other.dispose() }
  })
})

test("uncertain compaction pauses the old Target without retrying the native request", async () => {
  await fixture(async ({ dir, controller, settings, calls }) => {
    controller.adapter.summarize = async () => {
      calls.push("request")
      const error = new Error("transport timed out")
      error.code = "OPENCODE_COMPACTION_UNCERTAIN"
      throw error
    }
    await controller.check("s")
    await controller.settled("s")
    assert.equal((await readTarget(dir, "s")).status, "paused")
    assert.ok((await settings.session("s")).runtime.pending)
    assert.equal(calls.length, 1)
  })
})

test("native failures retry at most three times and then pause", async () => {
  await fixture(async ({ dir, controller, settings, calls }) => {
    controller.adapter.summarize = async () => { calls.push("request"); throw new Error("host rejected request") }
    for (let i = 0; i < 3; i += 1) {
      await settings.mutate("s", (record) => { record.runtime.nextRetryAtMs = 0; return record })
      await controller.check("s")
      await controller.settled("s")
    }
    assert.equal(calls.length, 3)
    assert.equal((await readTarget(dir, "s")).status, "paused")
  })
})

test("percent thresholds follow the newly selected user model rather than the previous response model", async () => {
  await fixture(async ({ settings, controller, history, calls }) => {
    await settings.command("s", parseContextCommand("70%"))
    history[0].info.tokens.input = 80000
    history.push({ info: { id: "new-model", role: "user", time: { created: Date.now() + 10 }, model: { providerID: "p2", modelID: "small" } }, parts: [] })
    controller.adapter.model = async (provider, model) => {
      assert.equal(provider, "p2")
      assert.equal(model, "small")
      return { limit: { context: 100000 } }
    }
    await controller.check("s")
    assert.deepEqual(calls[0].model, { providerID: "p2", modelID: "small" })
  })
})

test("pausing and replacing a Target while compaction fails cannot pause the replacement", async () => {
  await fixture(async ({ dir, controller, calls }) => {
    let reject
    controller.adapter.summarize = () => { calls.push("request"); return new Promise((_resolve, fail) => { reject = fail }) }
    await controller.check("s")
    const old = await readTarget(dir, "s")
    await setStoppedStatus(dir, "s", "complete", "done", old.targetID)
    const replacement = await createTarget(dir, "s", "New lifecycle")
    const error = new Error("uncertain")
    error.code = "OPENCODE_COMPACTION_UNCERTAIN"
    reject(error)
    await controller.settled("s")
    assert.equal((await readTarget(dir, "s")).targetID, replacement.targetID)
    assert.equal((await readTarget(dir, "s")).status, "active")
  })
})

test("a settings change during model lookup invalidates the old threshold decision", async () => {
  await fixture(async ({ controller, settings, calls }) => {
    let release
    let started
    const ready = new Promise((resolve) => { started = resolve })
    controller.adapter.model = async () => { started(); return new Promise((resolve) => { release = resolve }) }
    const check = controller.check("s")
    await ready
    await settings.command("s", parseContextCommand("200k"))
    release({ limit: { context: 200000 } })
    await check
    assert.equal(calls.length, 0)
  })
})

test("usage crossing the Target budget prevents compaction from being submitted", async () => {
  await fixture(async ({ dir, controller, calls }) => {
    await setTargetBudget(dir, "s", 1000)
    assert.equal(await controller.check("s"), false)
    assert.equal(calls.length, 0)
    assert.equal((await readTarget(dir, "s")).status, "budget_limited")
  })
})

test("input boundaries and unknown percent windows defer compaction without guessing", async () => {
  await fixture(async ({ controller, settings, calls }) => {
    controller.pendingInput = () => true
    assert.equal(await controller.check("s"), false)
    assert.equal(calls.length, 0)
    controller.pendingInput = () => false
    controller.adapter.model = async () => null
    await settings.command("s", parseContextCommand("70%"))
    assert.equal(await controller.check("s"), false)
    assert.match((await settings.session("s")).runtime.reason, /unavailable/)
    assert.equal(calls.length, 0)
  })
})

test("an in-flight compaction remains fenced after the Target budget stops work", async () => {
  await fixture(async ({ dir, controller, history, finish }) => {
    await controller.check("s")
    const current = await readTarget(dir, "s")
    await setStoppedStatus(dir, "s", "budget_limited", "budget", current.targetID)
    assert.equal(await controller.check("s"), true)
    history.push(message("summary", 110000, Date.now() + 10, true))
    finish()
    await controller.settled("s")
    assert.equal(await controller.check("s"), false)
  })
})
