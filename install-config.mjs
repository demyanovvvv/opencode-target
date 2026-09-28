import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { applyEdits, modify, parse } from "jsonc-parser"

export const TUI_PLUGIN_ID = "opencode-target-tui"

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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const value = (name) => {
    const index = args.indexOf(name)
    return index === -1 ? null : args[index + 1]
  }
  const configDir = value("--config-dir") || process.env.OPENCODE_CONFIG_DIR || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "opencode")
  const result = await configureTuiConfig({
    configDir,
    tuiConfig: value("--tui-config") || process.env.OPENCODE_TUI_CONFIG || null,
  })
  console.log(`${result.changed ? "Configured" : "Already configured"} TUI Target plugin in ${result.configPath}`)
}
