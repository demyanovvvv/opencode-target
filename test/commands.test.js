import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { handleSlashCommand } from "../src/commands.js"
import { readTarget } from "../src/core.js"
import { ContextSettings } from "../src/context.js"

async function withState(run) {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "target-commands-test-"))
  try {
    return await run(stateDir)
  } finally {
    await rm(stateDir, { recursive: true, force: true })
  }
}

function dependencies() {
  return {
    collectSessionUsage: async () => [],
    getWorktreeFingerprint: async () => "fingerprint",
    targetDiagnostics: async () => "Target diagnostics\n- state: ok (no Target)",
    executeVerificationGate: async () => { throw new Error("unused") },
  }
}

test("context commands work before a Target exists, persist defaults and reject invalid arguments", async () => {
  await withState(async (stateDir) => {
    const run = (text) => handleSlashCommand({}, null, process.cwd(), stateDir, "context", text, {}, dependencies())
    assert.match(await run("context default 100k"), /100,000/)
    assert.equal(await readTarget(stateDir, "context"), null)
    assert.match(await run("context 70%"), /70%/)
    assert.equal((await new ContextSettings(stateDir).session("context")).settings.threshold.value, 70)
    await assert.rejects(run("context 100%"), /threshold/)
    assert.match(await run("help"), /context/)
  })
})

test("slash command handler creates and views a Target through explicit dependencies", async () => {
  await withState(async (stateDir) => {
    const options = {
      max_target_token_budget: 1000,
      descendant_max_depth: 6,
      descendant_max_sessions: 96,
      max_automatic_turns: null,
      max_active_seconds: null,
      max_no_progress_turns: null,
    }
    const deps = dependencies()
    const createdPrompt = await handleSlashCommand({ client: {} }, null, process.cwd(), stateDir, "commands", "Ship it", options, deps)
    assert.match(createdPrompt, /Target activated/)
    assert.equal((await readTarget(stateDir, "commands")).status, "active")

    const viewedPrompt = await handleSlashCommand({ client: {} }, null, process.cwd(), stateDir, "commands", "status", options, deps)
    assert.match(viewedPrompt, /Target control/)
    assert.match(viewedPrompt, /Ship it/)
  })
})

test("help uses configured command name and alias", async () => {
  await withState(async (stateDir) => {
    const options = {
      command_name: "mission",
      alias: "m",
      max_target_token_budget: null,
      descendant_max_depth: 6,
      descendant_max_sessions: 96,
      max_automatic_turns: null,
      max_active_seconds: null,
      max_no_progress_turns: null,
    }
    const prompt = await handleSlashCommand({ client: {} }, null, process.cwd(), stateDir, "custom-help", "help", options, dependencies())
    assert.match(prompt, /\/mission <objective>/)
    assert.match(prompt, /\/m \.\.\./)
    assert.doesNotMatch(prompt, /\/target <objective>/)
  })
})

test("slash command handler preserves pause and resume transitions", async () => {
  await withState(async (stateDir) => {
    const options = { max_target_token_budget: null, descendant_max_depth: 6, descendant_max_sessions: 96 }
    const deps = dependencies()
    await handleSlashCommand({}, null, process.cwd(), stateDir, "commands", "Objective", options, deps)
    const paused = await handleSlashCommand({}, null, process.cwd(), stateDir, "commands", "pause waiting", options, deps)
    assert.match(paused, /Target paused/)
    assert.equal((await readTarget(stateDir, "commands")).status, "paused")
    const resumed = await handleSlashCommand({}, null, process.cwd(), stateDir, "commands", "resume", options, deps)
    assert.match(resumed, /Target resumed/)
    assert.equal((await readTarget(stateDir, "commands")).status, "active")
  })
})
