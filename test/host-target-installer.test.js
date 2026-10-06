import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { installTargetFiles } from "../install-config.mjs"
import { readComponents } from "../host-components.mjs"

test("stock Target install and updates never rebuild the host", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "target-installer-"))
  const configDir = path.join(root, "config")
  try {
    await mkdir(path.join(root, "dist"))
    await writeFile(path.join(root, "package.json"), '{"version":"0.6.0"}')
    await writeFile(path.join(root, "dist/target.js"), "server")
    await writeFile(path.join(root, "dist/target-tui.js"), "tui")
    const hostInstaller = async () => { assert.fail("stock Target must not rebuild OpenCode") }
    await installTargetFiles({ configDir, root, hostInstaller })
    assert.equal(await readFile(path.join(configDir, "plugins/target.js"), "utf8"), "server")
    await writeFile(path.join(root, "dist/target.js"), "new server")
    await installTargetFiles({ configDir, root, hostInstaller })
    assert.equal(await readFile(path.join(configDir, "plugins/target.js"), "utf8"), "new server")
    assert.equal((await readComponents(configDir)).target.requiresHost, false)
    await installTargetFiles({ configDir, root, uninstall: true, hostInstaller })
    assert.deepEqual(await readComponents(configDir), {})
    await assert.rejects(readFile(path.join(configDir, "plugins/target.js")), { code: "ENOENT" })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("legacy Target host migrates once and preserves peer intent with rollback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "target-migration-"))
  const configDir = path.join(root, "config")
  try {
    await mkdir(path.join(root, "dist"))
    await mkdir(configDir)
    await writeFile(path.join(root, "package.json"), '{"version":"0.6.0"}')
    await writeFile(path.join(root, "dist/target.js"), "server")
    await writeFile(path.join(root, "dist/target-tui.js"), "tui")
    const legacy = { schema: 1, components: { patchline: { version: "1.2.0", files: [] } }, host: { version: "1.18.34+target.0.5.0" } }
    await writeFile(path.join(configDir, "host-components.json"), JSON.stringify(legacy))
    await assert.rejects(installTargetFiles({ configDir, root, hostInstaller: async () => { throw new Error("migration failed") } }), /migration failed/)
    assert.deepEqual(JSON.parse(await readFile(path.join(configDir, "host-components.json"), "utf8")), legacy)
    let calls = 0
    const migrate = async () => {
      calls += 1
      const file = path.join(configDir, "host-components.json")
      const manifest = JSON.parse(await readFile(file, "utf8"))
      assert.equal(manifest.components.target.requiresHost, false)
      assert.equal(manifest.components.patchline.version, "1.2.0")
      manifest.host.version = "1.18.34+patchline.1.2.0"
      await writeFile(file, JSON.stringify(manifest))
    }
    await installTargetFiles({ configDir, root, hostInstaller: migrate })
    await installTargetFiles({ configDir, root, hostInstaller: migrate })
    assert.equal(calls, 1)
  } finally { await rm(root, { recursive: true, force: true }) }
})
