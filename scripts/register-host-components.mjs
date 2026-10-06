import path from "node:path"
import os from "node:os"
import { readFile } from "node:fs/promises"
import { registerComponent, readComponents, hostVersion } from "../host-components.mjs"
const configDir = process.env.OPENCODE_CONFIG_DIR || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "opencode")
const target = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
await registerComponent(configDir, "target", { version: target.version, files: ["plugins/target.js", "tui-plugins/target.js"] })
// Migrate an existing package installation; absence is not inferred from an old binary suffix.
try {
  const file = path.join(configDir, "node_modules/opencode-patchline/package.json")
  const patchline = JSON.parse(await readFile(file, "utf8"))
  if (patchline.name === "opencode-patchline") await registerComponent(configDir, "patchline", {
    version: patchline.version, files: ["node_modules/opencode-patchline/package.json"],
  })
} catch (error) { if (error.code !== "ENOENT") throw error }
console.log(hostVersion("1.18.34", await readComponents(configDir)))