import { readFile, writeFile, rename, access, mkdir, rm, lstat, realpath } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"

const names = ["patchline", "target"]
const versionPattern = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/
// Never steal a lock on a timeout: the owner may still be building a host.
export async function withHostLock(configDir, operation, { timeout = 120000 } = {}) {
  await mkdir(configDir, { recursive: true })
  const directory = await realpath(configDir)
  const lock = path.join(directory, ".host-components.lock")
  const started = Date.now()
  while (true) {
    try { await mkdir(lock); break } catch (error) {
      if (error.code !== "EEXIST") throw error
      if (!(await lstat(lock)).isDirectory()) throw new Error("Unsafe host lock")
      if (Date.now() - started >= timeout) throw new Error("Host operation lock timeout; inspect the owner before recovery")
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  try {
    await writeFile(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid, started: new Date().toISOString() }), { flag: "wx" })
    return await operation()
  } finally { await rm(lock, { recursive: true }) }
}
export function hostVersion(upstream, components) {
  if (!versionPattern.test(upstream)) throw new Error("Invalid upstream version")
  return upstream + names.filter((name) => components[name] && components[name].requiresHost !== false).map((name) => {
    const version = components[name].version
    if (!versionPattern.test(version)) throw new Error(`Invalid ${name} version`)
    return `+${name}.${version}`
  }).join("")
}
export function hostSemver(upstream, components) {
  const display = hostVersion(upstream, components)
  const [base, ...metadata] = display.split("+")
  return base + (metadata.length ? `+${metadata.join(".")}` : "")
}
async function manifest(configDir) {
  try {
    const file = path.join(configDir, "host-components.json")
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Unsafe symlink host manifest")
    const result = JSON.parse(await readFile(file, "utf8"))
    if (result.schema !== 1 || !result.components || typeof result.components !== "object") throw new Error("Invalid host component manifest")
    return result
  } catch (error) {
    if (error.code !== "ENOENT") throw error
    return { schema: 1, components: {} }
  }
}
export async function readComponents(configDir) {
  const result = {}
  for (const [name, component] of Object.entries((await manifest(configDir)).components)) {
    if (!names.includes(name)) continue
    hostVersion("1.0.0", { [name]: component })
    if (!Array.isArray(component.files) || !component.files.length) continue
    let present = true
    for (const file of component.files) {
      if (typeof file !== "string" || path.isAbsolute(file) || file.split(/[\\/]/).includes("..")) throw new Error("Unsafe component file path")
      try { await access(path.resolve(configDir, file)) } catch (error) {
        if (error.code !== "ENOENT") throw error
        present = false
      }
    }
    if (present && component.registration) {
      const { parse } = await import("jsonc-parser")
      const layers = {}
      for (const kind of ["opencode", "tui"]) {
        layers[kind] = []
        for (const extension of ["json", "jsonc"]) {
          try {
            const errors = []
            const config = parse(await readFile(path.join(configDir, `${kind}.${extension}`), "utf8"), errors, { allowTrailingComma: true })
            if (errors.length) throw new Error("Invalid component registration config")
            layers[kind].push(config)
          } catch (error) { if (error.code !== "ENOENT") throw error }
        }
      }
      for (const kind of ["opencode", "tui"]) {
        const registered = layers[kind].some((layer) => (layer.plugin || []).some((entry) => {
          const spec = Array.isArray(entry) ? entry[0] : entry
          if (typeof spec !== "string") return false
          if (spec === component.registration || spec.startsWith(`${component.registration}@`) || spec.startsWith(`${component.registration}/`)) return true
          return spec.replaceAll("\\", "/").replace(/\/$/, "").endsWith(name === "target" ? "/target.js" : "/opencode-patchline")
        }))
        const enabled = Object.assign({}, ...layers[kind].map((layer) => layer.plugin_enabled))
        // Server plugins in plugins/ are auto-discovered by OpenCode.
        const discovered = name === "target" && kind === "opencode" && component.files.includes("plugins/target.js")
        if ((!registered && !discovered) || enabled[kind === "tui" ? `${component.registration}-tui` : component.registration] === false || enabled[component.registration] === false) present = false
      }
    }
    if (present && component.packageFile) {
      if (typeof component.packageFile !== "string" || path.isAbsolute(component.packageFile) || component.packageFile.split(/[\\/]/).includes("..")) throw new Error("Unsafe component package path")
      const pkg = JSON.parse(await readFile(path.join(configDir, component.packageFile), "utf8"))
      hostVersion("1.0.0", { [name]: { version: pkg.version } })
      result[name] = { ...component, version: pkg.version }
    } else if (present) result[name] = component
  }
  return result
}
async function saveManifest(configDir, result) {
  const file = path.join(configDir, "host-components.json")
  // Validate the current target before replacing it, including symlink guards.
  await manifest(configDir)
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(result, null, 2) + "\n", { flag: "wx" })
    await rename(temporary, file)
  } finally { await rm(temporary, { force: true }) }
}

export async function reconcileHost(configDir, upstream, adapters) {
  return withHostLock(configDir, () => reconcileHostLocked(configDir, upstream, adapters))
}

export async function reconcileHostLocked(configDir, upstream, { build, install, verify }) {
  const components = await readComponents(configDir)
  const version = hostVersion(upstream, components)
  const binary = await build({ upstream, components, version })
  let restore
  try {
    restore = await install(binary)
    if (verify) await verify(version)
    const result = await manifest(configDir)
    result.host = { upstream, version, components, installedAt: new Date().toISOString() }
    await saveManifest(configDir, result)
    return result.host
  } catch (error) {
    if (restore) {
      try { await restore() } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "Host installation failed; rollback incomplete")
      }
    }
    throw error
  }
}

export async function registerComponent(configDir, name, component) {
  return withHostLock(configDir, () => registerComponentLocked(configDir, name, component))
}

export async function registerComponentLocked(configDir, name, component) {
  if (!names.includes(name)) throw new Error("Unknown host component")
  const result = await manifest(configDir)
  if (component) {
    hostVersion("1.0.0", { [name]: component })
    if (!Array.isArray(component.files) || !component.files.length || component.files.some((file) => typeof file !== "string" || path.isAbsolute(file) || file.split(/[\\/]/).includes(".."))) throw new Error("Unsafe component file path")
    result.components[name] = component
  } else delete result.components[name]
  await saveManifest(configDir, result)
  return readComponents(configDir)
}
