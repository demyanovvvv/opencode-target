import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"

test("Target wrappers let the locked helper own copying and host installation", async () => {
  for (const file of ["install.ps1", "install.sh"]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8")
    assert.ok(source.includes("--install-files"), `${file} delegates complete installation`)
    assert.doesNotMatch(source, /Copy-Item|\ncp /)
  }
})
