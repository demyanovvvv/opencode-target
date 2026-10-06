import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { registerComponent, readComponents } from "../host-components.mjs"

test("component files cannot escape the configuration directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "host-paths-"))
  const dir = path.join(root, "config")
  try {
    await writeFile(path.join(root, "outside.js"), "plugin")
    await assert.rejects(registerComponent(dir, "target", { version: "0.5.0", files: ["../outside.js"] }), /path/i)
    // A legacy/tampered record must receive the same validation on reads.
    await writeFile(path.join(dir, "host-components.json"), JSON.stringify({ schema: 1, components: { target: { version: "0.5.0", files: ["../outside.js"] } } }))
    await assert.rejects(readComponents(dir), /path/i)
  } finally { await rm(root, { recursive: true, force: true }) }
})
