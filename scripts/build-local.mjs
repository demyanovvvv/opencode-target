import { readFile, writeFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")
let core = await readFile(path.join(root, "src/core.js"), "utf8")
let server = await readFile(path.join(root, "src/server.js"), "utf8")
let store = await readFile(path.join(root, "src/store.js"), "utf8")
let ledger = await readFile(path.join(root, "src/ledger.js"), "utf8")
let adapter = await readFile(path.join(root, "src/adapter.js"), "utf8")
let scheduler = await readFile(path.join(root, "src/scheduler.js"), "utf8")
let traversal = await readFile(path.join(root, "src/traversal.js"), "utf8")

const internalize = (source) => source
  .replace(/^import \{\n[\s\S]*?^\} from "[^"]+"\n/gm, "")
  .replace(/^import [^\n]+\n/gm, "")
  .replace(/^export\s+/gm, "")

store = internalize(store)
ledger = internalize(ledger)
adapter = internalize(adapter)
scheduler = internalize(scheduler)
traversal = internalize(traversal)
core = internalize(core)
server = internalize(server)
server = server.replace("const MissionPlugin =", "export const MissionPlugin =")

const banner = `// OpenCode Mission — self-contained local plugin
// Generated from src/store.js + src/ledger.js + src/adapter.js + src/scheduler.js + src/traversal.js + src/core.js + src/server.js. Do not edit dist directly.
import { tool } from "@opencode-ai/plugin"
import { randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { mkdir, open, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
`
const output = `${banner}${store.trim()}\n\n${ledger.trim()}\n\n${adapter.trim()}\n\n${scheduler.trim()}\n\n${traversal.trim()}\n\n${core.trim()}\n\n${server.trim()}\n`
await mkdir(path.join(root, "dist"), { recursive: true })
await writeFile(path.join(root, "dist/mission.js"), output)
console.log("built dist/mission.js")
