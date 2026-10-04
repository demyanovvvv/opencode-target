import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { pathToFileURL } from "node:url"
import { configureTuiConfig, parseJsonc, selectTuiConfigPath, uninstallTarget } from "../install-config.mjs"

async function withConfig(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-target-install-"))
  try { await fn(dir) } finally { await rm(dir, { recursive: true, force: true }) }
}

test("uninstall validates configuration and state location before making changes", async () => {
  await withConfig(async (dir) => {
    const file = path.join(dir, "tui.json")
    const text = '{"plugin":["./tui-plugins/target.js"]}'
    await writeFile(file, text)
    await assert.rejects(uninstallTarget({ configDir: dir, stateDir: dir }), /unsafe state directory/)
    assert.equal(await readFile(file, "utf8"), text)
    await writeFile(path.join(dir, "opencode.jsonc"), "{ invalid")
    await assert.rejects(uninstallTarget({ configDir: dir, stateDir: path.join(dir, "state") }), /Invalid/)
    assert.equal(await readFile(file, "utf8"), text)
  })
})

test("uninstall removes Target files, registrations and state while preserving other plugins", async () => {
  await withConfig(async (dir) => {
    const stateDir = path.join(dir, "state")
    for (const folder of ["plugins", "tui-plugins", "state"]) await mkdir(path.join(dir, folder))
    for (const folder of ["plugins", "tui-plugins"]) {
      await writeFile(path.join(dir, folder, "target.js"), "old target")
      await writeFile(path.join(dir, folder, "other.js"), "keep")
    }
    await writeFile(path.join(stateDir, "saved.json"), "saved")
    await writeFile(path.join(dir, "opencode.json"), JSON.stringify({ plugin: [["opencode-target", { auto_continue: true }], "other"], theme: "keep" }))
    await writeFile(path.join(dir, "tui.jsonc"), '// keep\n{"plugin":["./tui-plugins/target.js","other"],"plugin_enabled":{"opencode-target-tui":false,"other":true}}')
    await uninstallTarget({ configDir: dir, stateDir })
    for (const file of ["plugins/target.js", "tui-plugins/target.js", "state/saved.json"]) {
      await assert.rejects(readFile(path.join(dir, file)), { code: "ENOENT" })
    }
    assert.equal(await readFile(path.join(dir, "plugins/other.js"), "utf8"), "keep")
    assert.deepEqual(parseJsonc(await readFile(path.join(dir, "opencode.json"), "utf8")), { plugin: ["other"], theme: "keep" })
    const text = await readFile(path.join(dir, "tui.jsonc"), "utf8")
    assert.match(text, /keep/)
    assert.deepEqual(parseJsonc(text), { plugin: ["other"], plugin_enabled: { other: true } })
    await uninstallTarget({ configDir: dir, stateDir })
  })
})

test("installer creates tui.json and registers the indicator", async () => {
  await withConfig(async (dir) => {
    const result = await configureTuiConfig({ configDir: dir })
    assert.equal(result.changed, true)
    assert.equal(result.configPath, path.join(dir, "tui.json"))
    assert.deepEqual(parseJsonc(await readFile(result.configPath, "utf8")), {
      $schema: "https://opencode.ai/tui.json",
      plugin: ["./tui-plugins/target.js"],
    })
  })
})

test("installer preserves JSONC settings/comments and is idempotent", async () => {
  await withConfig(async (dir) => {
    const configPath = path.join(dir, "tui.jsonc")
    const original = `// Keep this user comment\r\n{\r\n\t"$schema": "https://opencode.ai/tui.json",\r\n\t"theme": "user-theme",\r\n\t"plugin": [\r\n\t\t// Plugin comment\r\n\t\t"user-plugin",\r\n\t]\r\n}\r\n`
    await writeFile(configPath, original)
    const first = await configureTuiConfig({ configDir: dir })
    const firstText = await readFile(configPath, "utf8")
    assert.equal(first.configPath, configPath)
    assert.equal(first.changed, true)
    assert.match(firstText, /Keep this user comment/)
    assert.match(firstText, /Plugin comment/)
    assert.equal(firstText.replaceAll("\r\n", "").includes("\n"), false)
    assert.deepEqual(parseJsonc(firstText), {
      $schema: "https://opencode.ai/tui.json",
      theme: "user-theme",
      plugin: ["user-plugin", "./tui-plugins/target.js"],
    })
    const second = await configureTuiConfig({ configDir: dir })
    assert.equal(second.changed, false)
    assert.equal(await readFile(configPath, "utf8"), firstText)
  })
})

