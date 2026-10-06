import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { TargetPlugin } from "../src/server.js"
import { createTarget, readTarget } from "../src/core.js"

const stateDir = await mkdtemp(path.join(os.tmpdir(), "target-server-smoke-"))
const messages = new Map()
const children = new Map()
const shell = () => Promise.resolve({ exitCode: 0, stdout: "all checks passed", stderr: "" })
shell.cwd = () => shell
shell.nothrow = () => shell
const $ = shell
const client = {
  // OpenCode runtime clients may expose an unrelated `adapter` property; Target
  // must use its own normalized adapter rather than probing that object.
  adapter: { runtimeOnly: true },
  app: { log: async () => ({}) },
  session: {
    messages: async ({ path }) => ({ data: messages.get(path.id) || [] }),
    children: async ({ path }) => ({ data: children.get(path.id) || [] }),
    prompt: async ({ path, body }) => {
      const id = `auto-${(messages.get(path.id) || []).length}`
      const msg = {
        info: { id, role: "assistant", mode: "build", agent: "build", time: { created: Date.now(), completed: Date.now() }, tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 0, write: 0 } } },
        parts: [{ type: "text", text: `ack:${body.parts[0].text.slice(0,12)}` }],
      }
      messages.set(path.id, [...(messages.get(path.id) || []), msg])
      return { data: msg }
    },
  },
}

