import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Installed plugins share metadata; manually copied plugins keep the legacy default.
export async function installedStateDir(moduleURL) {
  const dir = path.dirname(fileURLToPath(moduleURL))
  if (!["plugins", "tui-plugins"].includes(path.basename(dir))) return null
  try {
    const manifest = JSON.parse(await readFile(path.join(dir, "../target/package.json"), "utf8"))
    if (manifest.name === "opencode-target" && manifest.stateDir === undefined) return null
    if (manifest.name !== "opencode-target" || typeof manifest.stateDir !== "string" || !path.isAbsolute(manifest.stateDir)) {
      throw new Error("Invalid Target installation metadata")
    }
    return manifest.stateDir
  } catch (error) { if (error.code === "ENOENT") return null; throw error }
}

export async function shadowedByLocalInstall(moduleURL, directory) {
  if (!directory) return false
  const installed = path.resolve(path.dirname(fileURLToPath(moduleURL)), "..")
  let current = path.resolve(directory)
  for (;;) {
    const local = path.join(current, ".opencode")
    if (local !== installed) {
      try {
        const manifest = JSON.parse(await readFile(path.join(local, "target/package.json"), "utf8"))
        if (manifest.name === "opencode-target" && manifest.scope === "local") return true
      } catch (error) { if (error.code !== "ENOENT") throw error }
    } else return false
    const parent = path.dirname(current)
    if (parent === current) return false
    current = parent
  }
}