test("installer recognizes an existing absolute target plugin and tuple options", async () => {
  await withConfig(async (dir) => {
    const configPath = path.join(dir, "tui.json")
    await writeFile(configPath, JSON.stringify({
      plugin: [[path.join(dir, "tui-plugins", "target.js"), { state_dir: "custom" }]],
    }, null, 2))
    const result = await configureTuiConfig({ configDir: dir })
    assert.equal(result.changed, false)
  })
})

test("installer prefers an existing tui.jsonc and rejects malformed config", async () => {
  await withConfig(async (dir) => {
    await writeFile(path.join(dir, "tui.json"), JSON.stringify({ plugin: ["lower"] }))
    const jsonc = path.join(dir, "tui.jsonc")
    await writeFile(jsonc, "{\"plugin\": \"not-an-array\"}")
    assert.equal(await selectTuiConfigPath(dir), jsonc)
    await assert.rejects(() => configureTuiConfig({ configDir: dir }), /plugin must be an array/)
    assert.equal(await readFile(jsonc, "utf8"), "{\"plugin\": \"not-an-array\"}")
  })
})

test("installer fails closed on syntax errors and invalid objects", async () => {
  await withConfig(async (dir) => {
    const file = path.join(dir, "tui.json")
    for (const invalid of ["{", "{\"theme\": }", "[]", "null", "{\"plugin_enabled\": []}"]) {
      await writeFile(file, invalid)
      await assert.rejects(() => configureTuiConfig({ configDir: dir }))
      assert.equal(await readFile(file, "utf8"), invalid)
    }
  })
})

test("installer respects both config layers and re-enables only Target", async () => {
  await withConfig(async (dir) => {
    const lower = path.join(dir, "tui.json")
    const text = JSON.stringify({ plugin: [[pathToFileURL(path.join(dir, "tui-plugins/target.js")).href, { state_dir: "custom" }]], plugin_enabled: { "opencode-target-tui": false } })
    await writeFile(lower, text)
    const upper = path.join(dir, "tui.jsonc")
    await writeFile(upper, '{"theme":"custom","plugin_enabled":{"other":false}}')
    const result = await configureTuiConfig({ configDir: dir })
    assert.equal(result.changed, true)
    assert.deepEqual(parseJsonc(await readFile(upper, "utf8")), {
      theme: "custom", plugin_enabled: { other: false, "opencode-target-tui": true },
    })
    assert.equal(await readFile(lower, "utf8"), text)
    assert.equal((await configureTuiConfig({ configDir: dir })).changed, false)
  })
})

test("installer does not mistake a different directory for its own plugin", async () => {
  await withConfig(async (dir) => {
    await writeFile(path.join(dir, "tui.json"), JSON.stringify({ plugin: ["./other/tui-plugins/target.js"] }))
    await configureTuiConfig({ configDir: dir })
    assert.deepEqual(parseJsonc(await readFile(path.join(dir, "tui.json"), "utf8")).plugin,
      ["./other/tui-plugins/target.js", "./tui-plugins/target.js"])
  })
})

test("installer preserves a BOM and supports a custom TUI config location", async () => {
  await withConfig(async (dir) => {
    const configDir = path.join(dir, "config")
    await mkdir(configDir)
    const file = path.join(dir, "custom.jsonc")
    await writeFile(file, '\uFEFF{ "theme": "custom" }\n')
    const result = await configureTuiConfig({ configDir, tuiConfig: file })
    assert.equal(result.configPath, file)
    const text = await readFile(file, "utf8")
    assert.equal(text[0], "\uFEFF")
    assert.deepEqual(parseJsonc(text).plugin, ["./config/tui-plugins/target.js"])
    assert.equal((await configureTuiConfig({ configDir, tuiConfig: file })).changed, false)
  })
})
