import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { replaceHostBinary } from "../host-runtime.mjs"

test("host replacement restores the previous bytes and refuses externally changed rollback", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "host-binary-"))
  try {
    const source = path.join(dir, "new.exe")
    const target = path.join(dir, "host.exe")
    await writeFile(source, "new")
    await writeFile(target, "old")
    const restore = await replaceHostBinary(source, target)
    assert.equal(await readFile(target, "utf8"), "new")
    await restore()
    assert.equal(await readFile(target, "utf8"), "old")
    const guarded = await replaceHostBinary(source, target)
    await writeFile(target, "external")
    await assert.rejects(guarded(), /changed externally/)
    assert.equal(await readFile(target, "utf8"), "external")
  } finally { await rm(dir, { recursive: true, force: true }) }
})
