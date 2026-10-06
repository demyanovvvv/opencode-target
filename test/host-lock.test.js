import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, rm, mkdir, symlink, access } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { withHostLock } from "../host-components.mjs"

test("host lock releases after failure and times out without stealing ownership", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "host-lock-"))
  try {
    await assert.rejects(withHostLock(dir, async () => { throw new Error("build failed") }), /build failed/)
    await withHostLock(dir, async () => {
      await assert.rejects(withHostLock(dir, async () => assert.fail("entered busy operation"), { timeout: 10 }), /timeout/)
      await access(path.join(dir, ".host-components.lock", "owner.json"))
    })
    await withHostLock(dir, async () => {})
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test("host lock rejects a symlink instead of deleting its destination", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "host-lock-"))
  try {
    const destination = path.join(dir, "other")
    await mkdir(destination)
    await symlink(destination, path.join(dir, ".host-components.lock"), process.platform === "win32" ? "junction" : "dir")
    await assert.rejects(withHostLock(dir, async () => assert.fail("unsafe operation")), /Unsafe/)
    await access(destination)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
