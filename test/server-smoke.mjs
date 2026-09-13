import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { MissionPlugin } from "../src/server.js"

const stateDir = await mkdtemp(path.join(os.tmpdir(), "mission-server-smoke-"))
const messages = new Map()
const children = new Map()
const shell = () => Promise.resolve({ exitCode: 0, stdout: "all checks passed", stderr: "" })
shell.cwd = () => shell
shell.nothrow = () => shell
const $ = shell
const client = {
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
    () => MissionPlugin({ client }, { state_dir: stateDir, min_continue_interval_ms: "soon" }),
    /min_continue_interval_ms/,
  )

  const hooks = await MissionPlugin({ client, $, directory: process.cwd() }, {
    state_dir: stateDir,
    auto_continue: false,
    max_mission_token_budget: 1000,
    verification: [{ id: "unit", command: "npm test", requirementID: "tests" }],
  })
  const config = {}
  await hooks.config(config)
  assert.ok(config.command.mission)
  assert.ok(config.command.msn)
  assert.ok(hooks.tool.get_mission)
  assert.ok(hooks.tool.create_mission)
  assert.ok(hooks.tool.update_mission)
  assert.ok(hooks.tool.add_mission_evidence)
  assert.ok(hooks.tool.verify_mission_gate)
  assert.ok(hooks.tool.create_mission_checkpoint)

  const doctorOutput = { parts: [] }
  await hooks["command.execute.before"]({ command: "mission", sessionID: "doctor", arguments: "doctor" }, doctorOutput)
  assert.match(doctorOutput.parts[0].text, /Mission diagnostics/)
  assert.match(doctorOutput.parts[0].text, /state: ok/)
  assert.match(doctorOutput.parts[0].text, /messages API: ok/)
  assert.match(doctorOutput.parts[0].text, /children API: ok/)

  const failingClient = {
    app: client.app,
    session: {
      messages: async () => { throw new Error("messages unavailable") },
      children: async () => { throw new Error("children unavailable") },
      prompt: client.session.prompt,
    },
  }
  const failingHooks = await MissionPlugin({ client: failingClient }, { state_dir: stateDir, auto_continue: false })
  const failingDoctorOutput = { parts: [] }
  await failingHooks["command.execute.before"]({ command: "mission", sessionID: "doctor-errors", arguments: "doctor" }, failingDoctorOutput)
  assert.match(failingDoctorOutput.parts[0].text, /messages API: error/)
  assert.match(failingDoctorOutput.parts[0].text, /children API: error/)

  const output = { parts: [{ type: "text", text: "old" }] }
  await hooks["command.execute.before"]({ command: "mission", sessionID: "s", arguments: "Ship verified feature" }, output)
  assert.equal(output.parts.length, 1)
  assert.match(output.parts[0].text, /Mission activated/)
  assert.match(output.parts[0].text, /Continue working toward the active session Mission/)

  const state = JSON.parse(await hooks.tool.get_mission.execute({}, { sessionID: "s" }))
  assert.equal(state.mission.status, "active")
  assert.equal(state.mission.tokenBudget, 1000)

  const pauseOut = { parts: [] }
  await hooks["command.execute.before"]({ command: "msn", sessionID: "s", arguments: "pause" }, pauseOut)
  assert.match(pauseOut.parts[0].text, /Mission paused/)

  const resumedOut = { parts: [] }
  await hooks["command.execute.before"]({ command: "mission", sessionID: "s", arguments: "resume" }, resumedOut)
  assert.match(resumedOut.parts[0].text, /Mission resumed/)

  const requirementResult = await hooks.tool.create_mission.execute({
    objective: "Ship with evidence",
    requirements: [{ id: "tests", text: "Tests pass" }],
  }, { sessionID: "requirements" })
  assert.equal(JSON.parse(requirementResult).mission.requirements[0].status, "open")
  const verifyOutput = { parts: [] }
  await hooks["command.execute.before"]({ command: "mission", sessionID: "requirements", arguments: "verify unit" }, verifyOutput)
  assert.match(verifyOutput.parts[0].text, /unit: passed/)
  const historyOutput = { parts: [] }
  await hooks["command.execute.before"]({ command: "mission", sessionID: "requirements", arguments: "history" }, historyOutput)
  assert.match(historyOutput.parts[0].text, /Mission history/)
  const reportOutput = { parts: [] }
  await hooks["command.execute.before"]({ command: "mission", sessionID: "requirements", arguments: "report" }, reportOutput)
  assert.match(reportOutput.parts[0].text, /requirements/)
  const completionResult = await hooks.tool.update_mission.execute({ status: "complete" }, { sessionID: "requirements" })
  assert.equal(JSON.parse(completionResult).mission.status, "complete")

  console.log("server smoke: ok")
} finally {
  await rm(stateDir, { recursive: true, force: true })
}
