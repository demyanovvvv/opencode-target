import { readFile, writeFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")
let core = await readFile(path.join(root, "src/core.js"), "utf8")
let installState = await readFile(path.join(root, "src/install-state.js"), "utf8")
let server = await readFile(path.join(root, "src/server.js"), "utf8")
let store = await readFile(path.join(root, "src/store.js"), "utf8")
let ledger = await readFile(path.join(root, "src/ledger.js"), "utf8")
let adapter = await readFile(path.join(root, "src/adapter.js"), "utf8")
let scheduler = await readFile(path.join(root, "src/scheduler.js"), "utf8")
let traversal = await readFile(path.join(root, "src/traversal.js"), "utf8")
let repository = await readFile(path.join(root, "src/repository.js"), "utf8")
let verification = await readFile(path.join(root, "src/verification.js"), "utf8")
let continuation = await readFile(path.join(root, "src/continuation.js"), "utf8")
let options = await readFile(path.join(root, "src/options.js"), "utf8")
let host = await readFile(path.join(root, "src/host.js"), "utf8")
let errors = await readFile(path.join(root, "src/errors.js"), "utf8")
let eventRouting = await readFile(path.join(root, "src/event-routing.js"), "utf8")
let errorLifecycle = await readFile(path.join(root, "src/error-lifecycle.js"), "utf8")
let toolAccounting = await readFile(path.join(root, "src/tool-accounting.js"), "utf8")
let verificationGate = await readFile(path.join(root, "src/verification-gate.js"), "utf8")
let contextHooks = await readFile(path.join(root, "src/context-hooks.js"), "utf8")
let commands = await readFile(path.join(root, "src/commands.js"), "utf8")
let contextSettingsSource = await readFile(path.join(root, "src/context.js"), "utf8")
let contextCompactionSource = await readFile(path.join(root, "src/context-compaction.js"), "utf8")

const internalize = (source) => source
  .replace(/^import \{\r?\n[\s\S]*?^\} from "[^"]+"\r?\n/gm, "")
  .replace(/^import [^\n]+\n/gm, "")
  .replace(/^export\s+/gm, "")

store = internalize(store)
installState = internalize(installState)
ledger = internalize(ledger)
adapter = internalize(adapter)
scheduler = internalize(scheduler)
traversal = internalize(traversal)
repository = internalize(repository)
verification = internalize(verification)
continuation = internalize(continuation)
options = internalize(options)
host = internalize(host)
errors = internalize(errors)
eventRouting = internalize(eventRouting)
errorLifecycle = internalize(errorLifecycle)
toolAccounting = internalize(toolAccounting)
verificationGate = internalize(verificationGate)
contextHooks = internalize(contextHooks)
commands = internalize(commands)
contextSettingsSource = internalize(contextSettingsSource)
contextCompactionSource = internalize(contextCompactionSource)
core = internalize(core)
server = internalize(server)
server = server.replace("const TargetPlugin =", "export const TargetPlugin =")

const banner = `// OpenCode Target — self-contained local plugin
// Generated from src/ modules, including context.js and context-compaction.js. Do not edit dist directly.
import { tool } from "@opencode-ai/plugin"
import { randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { mkdir, open, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"
`
const output = `${banner}${store.trim()}\n\n${ledger.trim()}\n\n${adapter.trim()}\n\n${scheduler.trim()}\n\n${traversal.trim()}\n\n${repository.trim()}\n\n${verification.trim()}\n\n${continuation.trim()}\n\n${options.trim()}\n\n${host.trim()}\n\n${errors.trim()}\n\n${eventRouting.trim()}\n\n${errorLifecycle.trim()}\n\n${toolAccounting.trim()}\n\n${contextHooks.trim()}\n\n${contextSettingsSource.trim()}\n\n${contextCompactionSource.trim()}\n\n${commands.trim()}\n\n${core.trim()}\n\n${verificationGate.trim()}\n\n${server.trim()}\n`
await mkdir(path.join(root, "dist"), { recursive: true })
await writeFile(path.join(root, "dist/target.js"), output + "\n" + installState)
console.log("built dist/target.js")
