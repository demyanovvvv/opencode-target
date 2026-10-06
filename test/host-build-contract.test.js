import assert from "node:assert/strict"
import test from "node:test"
import * as build from "../host-build.mjs"

test("host extension transforms are conditional and fail closed on unsupported seams", () => {
  assert.equal(typeof build.transformHostFile, "function")
  const registry = "if (tool.id === ApplyPatchTool.id) return usePatch\nif (tool.id === EditTool.id || tool.id === WriteTool.id) return !usePatch"
  assert.equal(build.transformHostFile("registry", registry, {}), registry)
  assert.match(build.transformHostFile("registry", registry, { patchline: {} }), /ApplyPatchTool.id\) return true/)
  assert.equal(build.transformHostFile("registry", registry, { target: {} }), registry)
  assert.throws(() => build.transformHostFile("registry", "changed upstream", { patchline: {} }), /Unsupported/)
  const session = "function ToolPart(props: anything) {\n  const ctx = use()\n      <Switch>body</Switch>\n}\ntype ToolProps = {}"
  const next = build.transformHostFile("session", session, { patchline: {} })
  assert.match(next, /name=\{`tool_\$\{props.part.tool\}`\}/)
  assert.equal(build.transformHostFile("session", session, { target: {} }), session)
})
