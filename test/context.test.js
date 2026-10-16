import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ContextSettings, contextMeasurement, contextThresholdTokens, parseContextCommand, parseContextThreshold } from "../src/context.js"

async function withSettings(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "target-context-"))
  try { await run(new ContextSettings(dir), dir) } finally { await rm(dir, { recursive: true, force: true }) }
}

test("context thresholds accept token units and percentages and reject malformed values", () => {
  for (const [input, expected] of [
    ["100k", { kind: "tokens", value: 100000 }],
    ["100_000", { kind: "tokens", value: 100000 }],
    ["1.5M", { kind: "tokens", value: 1500000 }],
    ["70%", { kind: "percent", value: 70 }],
  ]) assert.deepEqual(parseContextThreshold(input), expected)
  for (const input of ["0", "-1", "100%", "0%", "1.2", "1__000", "100k junk", "Infinity", "9007199254740992"]) {
    assert.throws(() => parseContextThreshold(input), /threshold/i)
  }
  assert.deepEqual(parseContextCommand("default 100k"), { scope: "default", action: "set", threshold: { kind: "tokens", value: 100000 } })
  assert.deepEqual(parseContextCommand("reset"), { scope: "session", action: "reset" })
  assert.throws(() => parseContextCommand("default reset"), /Usage/)
})

test("session settings snapshot defaults, survive reload and retain thresholds through off/on", async () => {
  await withSettings(async (settings, dir) => {
    assert.equal((await settings.session("old")).settings.enabled, false)
    await settings.command("s", parseContextCommand("default 100k"))
    assert.equal((await settings.session("old")).settings.enabled, false)
    assert.deepEqual((await settings.session("s")).settings, { enabled: true, threshold: { kind: "tokens", value: 100000 } })
    await settings.command("s", parseContextCommand("70%"))
    await settings.command("s", parseContextCommand("off"))
    await new ContextSettings(dir).command("s", parseContextCommand("on"))
    assert.equal((await settings.session("s")).settings.threshold.value, 70)
    await settings.command("s", parseContextCommand("reset"))
    assert.equal((await settings.session("s")).settings.threshold.value, 100000)
    await assert.rejects(settings.command("old", parseContextCommand("on")), /threshold/i)
  })
})

test("concurrent context mutations retain independent session settings", async () => {
  await withSettings(async (settings) => {
    await Promise.all([settings.command("a", parseContextCommand("100k")), settings.command("b", parseContextCommand("70%"))])
    assert.equal((await settings.session("a")).settings.threshold.value, 100000)
    assert.equal((await settings.session("b")).settings.threshold.value, 70)
  })
})

test("context settings retain a bounded diagnostic history", async () => {
  await withSettings(async (settings) => {
    await settings.command("s", parseContextCommand("100k"))
    await settings.command("s", parseContextCommand("off"))
    const record = await settings.session("s")
    assert.deepEqual(record.runtime.events.map((event) => event.type), ["settings.changed", "settings.changed"])
  })
})

test("malformed persisted request fences are quarantined instead of silently blocking forever", async () => {
  await withSettings(async (settings) => {
    const record = await settings.session("s")
    record.runtime.pending = { id: "bad" }
    await settings.store.write("session:s", record)
    await assert.rejects(settings.session("s"), (error) => error.code === "TARGET_CONTEXT_CORRUPT")
  })
})

test("context usage includes cached tokens, follows chronology and never measures the summary input", () => {
  const msg = (id, created, tokens, summary = false) => ({ info: { id, role: "assistant", time: { created, completed: created + 1 }, providerID: "p", modelID: "m", tokens, summary } })
  const a = msg("a", 1, { input: 10000, output: 1000, reasoning: 400, cache: { read: 80000, write: 9000 } })
  assert.equal(contextMeasurement([a]).sample.tokens, 100000)
  const summary = msg("summary", 3, { input: 110000, output: 2000 }, true)
  assert.equal(contextMeasurement([summary, a]).sample, null)
  const fresh = msg("fresh", 5, { total: 24000, input: 1, output: 2 })
  assert.equal(contextMeasurement([fresh, a, summary]).sample.tokens, 24000)
  assert.equal(contextThresholdTokens({ kind: "percent", value: 70 }, { limit: { context: 200000 } }), 140000)
  assert.equal(contextThresholdTokens({ kind: "percent", value: 70 }, { limit: { context: 100000 } }), 70000)
  assert.equal(contextThresholdTokens({ kind: "percent", value: 70 }, null), null)
})
