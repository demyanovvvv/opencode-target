import { randomUUID } from "node:crypto"
import { mkdir, open, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

const LOCK_STALE_MS = 15_000
const LOCK_HEARTBEAT_MS = 5_000
const LOCK_RETRY_MS = 25
const LOCK_RETRIES = Math.ceil(LOCK_STALE_MS / LOCK_RETRY_MS) + 2

function safeName(sessionID) { return Buffer.from(String(sessionID)).toString("base64url") }

export class MissionStore {
  constructor(stateDir, options = {}) {
    this.stateDir = path.resolve(String(stateDir))
    this.lockStaleMs = options.lockStaleMs ?? LOCK_STALE_MS
    this.lockHeartbeatMs = options.lockHeartbeatMs ?? LOCK_HEARTBEAT_MS
    this.lockRetries = options.lockRetries ?? LOCK_RETRIES
    this.lockRetryMs = options.lockRetryMs ?? LOCK_RETRY_MS
    this.now = options.now ?? Date.now
    this.stat = options.stat ?? stat
    this.unlink = options.unlink ?? unlink
    this.readLockFile = options.readLockFile ?? readFile
  }
  path(sessionID) { return path.join(this.stateDir, "missions", `${safeName(sessionID)}.json`) }
  lockPath(sessionID) { return path.join(this.stateDir, "locks", `${safeName(sessionID)}.lock`) }
  async ensureDirs() {
    await Promise.all([
      mkdir(path.join(this.stateDir, "missions"), { recursive: true }),
      mkdir(path.join(this.stateDir, "locks"), { recursive: true }),
      mkdir(path.join(this.stateDir, "corrupt"), { recursive: true }),
    ])
  }
  async read(sessionID) {
    const file = this.path(sessionID)
    let raw
    try { raw = await readFile(file, "utf8") } catch (error) {
      if (error?.code === "ENOENT") return null
      throw error
    }
    try { return JSON.parse(raw) } catch (error) {
      await mkdir(path.join(this.stateDir, "corrupt"), { recursive: true })
      const target = path.join(this.stateDir, "corrupt", `${path.basename(file)}.${Date.now()}.${randomUUID()}.corrupt`)
      await rename(file, target)
      const diagnostic = new Error(`Mission state is corrupt and was quarantined: ${target}`)
      diagnostic.code = "MISSION_STATE_CORRUPT"
      diagnostic.cause = error
      throw diagnostic
    }
  }
  async quarantine(sessionID) {
    const file = this.path(sessionID)
    await mkdir(path.join(this.stateDir, "corrupt"), { recursive: true })
    const target = path.join(this.stateDir, "corrupt", `${path.basename(file)}.${Date.now()}.${randomUUID()}.corrupt`)
    await rename(file, target)
    return target
  }
  async write(sessionID, value) {
    await this.ensureDirs()
    const file = this.path(sessionID)
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temp, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600 })
    await rename(temp, file)
    return value
  }
  async remove(sessionID) { await this.withLock(sessionID, () => rm(this.path(sessionID), { force: true })) }
  async listCorrupt() { await this.ensureDirs(); return (await readdir(path.join(this.stateDir, "corrupt"))).sort() }
  async mutate(sessionID, fn) {
    return this.withLock(sessionID, async () => {
      const current = await this.read(sessionID)
      return this.write(sessionID, await fn(current))
    })
  }
  async withLock(sessionID, fn) {
    await this.ensureDirs()
    const file = this.lockPath(sessionID)
    for (let attempt = 0; attempt < this.lockRetries; attempt += 1) {
      let handle
      try {
        handle = await open(file, "wx", 0o600)
        const owner = `${process.pid}:${randomUUID()}`
        await handle.writeFile(JSON.stringify({ owner, pid: process.pid, createdAtMs: Date.now() }))
        const heartbeat = setInterval(() => { void handle.utimes(new Date(), new Date()).catch(() => {}) }, this.lockHeartbeatMs)
        try { return await fn() } finally {
          clearInterval(heartbeat)
          await handle.close().catch(() => {})
          let currentOwner = null
          try { currentOwner = JSON.parse(await this.readLockFile(file, "utf8")).owner } catch {}
          if (currentOwner === owner) await unlink(file).catch(() => {})
        }
      } catch (error) {
        if (error?.code !== "EEXIST") throw error
        try {
          const observed = await this.stat(file)
          if (this.now() - observed.mtimeMs > this.lockStaleMs) {
            const confirmed = await this.stat(file)
            const observedContents = await this.readLockFile(file, "utf8")
            const confirmedContents = await this.readLockFile(file, "utf8")
            if (
              confirmed.mtimeMs === observed.mtimeMs &&
              observedContents === confirmedContents &&
              this.now() - confirmed.mtimeMs > this.lockStaleMs
            ) {
              await this.unlink(file).catch(() => {})
            }
          }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, this.lockRetryMs))
      }
    }
    throw new Error(`Timed out acquiring Mission state lock for session ${sessionID}`)
  }
}
