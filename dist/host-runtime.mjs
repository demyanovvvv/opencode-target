import { access, readFile, writeFile, copyFile, rename, rm, lstat, realpath, mkdir } from "node:fs/promises"
import path from "node:path"
import { randomUUID, createHash } from "node:crypto"
import { reconcileHostLocked } from "./host-components.mjs"
import { buildHost, runHostCommand } from "./host-build.mjs"

export async function resolveHostBinary() {
  if (process.env.OPENCODE_HOST_BINARY) return realpath(process.env.OPENCODE_HOST_BINARY)
  for (const directory of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    for (const file of [path.join(directory, process.platform === "win32" ? "opencode.exe" : "opencode"), path.join(directory, "node_modules/opencode-ai/bin/opencode.exe")]) {
      try { await access(file); return realpath(file) } catch {}
    }
  }
  throw new Error("Cannot resolve OpenCode executable")
}
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex")
async function binarySnapshot(file) {
  const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Host binary must be a regular non-symlink file")
  return { dev: info.dev, ino: info.ino, hash: digest(await readFile(file)) }
}
async function assertBinary(file, expected) {
  const current = await binarySnapshot(file)
  if (current.dev !== expected.dev || current.ino !== expected.ino || current.hash !== expected.hash) throw new Error("Host binary changed externally")
}
export async function replaceHostBinary(source, target) {
  target = await realpath(target)
  const parent = path.dirname(target)
  const directory = await lstat(parent)
  const before = await binarySnapshot(target)
  await binarySnapshot(source)
  const temporary = path.join(parent, `.host-${randomUUID()}`)
  const backup = `${temporary}.previous`
  await copyFile(source, temporary, 1)
  try {
    await assertBinary(target, before)
    const current = await lstat(parent)
    if (current.dev !== directory.dev || current.ino !== directory.ino || current.isSymbolicLink()) throw new Error("Host parent changed externally")
    await rename(target, backup)
    try { await rename(temporary, target) } catch (error) { await rename(backup, target); throw error }
    const landed = await binarySnapshot(target)
    const previous = await binarySnapshot(backup)
    return async () => {
      await assertBinary(target, landed)
      await assertBinary(backup, previous)
      await rename(target, temporary)
      try { await rename(backup, target) } catch (error) { await rename(temporary, target); throw error }
      await rm(temporary)
    }
  } finally { await rm(temporary, { force: true }) }
}

export async function deployHostRuntime(configDir) {
  const destination = path.join(configDir, "host-runtime")
  await mkdir(destination, { recursive: true })
  if (await realpath(destination) !== path.resolve(destination)) throw new Error("Unsafe host runtime directory")
  for (const name of ["host-components.mjs", "host-build.mjs", "host-runtime.mjs", "host-cli.mjs"]) {
    const target = path.join(destination, name)
    try { if ((await lstat(target)).isSymbolicLink()) throw new Error("Unsafe host runtime file") } catch (error) { if (error.code !== "ENOENT") throw error }
    const source = name === "host-components.mjs" && !import.meta.url.replaceAll("\\", "/").includes("/dist/") ? new URL("./dist/host-components.mjs", import.meta.url) : new URL(name, import.meta.url)
    await writeFile(target, await readFile(source))
  }
  return path.join(destination, "host-cli.mjs")
}

export async function installCoordinatedHostLocked(configDir, upstream) {
  const target = await resolveHostBinary()
  if (!upstream) upstream = (await runHostCommand(target, ["--version"], configDir)).split("+")[0]
  const coordinator = await deployHostRuntime(configDir)
  return reconcileHostLocked(configDir, upstream, {
    build: (composition) => buildHost({ ...composition, configDir, coordinator }),
    install: (binary) => replaceHostBinary(binary, target),
    verify: async (version) => {
      if (await runHostCommand(target, ["--version"], configDir) !== version) throw new Error("Installed host version mismatch")
    },
  })
}
