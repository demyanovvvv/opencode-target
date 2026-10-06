import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { registerComponent, reconcileHost } from "../host-components.mjs"

for (const order of [["patchline", "target"], ["target", "patchline"]]) test(`component lifecycle in order ${order.join(", ")}`, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "host-transitions-"))
  const active = {}
  let executable = "1.18.34"
  const adapters = {
    build: async ({ version }) => version,
    install: async (version) => { const previous = executable; executable = version; return async () => { executable = previous } },
    verify: async (version) => assert.equal(executable, version),
  }
  const rebuild = async (upstream = "1.18.34") => {
    await reconcileHost(dir, upstream, adapters)
    assert.equal(executable, upstream + ["patchline", "target"].filter((name) => active[name]).map((name) => `+${name}.${active[name]}`).join(""))
    assert.equal(JSON.parse(await readFile(path.join(dir, "host-components.json"))).host.version, executable)
  }
  try {
    await rebuild()
    for (const name of order) {
      await writeFile(path.join(dir, `${name}.js`), "plugin")
      active[name] = name === "patchline" ? "1.2.0" : "0.5.0"
      for (let repeat = 0; repeat < 2; repeat++) {
        await registerComponent(dir, name, { version: active[name], files: [`${name}.js`] })
        await rebuild()
      }
    }
    for (const name of order) {
      active[name] = name === "patchline" ? "1.3.0" : "0.6.0"
      await registerComponent(dir, name, { version: active[name], files: [`${name}.js`] })
      await rebuild()
    }
    await rebuild("1.18.35")
    for (const name of order) {
      await registerComponent(dir, name, null)
      delete active[name]
      await rebuild()
    }
    await registerComponent(dir, "target", { version: "0.5.0", files: ["missing.js"] })
    await rebuild()
  } finally { await rm(dir, { recursive: true, force: true }) }
})
