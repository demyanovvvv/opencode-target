import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, readFile, rm, writeFile, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as coordination from "../host-components.mjs"
const { registerComponent } = coordination

test("parallel installers preserve both component registrations", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "host-coordination-"))
  try {
    await Promise.all([
      registerComponent(dir, "patchline", { version: "1.2.0", files: ["package.json"] }),
      registerComponent(dir, "target", { version: "0.5.0", files: ["plugins/target.js"] }),
    ])
    const manifest = JSON.parse(await readFile(path.join(dir, "host-components.json"), "utf8"))
    assert.deepEqual(Object.keys(manifest.components).sort(), ["patchline", "target"])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("failed build leaves installed intent distinct from the last successful host", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "host-coordination-"))
  try {
    assert.equal(typeof coordination.reconcileHost, "function")
    await registerComponent(dir, "target", { version: "0.5.0", files: ["target.js"] })
    await writeFile(path.join(dir, "target.js"), "plugin")
    await assert.rejects(coordination.reconcileHost(dir, "1.18.34", {
      build: async () => { throw new Error("build failed") },
      install: async () => assert.fail("installed failed build"),
    }), /build failed/)
    const manifest = JSON.parse(await readFile(path.join(dir, "host-components.json"), "utf8"))
    assert.equal(manifest.components.target.version, "0.5.0")
    assert.equal(manifest.host, undefined)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("failed verification rolls back binary and never commits successful composition", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "host-coordination-"))
  try {
    assert.equal(typeof coordination.reconcileHost, "function")
    let restored = false
    await assert.rejects(coordination.reconcileHost(dir, "1.18.34", {
      build: async () => "binary",
      install: async () => async () => { restored = true },
      verify: async () => { throw new Error("wrong executable") },
    }), /wrong executable/)
    assert.equal(restored, true)
    await assert.rejects(readFile(path.join(dir, "host-components.json")), { code: "ENOENT" })
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("registration refuses a symlink manifest and preserves its destination", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "host-coordination-"))
  try {
    const destination = path.join(dir, "other.json")
    const original = JSON.stringify({ schema: 1, components: {} })
    await writeFile(destination, original)
    await symlink(destination, path.join(dir, "host-components.json"))
    await assert.rejects(registerComponent(dir, "target", { version: "0.5.0", files: ["plugins/target.js"] }), /symlink/i)
    assert.equal(await readFile(destination, "utf8"), original)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
