import { createHash } from "node:crypto"
import { copyFile, mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { spawn } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function quoteWindowsArg(value) {
  const text = String(value)
  if (!/[\s"]/.test(text)) return text
  return `"${text.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\+)$/g, "$1$1")}"`
}

async function run(command, args, cwd = root, { quiet = false } = {}) {
  const result = process.platform === "win32" && /(?:^|[\\/])npm\.cmd$/i.test(command)
    ? await new Promise((resolve, reject) => {
        const commandLine = [command, ...args].map(quoteWindowsArg).join(" ")
        const child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", commandLine], { cwd })
        let stdout = ""
        let stderr = ""
        child.stdout.on("data", (chunk) => { stdout += chunk })
        child.stderr.on("data", (chunk) => { stderr += chunk })
        child.on("error", reject)
        child.on("close", (code) => code === 0
          ? resolve({ stdout, stderr })
          : reject(new Error(`${command} exited with ${code}\n${stdout}\n${stderr}`)))
      })
    : await new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd })
        let stdout = ""
        let stderr = ""
        child.stdout.on("data", (chunk) => { stdout += chunk })
        child.stderr.on("data", (chunk) => { stderr += chunk })
        child.on("error", reject)
        child.on("close", (code) => code === 0
          ? resolve({ stdout, stderr })
          : reject(new Error(`${command} exited with ${code}\n${stdout}\n${stderr}`)))
      })
  if (!quiet && result.stdout) process.stdout.write(result.stdout)
  if (!quiet && result.stderr) process.stderr.write(result.stderr)
  return result
}

function npmCommand() {
  return [process.platform === "win32" ? "npm.cmd" : "npm"]
}

async function runNpm(args, cwd = root, options = {}) {
  const [command, ...prefix] = npmCommand()
  return run(command, [...prefix, ...args], cwd, options)
}

async function runNode(args, cwd = root, options = {}) {
  return run(process.execPath, args, cwd, options)
}

async function hash(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex")
}

console.log("release check: running full check")
await runNode(["scripts/build-local.mjs"], root, { quiet: true })
for (const file of [
  "src/core.js",
  "src/server.js",
  "src/store.js",
  "src/ledger.js",
  "src/adapter.js",
  "src/scheduler.js",
  "src/traversal.js",
  "dist/mission.js",
]) {
  await runNode(["--check", file], root, { quiet: true })
}
await runNode(["-e", "import('./dist/mission.js').then(m => { if (typeof m.MissionPlugin !== 'function') process.exit(1) })"], root, { quiet: true })
for (const file of [
  "test/core.test.js",
  "test/adapter.test.js",
  "test/store.test.js",
  "test/ledger.test.js",
  "test/scheduler.test.js",
  "test/traversal.test.js",
]) {
  await runNode(["--test", file], root, { quiet: true })
}
for (const file of ["test/server-smoke.mjs", "test/continuation-smoke.mjs", "test/budget-wrapup-smoke.mjs", "test/restart-smoke.mjs"]) {
  await runNode([file], root, { quiet: true })
}
const artifact = path.join(root, "dist", "mission.js")
const firstHash = await hash(artifact)
console.log("release check: verifying deterministic build")
await runNode(["scripts/build-local.mjs"], root, { quiet: true })
const secondHash = await hash(artifact)
if (firstHash !== secondHash) throw new Error("Generated dist/mission.js is not deterministic.")

const temp = await mkdtemp(path.join(os.tmpdir(), "opencode-mission-pack-"))
let archive = null
let temporaryArchive = null
try {
  const [packCommand, ...packPrefix] = npmCommand()
  console.log("release check: verifying packed install")
  const { stdout } = await run(packCommand, [...packPrefix, "pack", "--json", "--silent"], root, { quiet: true })
  const packageInfo = JSON.parse(stdout.trim())[0]
  archive = path.join(root, packageInfo.filename)
  temporaryArchive = path.join(temp, packageInfo.filename)
  await copyFile(archive, temporaryArchive)
  await runNpm([
    "install",
    "--ignore-scripts",
    "--no-package-lock",
    "--no-save",
    packageInfo.filename,
    "@opencode-ai/plugin@1.18.30",
  ], temp)
  await runNode(["-e", "import('opencode-mission').then(m => { if (typeof m.MissionPlugin !== 'function') process.exit(1) })"], temp, { quiet: true })
  const installed = await readdir(path.join(temp, "node_modules", "opencode-mission"))
  for (const required of ["README.md", "dist", "src", "docs", "install.sh", "install.ps1"]) {
    if (!installed.includes(required)) throw new Error(`Package is missing ${required}.`)
  }
  for (const forbidden of ["test", ".opencode", "node_modules"]) {
    if (installed.includes(forbidden)) throw new Error(`Package unexpectedly contains ${forbidden}.`)
  }
} finally {
  if (archive) await rm(archive, { force: true })
  if (temporaryArchive) await rm(temporaryArchive, { force: true })
  await rm(temp, { recursive: true, force: true })
}

console.log("release check: ok")