try {
  await assert.rejects(
    () => TargetPlugin({ client }, { state_dir: stateDir, min_continue_interval_ms: "soon" }),
    /min_continue_interval_ms/,
  )

  const hooks = await TargetPlugin({ client, $, directory: process.cwd() }, {
    state_dir: stateDir,
    auto_continue: false,
    max_target_token_budget: 1000,
    verification: [{ id: "unit", command: "npm test", requirementID: "tests" }],
  })
  const config = {}
  await hooks.config(config)
  assert.ok(config.command.target)
  assert.ok(config.command.t)
  assert.ok(hooks.tool.get_target)
  assert.ok(hooks.tool.create_target)
  assert.ok(hooks.tool.update_target)
  assert.ok(hooks.tool.add_target_evidence)
  assert.ok(hooks.tool.verify_target_gate)
  assert.ok(hooks.tool.create_target_checkpoint)

  const doctorOutput = { parts: [] }
  await hooks["command.execute.before"]({ command: "target", sessionID: "doctor", arguments: "doctor" }, doctorOutput)
  assert.match(doctorOutput.parts[0].text, /Target diagnostics/)
  assert.match(doctorOutput.parts[0].text, /state: ok/)
  assert.match(doctorOutput.parts[0].text, /messages API: ok/)
  assert.match(doctorOutput.parts[0].text, /children API: ok/)
  await createTarget(stateDir, "doctor-active", "Doctor lifecycle")
  const activeDoctorOutput = { parts: [] }
  await hooks["command.execute.before"]({ command: "target", sessionID: "doctor-active", arguments: "doctor" }, activeDoctorOutput)
  assert.match(activeDoctorOutput.parts[0].text, /schema 3/)
  assert.match(activeDoctorOutput.parts[0].text, /scheduler lease: none/)
  assert.match(activeDoctorOutput.parts[0].text, /accounting: ok/)

  const failingClient = {
    app: client.app,
    session: {
      messages: async () => { throw new Error("messages unavailable") },
      children: async () => { throw new Error("children unavailable") },
      prompt: client.session.prompt,
    },
  }
  const failingHooks = await TargetPlugin({ client: failingClient }, { state_dir: stateDir, auto_continue: false })
  const failingDoctorOutput = { parts: [] }
  await failingHooks["command.execute.before"]({ command: "target", sessionID: "doctor-errors", arguments: "doctor" }, failingDoctorOutput)
  assert.match(failingDoctorOutput.parts[0].text, /messages API: error/)
  assert.match(failingDoctorOutput.parts[0].text, /children API: error/)

  const failedActivationOutput = { parts: [] }
  await failingHooks["command.execute.before"](
    { command: "target", sessionID: "failed-command-activation", arguments: "Must remain absent" },
    failedActivationOutput,
  )
  assert.match(failedActivationOutput.parts[0].text, /messages API failed/)
  assert.equal(await readTarget(stateDir, "failed-command-activation"), null)

  await assert.rejects(
    failingHooks.tool.create_target.execute(
      { objective: "Tool activation must remain absent" },
      { sessionID: "failed-tool-activation" },
    ),
    /messages API failed/,
  )
  assert.equal(await readTarget(stateDir, "failed-tool-activation"), null)

  const malformedClient = {
    app: client.app,
    session: {
      messages: async () => ({ data: { not: "a list" } }),
      children: async () => ({ data: [] }),
      prompt: client.session.prompt,
    },
  }
  const malformedHooks = await TargetPlugin({ client: malformedClient }, { state_dir: stateDir, auto_continue: false })
  const malformedOutput = { parts: [] }
  await malformedHooks["command.execute.before"](
    { command: "target", sessionID: "malformed-activation", arguments: "Reject malformed accounting" },
    malformedOutput,
  )
  assert.match(malformedOutput.parts[0].text, /expected an array/)
  assert.equal(await readTarget(stateDir, "malformed-activation"), null)

  const malformedTarget = await createTarget(stateDir, "malformed-get", "Live accounting must fail closed")
  const malformedGetOutput = await assert.rejects(
    malformedHooks.tool.get_target.execute({}, { sessionID: "malformed-get" }),
    (error) => error.code === "OPENCODE_MESSAGES_FAILED",
  )
  assert.equal(malformedGetOutput, undefined)
  assert.equal((await readTarget(stateDir, "malformed-get")).targetID, malformedTarget.targetID)

  const output = { parts: [{ type: "text", text: "old" }] }
  await hooks["command.execute.before"]({ command: "target", sessionID: "s", arguments: "Ship verified feature" }, output)
  assert.equal(output.parts.length, 1)
  assert.match(output.parts[0].text, /Target activated/)
  assert.match(output.parts[0].text, /Continue working toward the active session Target/)

  const state = JSON.parse(await hooks.tool.get_target.execute({}, { sessionID: "s" }))
  assert.equal(state.target.status, "active")
  assert.equal(state.target.tokenBudget, 1000)

  const pauseOut = { parts: [] }
  await hooks["command.execute.before"]({ command: "t", sessionID: "s", arguments: "pause" }, pauseOut)
  assert.match(pauseOut.parts[0].text, /Target paused/)

  const resumedOut = { parts: [] }
  await hooks["command.execute.before"]({ command: "target", sessionID: "s", arguments: "resume" }, resumedOut)
  assert.match(resumedOut.parts[0].text, /Target resumed/)

  const requirementResult = await hooks.tool.create_target.execute({
    objective: "Ship with evidence",
    requirements: [{ id: "tests", text: "Tests pass" }],
  }, { sessionID: "requirements" })
  assert.equal(JSON.parse(requirementResult).target.requirements[0].status, "open")
  const verifyOutput = { parts: [] }
  await hooks["command.execute.before"]({ command: "target", sessionID: "requirements", arguments: "verify unit" }, verifyOutput)
  assert.match(verifyOutput.parts[0].text, /unit: passed/)
  const historyOutput = { parts: [] }
  await hooks["command.execute.before"]({ command: "target", sessionID: "requirements", arguments: "history" }, historyOutput)
  assert.match(historyOutput.parts[0].text, /Target history/)
  const reportOutput = { parts: [] }
  await hooks["command.execute.before"]({ command: "target", sessionID: "requirements", arguments: "report" }, reportOutput)
  assert.match(reportOutput.parts[0].text, /requirements/)
  const completionResult = await hooks.tool.update_target.execute({ status: "complete" }, { sessionID: "requirements" })
  assert.equal(JSON.parse(completionResult).target.status, "complete")

  const hangingHooks = await TargetPlugin({
    client: {
      app: client.app,
      session: {
        messages: async () => new Promise(() => {}),
        children: async () => ({ data: [] }),
        prompt: client.session.prompt,
      },
    },
  }, {
    state_dir: stateDir,
    host_api_timeout_ms: 10,
    accounting_retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 },
  })
  await createTarget(stateDir, "hanging-api", "Pause after a hanging host API")
  await hangingHooks.event({ event: { type: "session.idle", properties: { sessionID: "hanging-api" } } })
  await hangingHooks.whenIdle("hanging-api")
  assert.equal((await readTarget(stateDir, "hanging-api")).status, "paused")

  const providerFailureHooks = await TargetPlugin({
    client: {
      app: client.app,
      session: {
        messages: async () => ({ data: [] }),
        children: async () => ({ data: [] }),
        prompt: async () => { throw new Error("Provider returned empty content") },
      },
    },
  }, {
    state_dir: stateDir,
    min_continue_interval_ms: 0,
    accounting_retry: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 },
  })
  await createTarget(stateDir, "provider-failure", "Stop after provider failure")
  await providerFailureHooks.event({ event: { type: "session.idle", properties: { sessionID: "provider-failure" } } })
  await providerFailureHooks.whenIdle("provider-failure")
  const providerFailureTarget = await readTarget(stateDir, "provider-failure")
  assert.equal(providerFailureTarget.status, "paused")
  assert.match(providerFailureTarget.stopReason, /Continuation host API unavailable/)

  const unexpectedFailureHooks = await TargetPlugin({
    client: {
      app: client.app,
      session: {
        messages: async () => ({ data: [] }),
        children: async () => ({ data: [] }),
        prompt: async () => ({ data: { info: null, parts: null } }),
      },
    },
  }, { state_dir: stateDir, min_continue_interval_ms: 0 })
  await createTarget(stateDir, "unexpected-failure", "Stop after unexpected continuation failure")
  await unexpectedFailureHooks.event({ event: { type: "session.idle", properties: { sessionID: "unexpected-failure" } } })
  await unexpectedFailureHooks.whenIdle("unexpected-failure")
  const unexpectedFailureTarget = await readTarget(stateDir, "unexpected-failure")
  assert.equal(unexpectedFailureTarget.status, "paused")
  assert.match(unexpectedFailureTarget.stopReason, /Continuation host API unavailable/)

  console.log("server smoke: ok")
} finally {
  await rm(stateDir, { recursive: true, force: true })
}
