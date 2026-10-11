import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { installTargetFiles, parseJsonc } from "../install-config.mjs"

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "target-scope-"))
  try {
    await mkdir(path.join(root, "dist"))
    await writeFile(path.join(root, "package.json"), '{"version":"0.6.0"}')
    await writeFile(path.join(root, "dist/target.js"), "server")
    await writeFile(path.join(root, "dist/target-tui.js"), "tui")
    await fn(root)
  } finally { await rm(root, { recursive: true, force: true }) }
}

test("updating a local archive reports both versions and retains local and global goals", async () => {
  await fixture(async (root) => {
    const configDir = path.join(root, "project/.opencode")
    const globalState = path.join(root, "global-state")
    await mkdir(globalState)
    await writeFile(path.join(globalState, "saved.json"), "global goal")
    const first = await installTargetFiles({ configDir, root, scope: "local" })
    assert.equal(first.version, "0.6.0")
    const state = path.join(configDir, "target/state")
    await mkdir(state, { recursive: true })
    await writeFile(path.join(state, "saved.json"), "local goal")
    await writeFile(path.join(root, "package.json"), '{"version":"0.7.0"}')
    const update = await installTargetFiles({ configDir, root, scope: "local" })
    assert.equal(update.previousVersion, "0.6.0")
    assert.equal(update.version, "0.7.0")
    assert.equal(JSON.parse(await readFile(path.join(configDir, "target/package.json"))).stateDir, state)
    assert.equal(await readFile(path.join(state, "saved.json"), "utf8"), "local goal")
    await installTargetFiles({ configDir, root, scope: "local", uninstall: true })
    for (const name of ["plugins", "tui-plugins", "target", "tui.json", ".target-install.lock"]) {
      await assert.rejects(access(path.join(configDir, name)), { code: "ENOENT" })
    }
    assert.equal(await readFile(path.join(globalState, "saved.json"), "utf8"), "global goal")
    await installTargetFiles({ configDir, root, scope: "local", uninstall: true })
  })
})

test("locked uninstall remembers configured state paths before removing registrations", async () => {
  await fixture(async (root) => {
    const configDir = path.join(root, "config")
    const custom = path.join(root, "custom-state")
    await mkdir(configDir)
    await mkdir(custom)
    await writeFile(path.join(custom, "saved.json"), "goal")
    await writeFile(path.join(configDir, "opencode.jsonc"), `// keep\n${JSON.stringify({ plugin: [["opencode-target", { state_dir: custom }], "other"], theme: "keep" })}`)
    await installTargetFiles({ configDir, root, scope: "global", stateDir: path.join(root, "default-state") })
    await installTargetFiles({ configDir, root, scope: "global", uninstall: true })
    await assert.rejects(access(custom), { code: "ENOENT" })
    const text = await readFile(path.join(configDir, "opencode.jsonc"), "utf8")
    assert.match(text, /\/\/ keep/)
    assert.deepEqual(parseJsonc(text), { plugin: ["other"], theme: "keep" })
  })
})

test("uninstall preserves user additions to installer-created configuration", async () => {
  await fixture(async (root) => {
    const configDir = path.join(root, "project/.opencode")
    await installTargetFiles({ configDir, root, scope: "local" })
    const file = path.join(configDir, "tui.json")
    const config = JSON.parse(await readFile(file))
    config.theme = "user-theme"
    await writeFile(file, JSON.stringify(config))
    await installTargetFiles({ configDir, root, scope: "local", uninstall: true })
    assert.equal(JSON.parse(await readFile(file)).theme, "user-theme")
  })
})
