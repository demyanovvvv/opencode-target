import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { MissionPlugin } from "../src/server.js"

const stateDir = await mkdtemp(path.join(os.tmpdir(), "mission-server-smoke-"))
const messages = new Map()
const children = new Map()
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
  const hooks = await MissionPlugin({ client }, { state_dir: stateDir, auto_continue: false, max_mission_token_budget: 1000 })
  const config = {}
  await hooks.config(config)
  assert.ok(config.command.mission)
  assert.ok(config.command.msn)
  assert.ok(hooks.tool.get_mission)
  assert.ok(hooks.tool.create_mission)
  assert.ok(hooks.tool.update_mission)

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

  console.log("server smoke: ok")
} finally {
  await rm(stateDir, { recursive: true, force: true })
}
