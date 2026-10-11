import assert from "node:assert/strict"
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const source = process.argv[2] ? path.resolve(process.argv[2]) : fileURLToPath(new URL("..", import.meta.url))
const temp = await mkdtemp(path.join(os.tmpdir(), "opencode-target-install-script-"))
const root = path.join(temp, "archive with spaces")
const configDir = path.join(temp, "config with spaces")

function run(command, args, env, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, windowsHide: true })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("error", reject)
    child.stdin.end(input)
    child.on("close", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} ${args.join(" ")} exited ${code}\n${stdout}\n${stderr}`)))
  })
}

try {
  // Only archive artifacts are copied: there is no node_modules or source fallback here.
  await mkdir(path.join(root, "dist"), { recursive: true })
  for (const file of ["install.ps1", "install.sh", "install.ru.ps1", "install.ru.sh", "uninstall.ps1", "uninstall.sh", "uninstall.ru.ps1", "uninstall.ru.sh", "dist/target.js", "dist/target-tui.js", "dist/install-config.mjs"]) {
    await copyFile(path.join(source, file), path.join(root, file))
  }
  const env = { ...process.env, OPENCODE_CONFIG_DIR: configDir, OPENCODE_TUI_CONFIG: "", OPENCODE_TARGET_STATE_DIR: path.join(temp, "state") }
  const installers = process.platform === "win32" && !process.env.TARGET_TEST_SH
    ? [["English", "install.ps1", ["-NoProfile", "-File"]], ["Russian", "install.ru.ps1", ["-NoProfile", "-File"]]]
    : [["English", "install.sh", []], ["Russian", "install.ru.sh", []]]
  for (const [language, installer, prefix] of installers) {
    const command = process.env.TARGET_TEST_SH || (process.platform === "win32" ? "pwsh" : "sh")
    const args = [...prefix, path.join(root, installer), installer.endsWith(".ps1") ? "-Global" : "--global"]
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
  const args = [...prefix, path.join(root, installer), installer.endsWith(".ps1") ? "-Global" : "--global"]
  await run(command, args, env)
  assert.equal(await readFile(path.join(configDir, "tui.json"), "utf8"), configText)
  for (const [, script, flags] of installers) {
    await writeFile(path.join(configDir, "plugins", "target.js"), "outdated")
    await writeFile(path.join(configDir, "tui-plugins", "target.js"), "outdated")
    const update = await run(command, [...flags, path.join(root, script), script.endsWith(".ps1") ? "-Global" : "--global"], env)
    assert.match(update.stdout, /Updated|обновлён/i)
    assert.equal(await readFile(path.join(configDir, "plugins", "target.js"), "utf8"), await readFile(path.join(root, "dist/target.js"), "utf8"))
    await mkdir(env.OPENCODE_TARGET_STATE_DIR, { recursive: true })
    await writeFile(path.join(env.OPENCODE_TARGET_STATE_DIR, "saved"), "saved")
    const uninstallArg = script.endsWith(".ps1") ? "-Uninstall" : "--uninstall"
    await run(command, [...flags, path.join(root, script), uninstallArg, script.endsWith(".ps1") ? "-Global" : "--global"], env)
    for (const file of [path.join(configDir, "plugins/target.js"), path.join(configDir, "tui-plugins/target.js"), path.join(env.OPENCODE_TARGET_STATE_DIR, "saved")]) {
      await assert.rejects(readFile(file), { code: "ENOENT" })
    }
    await assert.rejects(readFile(path.join(configDir, "tui.json")), { code: "ENOENT" })
    await run(command, [...flags, path.join(root, script), script.endsWith(".ps1") ? "-Global" : "--global"], env)
  }
  const project = path.join(temp, "local project with spaces")
  await mkdir(project)
  for (const [, script, flags] of installers) {
    const ps = script.endsWith(".ps1")
    const localArgs = [ps ? "-Local" : "--local", ps ? "-ProjectDir" : "--project-dir", project]
    await run(command, [...flags, path.join(root, script), ...localArgs], env)
    const localConfig = path.join(project, ".opencode")
    const manifest = JSON.parse(await readFile(path.join(localConfig, "target/package.json")))
    assert.equal(manifest.stateDir, path.join(localConfig, "target/state"))
    await mkdir(manifest.stateDir, { recursive: true })
    await writeFile(path.join(manifest.stateDir, "goal"), "local goal")
    await mkdir(env.OPENCODE_TARGET_STATE_DIR, { recursive: true })
    await writeFile(path.join(env.OPENCODE_TARGET_STATE_DIR, "goal"), "global goal")
    const remove = script.replace("install", "uninstall")
    await run(command, [...flags, path.join(root, remove), ...localArgs], env)
    await assert.rejects(readFile(path.join(manifest.stateDir, "goal")), { code: "ENOENT" })
    assert.equal(await readFile(path.join(env.OPENCODE_TARGET_STATE_DIR, "goal"), "utf8"), "global goal")
    // Exercise interactive scope and directory selection through the real wrapper.
    const menuArgs = ps ? ["-NoProfile", "-Command", `& '${path.join(root, script).replaceAll("'", "''")}'`] : [...flags, path.join(root, script)]
    const menu = await run(command, menuArgs, env, `1\n${project}\n`)
    assert.match(menu.stdout, /Local|Локально/)
    const removeArgs = ps ? ["-NoProfile", "-Command", `& '${path.join(root, remove).replaceAll("'", "''")}'`] : [...flags, path.join(root, remove)]
    await run(command, removeArgs, env, `1\n${project}\n`)
  }
  await writeFile(path.join(configDir, "tui.json"), "{ invalid")
  await assert.rejects(() => run(command, args, env), /Invalid TUI config JSONC/)
  assert.equal(await readFile(path.join(configDir, "tui.json"), "utf8"), "{ invalid")
  console.log(`Install script smoke passed (${command}): dependency-free archive, both plugins, registration, idempotence, error propagation`)
} finally {
  await rm(temp, { recursive: true, force: true })
}
