import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { TargetStore } from "../src/store.js"

async function withStore(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-target-store-"))
  try { await fn(new TargetStore(dir)) } finally { await import("node:fs/promises").then(({ rm }) => rm(dir, { recursive: true, force: true })) }
}

test("TargetStore writes atomically and reads JSON state", async () => {
  await withStore(async (store) => {
    await store.write("session", { status: "active", value: 1 })
    assert.deepEqual(await store.read("session"), { status: "active", value: 1 })
    assert.match(await readFile(store.path("session"), "utf8"), /"value": 1/)
  })
})

test("TargetStore retries transient Windows rename failures on write", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-target-store-"))
  const { rm, rename } = await import("node:fs/promises")
  try {
    let attempts = 0
    const store = new TargetStore(dir, {
      rename: async (from, to) => {
        attempts += 1
        if (attempts <= 3) {
          const error = new Error("transient rename")
          error.code = "EPERM"
          throw error
        }
        return rename(from, to)
      },
    })
    await store.write("session", { status: "active", value: 7 })
    assert.equal(attempts, 4)
    assert.deepEqual(await store.read("session"), { status: "active", value: 7 })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("TargetStore surfaces non-transient rename failures on write", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-target-store-"))
  const { rm } = await import("node:fs/promises")
  try {
    const store = new TargetStore(dir, {
      rename: async () => {
        const error = new Error("permanent rename")
        error.code = "ENOSPC"
        throw error
      },
    })
    await assert.rejects(() => store.write("session", { status: "active" }), { code: "ENOSPC" })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("TargetStore encodes session IDs without path traversal or collisions", async () => {
  await withStore(async (store) => {
    const traversal = store.path("..\\..\\outside/session")
    const plain = store.path("outside/session")
    assert.notEqual(traversal, plain)
    assert.equal(path.dirname(traversal), path.join(store.stateDir, "targets"))
    assert.equal(path.dirname(plain), path.join(store.stateDir, "targets"))
    await store.write("..\\..\\outside/session", { value: 1 })
    assert.deepEqual(await store.read("..\\..\\outside/session"), { value: 1 })
  })
})

test("TargetStore quarantines corrupt JSON and exposes a typed error", async () => {
  await withStore(async (store) => {
    await mkdir(path.dirname(store.path("broken")), { recursive: true })
    await writeFile(store.path("broken"), "{broken", "utf8")
    await assert.rejects(() => store.read("broken"), { code: "TARGET_STATE_CORRUPT" })
    assert.equal((await store.listCorrupt()).length, 1)
  })
})

test("TargetStore serializes concurrent mutations per session", async () => {
  await withStore(async (store) => {
    await store.write("session", { count: 0 })
    await Promise.all(Array.from({ length: 8 }, () => store.mutate("session", (state) => ({ count: state.count + 1 }))))
    assert.equal((await store.read("session")).count, 8)
  })
})

test("TargetStore waits long enough to reclaim a lock that becomes stale", async () => {
  await withStore(async (defaultStore) => {
    const store = new TargetStore(defaultStore.stateDir, {
      lockStaleMs: 40,
      lockRetryMs: 10,
      lockRetries: 8,
      lockHeartbeatMs: 10,
    })
    await store.ensureDirs()
    await writeFile(store.lockPath("session"), JSON.stringify({ owner: "crashed" }), "utf8")
    assert.ok((await stat(store.lockPath("session"))).isFile())

    const result = await store.withLock("session", async () => "recovered")
    assert.equal(result, "recovered")
  })
})

test("TargetStore does not reclaim a lock whose heartbeat advances during stale inspection", async () => {
  await withStore(async (defaultStore) => {
    let now = 100
    let statCalls = 0
    let removed = false
    const store = new TargetStore(defaultStore.stateDir, {
      lockStaleMs: 50,
      lockRetryMs: 0,
      lockRetries: 1,
      now: () => now,
      stat: async () => {
        statCalls += 1
        if (statCalls === 1) return { mtimeMs: 0 }
        return { mtimeMs: 100 }
      },
      unlink: async () => { removed = true },
    })
    await store.ensureDirs()
    await writeFile(store.lockPath("session"), JSON.stringify({ owner: "active" }), "utf8")

    await assert.rejects(() => store.withLock("session", async () => {}), /Timed out acquiring/)
    assert.equal(removed, false)
  })
})

test("TargetStore release requires exact lock owner identity", async () => {
  await withStore(async (defaultStore) => {
    let lockContents = null
    let removed = false
    const store = new TargetStore(defaultStore.stateDir, {
      readLockFile: async () => lockContents,
      unlink: async () => { removed = true },
    })
    const result = await store.withLock("session", async () => {
      lockContents = JSON.stringify({ owner: "replacement-owner" })
      return "ok"
    })
    assert.equal(result, "ok")
    assert.equal(removed, false)
  })
})

test("TargetStore does not remove a replacement lock with unchanged mtime", async () => {
  await withStore(async (defaultStore) => {
    let reads = 0
    let removed = false
    const store = new TargetStore(defaultStore.stateDir, {
      lockStaleMs: 50,
      lockRetryMs: 0,
      lockRetries: 1,
      stat: async () => ({ mtimeMs: 0 }),
      readLockFile: async () => {
        reads += 1
        return reads === 1 ? JSON.stringify({ owner: "old" }) : JSON.stringify({ owner: "replacement" })
      },
      unlink: async () => { removed = true },
    })
    await store.ensureDirs()
    await writeFile(store.lockPath("session"), JSON.stringify({ owner: "old" }), "utf8")

    await assert.rejects(() => store.withLock("session", async () => {}), /Timed out acquiring/)
    assert.equal(removed, false)
  })
})
