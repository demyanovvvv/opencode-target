import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { deployHostRuntime } from "../host-runtime.mjs"

test("deployed coordinator can reconcile without either checkout", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "host-deploy-"))
  try {
    const cli = await deployHostRuntime(dir)
    assert.equal(path.basename(cli), "host-cli.mjs")
    assert.match(await readFile(cli, "utf8"), /installCoordinatedHostLocked/)
    const runtime = await import(new URL(`file:///${path.join(dir, "host-runtime/host-components.mjs").replaceAll("\\", "/")}`))
    await runtime.registerComponent(dir, "target", { version: "0.5.0", files: ["plugins/target.js"], registration: "opencode-target" })
    await mkdir(path.join(dir, "plugins"))
    await writeFile(path.join(dir, "plugins/target.js"), "plugin")
    await writeFile(path.join(dir, "tui.json"), '{"plugin":["./tui-plugins/target.js"]}')
    assert.equal((await runtime.readComponents(dir)).target.version, "0.5.0")
  } finally { await rm(dir, { recursive: true, force: true }) }
})
