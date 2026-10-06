import { access, mkdir, readFile, writeFile, rm, copyFile, lstat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { applyEdits, modify, parse } from "jsonc-parser"

export const TUI_PLUGIN_ID = "opencode-target-tui"

async function withInstallLock(configDir, operation) {
  await mkdir(configDir, { recursive: true })
  const lock = path.join(configDir, ".target-install.lock")
  const started = Date.now()
  for (;;) {
    try { await mkdir(lock); break } catch (error) {
      if (error.code !== "EEXIST") throw error
      if (!(await lstat(lock)).isDirectory()) throw new Error("Unsafe Target installation lock")
      if (Date.now() - started >= 120_000) throw new Error("Target installation lock timeout")
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  try { return await operation() } finally { await rm(lock, { recursive: true }) }
}

export function parseJsonc(text) {
  const errors = []
  const value = parse(text.replace(/^\uFEFF/, ""), errors, { allowTrailingComma: true })
  if (errors.length > 0) throw new Error(`Invalid TUI config JSONC at offset ${errors[0].offset}`)
  return value
}

export async function selectTuiConfigPath(configDir) {
  for (const name of ["tui.jsonc", "tui.json"]) {
    const candidate = path.join(configDir, name)
    try {
      await access(candidate)
      return candidate
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
    }
  }
  return path.join(configDir, "tui.json")
}

function relativePluginPath(configPath, configDir) {
  const installed = path.join(configDir, "tui-plugins", "target.js")
  const relative = path.relative(path.dirname(configPath), installed).replaceAll(path.sep, "/")
  if (path.isAbsolute(relative)) return pathToFileURL(installed).href
  return relative.startsWith(".") ? relative : `./${relative}`
}

function isTargetPlugin(value, configPath, configDir) {
  if (Array.isArray(value)) return isTargetPlugin(value[0], configPath, configDir)
  if (typeof value !== "string") return false
  if (value === "opencode-target" || value.startsWith("opencode-target@")) return true
  if (value.startsWith("file:")) {
    try { value = fileURLToPath(value) } catch { return false }
  }
  return path.resolve(path.dirname(configPath), value) === path.resolve(configDir, "tui-plugins", "target.js")
}

function applyModify(text, pathSegments, value) {
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : ""
  const content = text.slice(bom.length)
  const indent = content.match(/\r?\n([\t ]+)"/)?.[1]
  return bom + applyEdits(content, modify(content, pathSegments, value, {
    formattingOptions: {
      insertSpaces: !indent?.includes("\t"),
      tabSize: indent && !indent.includes("\t") ? indent.length : 2,
      eol: text.includes("\r\n") ? "\r\n" : "\n",
    },
  }))
}

async function loadConfig(configPath) {
  let original = ""
  try {
    original = await readFile(configPath, "utf8")
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }

  const config = original ? parseJsonc(original) : {}
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("tui config must be an object")
  if (config.plugin !== undefined && !Array.isArray(config.plugin)) throw new Error("plugin must be an array")
  if (config.plugin_enabled !== undefined && (!config.plugin_enabled || typeof config.plugin_enabled !== "object" || Array.isArray(config.plugin_enabled))) {
    throw new Error("plugin_enabled must be an object")
  }
  return { original, config, configPath }
}

export async function configureTuiConfig({ configDir, tuiConfig = null }) {
  configDir = path.resolve(configDir)
  const configPath = tuiConfig ? path.resolve(String(tuiConfig)) : await selectTuiConfigPath(configDir)
  const paths = [...new Set([path.join(configDir, "tui.json"), path.join(configDir, "tui.jsonc"), configPath])]
  const layers = await Promise.all(paths.map(loadConfig))
  const { original, config } = layers.find((item) => item.configPath === configPath)
  const pluginPath = relativePluginPath(configPath, configDir)
  const present = layers.some((layer) => layer.config.plugin?.some((item) => isTargetPlugin(item, layer.configPath, configDir)))
  const enabled = Object.assign({}, ...layers.map((layer) => layer.config.plugin_enabled))

  let next = original
  if (!original) next = '{\n  "$schema": "https://opencode.ai/tui.json"\n}\n'
  if (!present) {
    next = config.plugin
      ? applyModify(next, ["plugin", -1], pluginPath)
      : applyModify(next, ["plugin"], [pluginPath])
  }
  if (enabled[TUI_PLUGIN_ID] === false) {
    next = applyModify(next, ["plugin_enabled", TUI_PLUGIN_ID], true)
  }

  if (next === original) return { changed: false, configPath }
  parseJsonc(next)
  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(configPath, next, "utf8")
  return { changed: true, configPath }
}

export async function uninstallTarget({ configDir, tuiConfig = null, stateDir = null }) {
  configDir = path.resolve(configDir)
  const paths = [...new Set([
    ...["opencode.json", "opencode.jsonc", "tui.json", "tui.jsonc"].map((name) => path.join(configDir, name)),
    ...(tuiConfig ? [path.resolve(tuiConfig)] : []),
  ])]
  // Validate every configuration before deleting files or changing any layer.
  const layers = await Promise.all(paths.map(loadConfig))
  const stateDirs = new Set([path.resolve(stateDir || process.env.OPENCODE_TARGET_STATE_DIR ||
    (process.platform === "win32" ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "opencode-target") :
      path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "opencode-target")))])
  const writes = []
  for (const layer of layers) {
    let next = layer.original
    const entries = layer.config.plugin || []
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index]
      const name = Array.isArray(entry) ? entry[0] : entry
      const isServer = typeof name === "string" && (name === "opencode-target" || name.startsWith("opencode-target@") ||
        (name.startsWith("file:") ? fileURLToPath(name) : path.resolve(path.dirname(layer.configPath), name)) === path.join(configDir, "plugins", "target.js"))
      if (!isServer && !isTargetPlugin(entry, layer.configPath, configDir)) continue
      if (Array.isArray(entry) && entry[1]?.state_dir) stateDirs.add(path.resolve(entry[1].state_dir))
      next = applyModify(next, ["plugin", index], undefined)
    }
    for (const id of ["opencode-target", TUI_PLUGIN_ID]) {
      if (Object.hasOwn(layer.config.plugin_enabled || {}, id)) next = applyModify(next, ["plugin_enabled", id], undefined)
    }
    if (next !== layer.original) writes.push({ configPath: layer.configPath, text: next })
  }
  for (const dir of stateDirs) {
    if (dir === path.parse(dir).root || dir === configDir || dir === os.homedir() || paths.some((file) => file === dir || file.startsWith(dir + path.sep))) {
      throw new Error(`Refusing to remove unsafe state directory: ${dir}`)
    }
  }
  for (const write of writes) await writeFile(write.configPath, write.text, "utf8")
  await rm(path.join(configDir, "plugins", "target.js"), { force: true })
  await rm(path.join(configDir, "tui-plugins", "target.js"), { force: true })
  for (const dir of stateDirs) await rm(dir, { recursive: true, force: true })
}

