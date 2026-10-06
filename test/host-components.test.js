import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { hostVersion, readComponents, registerComponent } from "../host-components.mjs"

test("host version has deterministic independent component suffixes", () => {
  assert.equal(hostVersion("1.18.34", {}), "1.18.34")
  assert.equal(hostVersion("1.18.34", { target: { version: "0.5.0" } }), "1.18.34+target.0.5.0")
  assert.equal(hostVersion("1.18.34", { patchline: { version: "1.2.0" } }), "1.18.34+patchline.1.2.0")
  assert.equal(hostVersion("1.18.34", { target: { version: "0.5.0" }, patchline: { version: "1.2.0" } }), "1.18.34+patchline.1.2.0+target.0.5.0")
  assert.throws(() => hostVersion("1.18.34", { target: { version: "bad" } }), /version/)
})

test("component registration preserves peers and verifies actual files", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "host-components-"))
  try {
    await mkdir(path.join(dir, "plugins"))
    for (const name of ["target", "patchline"]) await writeFile(path.join(dir, "plugins", `${name}.js`), "plugin")
    await registerComponent(dir, "patchline", { version: "1.2.0", files: ["plugins/patchline.js"] })
    await registerComponent(dir, "target", { version: "0.5.0", files: ["plugins/target.js"] })
    assert.deepEqual(Object.keys(await readComponents(dir)).sort(), ["patchline", "target"])
    await registerComponent(dir, "target", null)
    assert.deepEqual(Object.keys(await readComponents(dir)), ["patchline"])
    await rm(path.join(dir, "plugins", "patchline.js"))
    assert.deepEqual(await readComponents(dir), {})
    assert.equal(JSON.parse(await readFile(path.join(dir, "host-components.json"))).schema, 1)
  } finally { await rm(dir, { recursive: true, force: true }) }
})