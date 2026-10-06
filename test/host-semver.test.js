import assert from "node:assert/strict"
import test from "node:test"
import * as host from "../host-components.mjs"

test("display version and SemVer version have distinct representations", () => {
  assert.equal(typeof host.hostSemver, "function")
  const components = { target: { version: "0.5.0" }, patchline: { version: "1.2.0" } }
  assert.equal(host.hostVersion("1.18.34", components), "1.18.34+patchline.1.2.0+target.0.5.0")
  assert.equal(host.hostSemver("1.18.34", components), "1.18.34+patchline.1.2.0.target.0.5.0")
})
