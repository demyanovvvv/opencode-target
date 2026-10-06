import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { installTargetFiles } from "../install-config.mjs"
import { readComponents } from "../host-components.mjs"

test("Target install and uninstall reconcile peers and roll back failed host builds", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "target-installer-"))
  const configDir = path.join(root, "config")
  try {
    await mkdir(path.join(root, "dist"))
    await writeFile(path.join(root, "package.json"), '{"version":"0.6.0"}')
    await writeFile(path.join(root, "dist/target.js"), "server")
    await writeFile(path.join(root, "dist/target-tui.js"), "tui")
    const hostInstaller = async () => {
      assert.equal((await readComponents(configDir)).target.version, "0.6.0")
    }
    await installTargetFiles({ configDir, root, hostInstaller })
    assert.equal(await readFile(path.join(configDir, "plugins/target.js"), "utf8"), "server")
    await writeFile(path.join(root, "dist/target.js"), "new server")
    await assert.rejects(installTargetFiles({ configDir, root, hostInstaller: async () => { throw new Error("build failed") } }), /build failed/)
    assert.equal(await readFile(path.join(configDir, "plugins/target.js"), "utf8"), "server")
    await assert.rejects(installTargetFiles({ configDir, root, uninstall: true, hostInstaller: async () => { throw new Error("replace failed") } }), /replace failed/)
    assert.equal((await readComponents(configDir)).target.version, "0.6.0")
    await installTargetFiles({ configDir, root, uninstall: true, hostInstaller: async () => assert.deepEqual(await readComponents(configDir), {}) })
    await assert.rejects(readFile(path.join(configDir, "plugins/target.js")), { code: "ENOENT" })
  } finally { await rm(root, { recursive: true, force: true }) }
})
