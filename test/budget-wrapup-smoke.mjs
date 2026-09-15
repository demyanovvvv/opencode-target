import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { MissionPlugin } from "../src/server.js"
import { accountMissionUsage, readMission } from "../src/core.js"

const stateDir = await mkdtemp(path.join(os.tmpdir(), "mission-budget-wrapup-smoke-"))
let promptAttempts = 0
let liveMessage = null
const client = {
  app: { log: async () => ({}) },
  session: {
    messages: async () => ({ data: liveMessage ? [liveMessage] : [] }),
    children: async () => ({ data: [] }),
    prompt: async () => {
      promptAttempts += 1
      if (promptAttempts === 1) return { data: { malformed: true } }
      return {
        data: {
          info: {
            id: "budget-wrapup-response",
            role: "assistant",
            mode: "build",
            agent: "build",
            time: { created: Date.now(), completed: Date.now() },
            tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
          },
          parts: [{ type: "text", text: "Budget wrap-up delivered" }],
        },
      }
    },
  },
}

try {
  const hooks = await MissionPlugin({ client }, {
    state_dir: stateDir,
    min_continue_interval_ms: 0,
    accounting_retry: { maxAttempts: 2, baseDelayMs: 10, maxDelayMs: 10 },
  })
  const created = JSON.parse(await hooks.tool.create_mission.execute(
    { objective: "Deliver a budget wrap-up", token_budget: 1 },
    { sessionID: "budget-wrapup" },
  ))
  liveMessage = {
    info: {
      id: "budget-crossing",
      role: "assistant",
      mode: "build",
      agent: "build",
      time: { created: Date.now(), completed: Date.now() },
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [{ type: "text", text: "Budget crossing" }],
  }
  await accountMissionUsage(stateDir, "budget-wrapup", [
    { sessionID: "budget-wrapup", message: liveMessage },
  ], { expectedMissionID: created.mission.missionID })
  await hooks.event({ event: { type: "session.idle", properties: { sessionID: "budget-wrapup" } } })

  const deadline = Date.now() + 2_000
  let mission = await readMission(stateDir, "budget-wrapup")
  while (Date.now() < deadline && (promptAttempts < 2 || !mission?.budgetWrapupSent)) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    mission = await readMission(stateDir, "budget-wrapup")
  }
  assert.equal(promptAttempts, 2)
  assert.equal(mission.status, "budget_limited")
  assert.equal(mission.budgetWrapupSent, true)
  console.log("budget wrap-up smoke: ok")
} finally {
  await rm(stateDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 })
}
