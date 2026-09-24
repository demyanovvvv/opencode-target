import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { TargetPlugin } from "../dist/target.js"

const stateDir = await mkdtemp(path.join(os.tmpdir(), "opencode-target-dist-check-"))
const client = {
  app: { log: async () => ({}) },
  session: {
    messages: async () => ({ data: [] }),
    children: async () => ({ data: [] }),
    prompt: async () => ({ data: { info: { id: "dist-prompt", role: "assistant", tokens: {} }, parts: [] } }),
  },
}
let shellCalls = 0
const executeShell = () => {
  shellCalls += 1
  return Promise.resolve({ exitCode: 0, stdout: "v22.22.2", stderr: "" })
}
executeShell.cwd = () => executeShell
executeShell.nothrow = () => executeShell
const $ = executeShell

try {
  const hooks = await TargetPlugin({ client, $, directory: process.cwd() }, {
    state_dir: stateDir,
    auto_continue: false,
    verification: [{ id: "generated", command: "node --version" }],
  })
  assert.equal(typeof hooks.tool.create_target?.execute, "function")
  const result = await hooks.tool.create_target.execute({ objective: "Validate generated plugin" }, { sessionID: "dist-check" })
  assert.match(result, /Validate generated plugin/)
  const verification = await hooks.tool.verify_target_gate.execute({ verification_id: "generated" }, { sessionID: "dist-check" })
  assert.match(verification, /Validate generated plugin/)
  assert.equal(shellCalls, 1)
} finally {
  await rm(stateDir, { recursive: true, force: true })
}

console.log("dist check: ok")