export async function installTargetFiles({ configDir, root, tuiConfig = null, uninstall = false, stateDir = null }) {
  configDir = path.resolve(configDir)
  return withInstallLock(configDir, async () => {
    const owned = ["opencode.json", "opencode.jsonc", "tui.json", "tui.jsonc", "plugins/target.js", "tui-plugins/target.js", "target/package.json"]
    if (tuiConfig) owned.push(path.resolve(tuiConfig))
    const snapshots = []
    for (const file of [...new Set(owned.map((file) => path.resolve(configDir, file)))]) {
      try {
        const info = await lstat(file)
        if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Unsafe installer file: ${file}`)
        snapshots.push({ file, bytes: await readFile(file) })
      } catch (error) { if (error.code !== "ENOENT") throw error; snapshots.push({ file, bytes: null }) }
    }
    try {
      if (uninstall) {
        const quarantine = path.join(configDir, `.target-state-transition-${process.pid}`)
        await uninstallTarget({ configDir, tuiConfig, stateDir: quarantine })
      } else {
        for (const [source, destination] of [["target.js", "plugins/target.js"], ["target-tui.js", "tui-plugins/target.js"]]) {
          await mkdir(path.dirname(path.join(configDir, destination)), { recursive: true })
          await copyFile(path.join(root, "dist", source), path.join(configDir, destination))
        }
        await configureTuiConfig({ configDir, tuiConfig })
        const version = typeof TARGET_PACKAGE_VERSION !== "undefined" ? TARGET_PACKAGE_VERSION : JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version
        await mkdir(path.join(configDir, "target"), { recursive: true })
        await writeFile(path.join(configDir, "target/package.json"), JSON.stringify({ name: "opencode-target", version }) + "\n")
      }
      if (uninstall) {
        await rm(path.join(configDir, "target/package.json"), { force: true })
        await uninstallTarget({ configDir, tuiConfig, stateDir })
      }
    } catch (error) {
      const failures = []
      for (const snapshot of snapshots.reverse()) {
        try {
          if (snapshot.bytes === null) await rm(snapshot.file, { force: true })
          else await writeFile(snapshot.file, snapshot.bytes)
        } catch (rollbackError) { failures.push(rollbackError) }
      }
      if (failures.length) throw new AggregateError([error, ...failures], "Target installation rollback incomplete")
      throw error
    }
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const value = (name) => {
    const index = args.indexOf(name)
    return index === -1 ? null : args[index + 1]
  }
  const configDir = value("--config-dir") || process.env.OPENCODE_CONFIG_DIR || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "opencode")
  if (args.includes("--install-files") || args.includes("--uninstall")) {
    await installTargetFiles({ configDir, root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), tuiConfig: value("--tui-config") || process.env.OPENCODE_TUI_CONFIG || null, uninstall: args.includes("--uninstall"), stateDir: value("--state-dir") })
    console.log(`${args.includes("--uninstall") ? "Removed" : "Installed"} OpenCode Target in ${configDir}`)
  } else {
    const result = await configureTuiConfig({ configDir, tuiConfig: value("--tui-config") || process.env.OPENCODE_TUI_CONFIG || null })
    console.log(`${result.changed ? "Configured" : "Already configured"} TUI Target plugin in ${result.configPath}`)
  }
}
