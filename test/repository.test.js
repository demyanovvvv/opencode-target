import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { TargetRepository } from "../src/repository.js"

async function withRepository(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-target-repository-"))
  try {
    await fn(new TargetRepository(dir, { normalize: (value) => ({ ...value, normalized: true }) }))
  } finally {
    await import("node:fs/promises").then(({ rm }) => rm(dir, { recursive: true, force: true }))
  }
}

test("TargetRepository owns normalized read/write and session mutation", async () => {
  await withRepository(async (repository) => {
    await repository.write({ sessionID: "session", value: 1 })
    assert.deepEqual(await repository.read("session"), {
      sessionID: "session",
      value: 1,
      normalized: true,
    })

    await repository.mutate("session", (target) => ({ ...target, value: target.value + 1 }))
    assert.equal((await repository.read("session")).value, 2)
  })
})

test("TargetRepository quarantines invalid normalized state", async () => {
  await withRepository(async (repository) => {
    await repository.write({ sessionID: "broken", value: 1 })
    await writeFile(repository.store.path("broken"), JSON.stringify({ sessionID: "wrong", value: 2 }), "utf8")

    await assert.rejects(
      () => repository.readValidated("broken", (value) => {
        if (value.sessionID !== "broken") throw new Error("session identity mismatch")
        return value
      }),
      { code: "TARGET_STATE_CORRUPT" },
    )
    assert.equal((await repository.store.listCorrupt()).length, 1)
  })
})
