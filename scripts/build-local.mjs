import { readFile, writeFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")
let core = await readFile(path.join(root, "src/core.js"), "utf8")
let server = await readFile(path.join(root, "src/server.js"), "utf8")

// Keep core's Node built-in imports but make its public declarations internal.
core = core.replace(/^export\s+/gm, "")

// Keep @opencode-ai/plugin, remove the relative core import block.
server = server.replace(/import \{\n[\s\S]*?\n\} from "\.\/core\.js"\n\n/, "")

const banner = `// OpenCode Mission — self-contained local plugin\n// Generated from src/core.js + src/server.js. Do not edit dist directly.\n`
const output = `${banner}${core.trim()}\n\n${server.trim()}\n`
await mkdir(path.join(root, "dist"), { recursive: true })
await writeFile(path.join(root, "dist/mission.js"), output)
console.log("built dist/mission.js")
