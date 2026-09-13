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

  const [{ MissionPlugin: MissionPluginA }, { MissionPlugin: MissionPluginB }] = await Promise.all([
    import("../src/server.js?lease-instance=a"),
    import("../src/server.js?lease-instance=b"),
  ])
  let competingPromptCount = 0
  const competingClient = {
    app: client.app,
    session: {
      messages: async ({ path }) => ({ data: messages.get(path.id) || [] }),
      children: async () => ({ data: [] }),
      prompt: async ({ path }) => {
        competingPromptCount += 1
        const current = await readMission(stateDir, path.id)
        await setStoppedStatus(stateDir, path.id, "complete", "single lease owner", current.missionID)
        return { data: {
          info: {
            id: `competing-${competingPromptCount}`,
            role: "assistant",
            mode: "build",
            agent: "build",
            time: { created: Date.now(), completed: Date.now() },
            tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
          },
          parts: [{ type: "text", text: "completed by lease owner" }],
        } }
      },
    },
  }
  const options = { state_dir: stateDir, min_continue_interval_ms: 0, scheduler_lease_ms: 1000 }
  const [hooksA, hooksB] = await Promise.all([
    MissionPluginA({ client: competingClient }, options),
    MissionPluginB({ client: competingClient }, options),
  ])
  const competingOutput = { parts: [] }
  await hooksA["command.execute.before"]({ command: "mission", sessionID: "competing", arguments: "One owner" }, competingOutput)
  await Promise.all([
    hooksA.event({ event: { type: "session.idle", properties: { sessionID: "competing" } } }),
    hooksB.event({ event: { type: "session.idle", properties: { sessionID: "competing" } } }),
  ])
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(competingPromptCount, 1)
  assert.equal((await readMission(stateDir, "competing")).status, "complete")
  console.log("continuation smoke: ok")
} finally {
  await rm(stateDir, { recursive: true, force: true })
}
