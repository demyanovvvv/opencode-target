import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { installedStateDir, shadowedByLocalInstall } from "../src/install-state.js"

test("server and TUI use the same installed state and local installation shadows only global plugins", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "target-install-state-"))
  try {
    const config = path.join(root, "project/.opencode")
    await mkdir(path.join(config, "target"), { recursive: true })
    const state = path.join(config, "target/state")
    await writeFile(path.join(config, "target/package.json"), JSON.stringify({ name: "opencode-target", scope: "local", stateDir: state }))
    const server = pathToFileURL(path.join(config, "plugins/target.js")).href
    const tui = pathToFileURL(path.join(config, "tui-plugins/target.js")).href
    assert.equal(await installedStateDir(server), state)
    assert.equal(await installedStateDir(tui), state)
    const project = path.join(root, "project/subfolder")
    assert.equal(await shadowedByLocalInstall(server, project), false)
    assert.equal(await shadowedByLocalInstall(tui, project), false)
    assert.equal(await shadowedByLocalInstall(pathToFileURL(path.join(root, "global/plugins/target.js")).href, project), true)
    assert.equal(await shadowedByLocalInstall(server, root), false)
    await writeFile(path.join(config, "target/package.json"), '{"name":"opencode-target","version":"0.5.0"}')
    assert.equal(await installedStateDir(server), null)
  } finally { await rm(root, { recursive: true, force: true }) }
})
