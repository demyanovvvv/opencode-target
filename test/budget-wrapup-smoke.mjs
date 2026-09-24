import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { TargetPlugin } from "../src/server.js"
import { accountTargetUsage, readTarget } from "../src/core.js"

const stateDir = await mkdtemp(path.join(os.tmpdir(), "target-budget-wrapup-smoke-"))
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
  const hooks = await TargetPlugin({ client }, {
    state_dir: stateDir,
    min_continue_interval_ms: 0,
    accounting_retry: { maxAttempts: 2, baseDelayMs: 10, maxDelayMs: 10 },
  })
  const created = JSON.parse(await hooks.tool.create_target.execute(
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
  await accountTargetUsage(stateDir, "budget-wrapup", [
    { sessionID: "budget-wrapup", message: liveMessage },
  ], { expectedTargetID: created.target.targetID })
  await hooks.event({ event: { type: "session.idle", properties: { sessionID: "budget-wrapup" } } })

  const deadline = Date.now() + 10_000
  let target = await readTarget(stateDir, "budget-wrapup")
  while (Date.now() < deadline && (promptAttempts < 2 || !target?.budgetWrapupSent)) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    target = await readTarget(stateDir, "budget-wrapup")
  }
  assert.equal(promptAttempts, 2)
  assert.equal(target.status, "budget_limited")
  assert.equal(target.budgetWrapupSent, true)
  console.log("budget wrap-up smoke: ok")
} finally {
  await rm(stateDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 })
}
