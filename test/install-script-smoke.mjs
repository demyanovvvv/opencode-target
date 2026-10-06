import assert from "node:assert/strict"
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { resolveHostBinary } from "../host-runtime.mjs"

const source = process.argv[2] ? path.resolve(process.argv[2]) : fileURLToPath(new URL("..", import.meta.url))
const temp = await mkdtemp(path.join(os.tmpdir(), "opencode-target-install-script-"))
const root = path.join(temp, "archive with spaces")
const configDir = path.join(temp, "config with spaces")

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, windowsHide: true })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("error", reject)
    child.on("close", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} ${args.join(" ")} exited ${code}\n${stdout}\n${stderr}`)))
  })
}

try {
  // Only archive artifacts are copied: there is no node_modules or source fallback here.
  await mkdir(path.join(root, "dist"), { recursive: true })
  for (const file of ["install.ps1", "install.sh", "install.ru.ps1", "install.ru.sh", "dist/target.js", "dist/target-tui.js", "dist/install-config.mjs", "dist/host-components.mjs", "dist/host-build.mjs", "dist/host-runtime.mjs", "dist/host-cli.mjs"]) {
    await copyFile(path.join(source, file), path.join(root, file))
  }
  const isolatedHost = path.join(temp, process.platform === "win32" ? "opencode.exe" : "opencode")
  await copyFile(await resolveHostBinary(), isolatedHost)
  const env = { ...process.env, OPENCODE_HOST_BINARY: isolatedHost, OPENCODE_CONFIG_DIR: configDir, OPENCODE_TUI_CONFIG: "", OPENCODE_TARGET_STATE_DIR: path.join(temp, "state") }
  const installers = process.platform === "win32" && !process.env.TARGET_TEST_SH
    ? [["English", "install.ps1", ["-NoProfile", "-File"]], ["Russian", "install.ru.ps1", ["-NoProfile", "-File"]]]
    : [["English", "install.sh", []], ["Russian", "install.ru.sh", []]]
  for (const [language, installer, prefix] of installers) {
    const command = process.env.TARGET_TEST_SH || (process.platform === "win32" ? "pwsh" : "sh")
    const args = [...prefix, path.join(root, installer)]
    const result = await run(command, args, env)
    if (language === "English") {
      assert.match(`${result.stdout}\n${result.stderr}`, /Installed|Restart|automatically|Configured TUI Target plugin/)
    } else {
      assert.match(`${result.stdout}\n${result.stderr}`, /Установ|установлен|Перезапустите/i)
    }
  }
  const tui = JSON.parse(await readFile(path.join(configDir, "tui.json"), "utf8"))
  assert.deepEqual(tui.plugin, ["./tui-plugins/target.js"])
  assert.equal((await readFile(path.join(configDir, "plugins", "target.js"), "utf8")).includes("TargetPlugin"), true)
  assert.equal((await readFile(path.join(configDir, "tui-plugins", "target.js"), "utf8")).includes("opencode-target-tui"), true)
  const configText = await readFile(path.join(configDir, "tui.json"), "utf8")
  const [, installer, prefix] = installers[0]
  const command = process.env.TARGET_TEST_SH || (process.platform === "win32" ? "pwsh" : "sh")
  const args = [...prefix, path.join(root, installer)]
  await run(command, args, env)
  assert.equal(await readFile(path.join(configDir, "tui.json"), "utf8"), configText)
  for (const [, script, flags] of installers) {
    await writeFile(path.join(configDir, "plugins", "target.js"), "outdated")
    await writeFile(path.join(configDir, "tui-plugins", "target.js"), "outdated")
    const update = await run(command, [...flags, path.join(root, script)], env)
    assert.match(update.stdout, /Updated|обновлён/)
    assert.equal(await readFile(path.join(configDir, "plugins", "target.js"), "utf8"), await readFile(path.join(root, "dist/target.js"), "utf8"))
    await mkdir(env.OPENCODE_TARGET_STATE_DIR, { recursive: true })
    await writeFile(path.join(env.OPENCODE_TARGET_STATE_DIR, "saved"), "saved")
    const uninstallArg = script.endsWith(".ps1") ? "-Uninstall" : "--uninstall"
    await run(command, [...flags, path.join(root, script), uninstallArg], env)
    for (const file of [path.join(configDir, "plugins/target.js"), path.join(configDir, "tui-plugins/target.js"), path.join(env.OPENCODE_TARGET_STATE_DIR, "saved")]) {
      await assert.rejects(readFile(file), { code: "ENOENT" })
    }
    assert.deepEqual(JSON.parse(await readFile(path.join(configDir, "tui.json"), "utf8")).plugin, [])
    await run(command, [...flags, path.join(root, script)], env)
  }
  await writeFile(path.join(configDir, "tui.json"), "{ invalid")
  await assert.rejects(() => run(command, args, env), /Invalid TUI config JSONC/)
  assert.equal(await readFile(path.join(configDir, "tui.json"), "utf8"), "{ invalid")
  console.log(`Install script smoke passed (${command}): dependency-free archive, both plugins, registration, idempotence, error propagation`)
} finally {
  await rm(temp, { recursive: true, force: true })
}
