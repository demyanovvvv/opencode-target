import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { installTargetFiles } from "../install-config.mjs"

test("stock Target install and updates never rebuild the host", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "target-installer-"))
  const configDir = path.join(root, "config")
  try {
    await mkdir(path.join(root, "dist"))
    await writeFile(path.join(root, "package.json"), '{"version":"0.6.0"}')
    await writeFile(path.join(root, "dist/target.js"), "server")
    await writeFile(path.join(root, "dist/target-tui.js"), "tui")
    await mkdir(configDir, { recursive: true })
    const unrelated = '{"components":{"external":{"version":"1.0.0"}}}'
    await writeFile(path.join(configDir, "host-components.json"), unrelated)
    await installTargetFiles({ configDir, root })
    assert.equal(await readFile(path.join(configDir, "plugins/target.js"), "utf8"), "server")
    await writeFile(path.join(root, "dist/target.js"), "new server")
    await installTargetFiles({ configDir, root })
    assert.equal(await readFile(path.join(configDir, "plugins/target.js"), "utf8"), "new server")
    assert.equal(await readFile(path.join(configDir, "host-components.json"), "utf8"), unrelated)
    await installTargetFiles({ configDir, root, uninstall: true, stateDir: path.join(root, "state") })
    assert.equal(await readFile(path.join(configDir, "host-components.json"), "utf8"), unrelated)
    await assert.rejects(readFile(path.join(configDir, "plugins/target.js")), { code: "ENOENT" })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("failed file installation restores plugin/config bytes and releases its lock", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "target-rollback-"))
  const configDir = path.join(root, "config")
  try {
    await mkdir(path.join(root, "dist"))
    await mkdir(path.join(configDir, "plugins"), { recursive: true })
    await writeFile(path.join(configDir, "plugins/target.js"), "previous")
    await writeFile(path.join(root, "dist/target.js"), "replacement")
    await assert.rejects(installTargetFiles({ configDir, root }), { code: "ENOENT" })
    assert.equal(await readFile(path.join(configDir, "plugins/target.js"), "utf8"), "previous")
    await assert.rejects(readFile(path.join(configDir, ".target-install.lock")), { code: "ENOENT" })
  } finally { await rm(root, { recursive: true, force: true }) }
})

