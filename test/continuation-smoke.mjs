import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { MissionPlugin } from "../src/server.js"
import { readMission, setStoppedStatus } from "../src/core.js"

const stateDir = await mkdtemp(path.join(os.tmpdir(), "mission-loop-smoke-"))
const messages = new Map()
let promptCount = 0
const client = {
  app: { log: async () => ({}) },
  session: {
    messages: async ({ path }) => ({ data: messages.get(path.id) || [] }),
    children: async () => ({ data: [] }),
    prompt: async ({ path }) => {
      promptCount += 1
      const msg = {
        info: {
          id: `auto-${promptCount}`,
          role: "assistant",
          mode: "build",
          agent: "build",
          time: { created: Date.now(), completed: Date.now() },
          tokens: { input: 25, output: 10, reasoning: 0, cache: { read: 5, write: 0 } },
        },
        parts: [{ type: "text", text: `continuation ${promptCount}` }],
      }
      messages.set(path.id, [...(messages.get(path.id) || []), msg])
      if (promptCount === 2) {
        const current = await readMission(stateDir, path.id)
        await setStoppedStatus(stateDir, path.id, "complete", "smoke verified", current.missionID)
      }
      return { data: msg }
    },
  },
}

try {
  const hooks = await MissionPlugin({ client }, { state_dir: stateDir, min_continue_interval_ms: 20 })
  const output = { parts: [] }
  await hooks["command.execute.before"]({ command: "mission", sessionID: "loop", arguments: "Finish after two mocked turns" }, output)
  await hooks.event({ event: { type: "session.idle", properties: { sessionID: "loop" } } })
  await new Promise((resolve) => setTimeout(resolve, 300))
  const final = await readMission(stateDir, "loop")
  assert.equal(promptCount, 2)
  assert.equal(final.status, "complete")
  assert.equal(final.continuationCount, 2)
  assert.equal(final.tokensUsed, 60)
  console.log("continuation smoke: ok")
} finally {
  await rm(stateDir, { recursive: true, force: true })
}
