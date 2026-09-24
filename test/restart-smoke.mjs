import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { TargetPlugin } from "../src/server.js"
import { readTarget } from "../src/core.js"

const stateDir = await mkdtemp(path.join(os.tmpdir(), "target-restart-smoke-"))
let prompts = 0
const message = () => ({
  info: {
    id: `restart-${prompts}`,
    role: "assistant",
    mode: "build",
    agent: "build",
    time: { created: Date.now(), completed: Date.now() },
    tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
  },
  parts: [{ type: "text", text: "Restart continuation" }],
})
const client = {
  app: { log: async () => ({}) },
  session: {
    messages: async () => ({ data: [] }),
    children: async () => ({ data: [] }),
    prompt: async () => {
      prompts += 1
      return { data: message() }
    },
  },
}

try {
  const first = await TargetPlugin({ client }, { state_dir: stateDir, min_continue_interval_ms: 0 })
  await first.tool.create_target.execute({ objective: "Continue after restart" }, { sessionID: "restart" })
  const beforeRestart = await readTarget(stateDir, "restart")
  assert.equal(beforeRestart.status, "active")

  const second = await TargetPlugin({ client }, { state_dir: stateDir, min_continue_interval_ms: 0 })
  await second.event({ event: { type: "session.idle", properties: { sessionID: "restart" } } })
  const deadline = Date.now() + 10_000
  while (prompts < 1 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(prompts, 1)
  assert.equal((await readTarget(stateDir, "restart")).continuationCount, 1)
  console.log("restart smoke: ok")
} finally {
  await rm(stateDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 })
}
