import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { registerComponent, readComponents } from "../host-components.mjs"

test("components with package and registration evidence use actual package versions", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "host-registration-"))
  try {
    await mkdir(path.join(dir, "node_modules/opencode-patchline"), { recursive: true })
    await writeFile(path.join(dir, "node_modules/opencode-patchline/package.json"), '{"name":"opencode-patchline","version":"1.3.0"}')
    await registerComponent(dir, "patchline", { version: "1.1.0", files: ["node_modules/opencode-patchline/package.json"], packageFile: "node_modules/opencode-patchline/package.json", registration: "opencode-patchline" })
    assert.deepEqual(await readComponents(dir), {})
    await writeFile(path.join(dir, "opencode.jsonc"), '{// server\n"plugin":["opencode-patchline/server"],}')
    await writeFile(path.join(dir, "tui.json"), '{"plugin":["opencode-patchline/tui"]}')
    assert.equal((await readComponents(dir)).patchline.version, "1.3.0")
    await writeFile(path.join(dir, "tui.json"), '{"plugin":["opencode-patchline/tui"],"plugin_enabled":{"opencode-patchline":false}}')
    assert.deepEqual(await readComponents(dir), {})
  } finally { await rm(dir, { recursive: true, force: true }) }
})
