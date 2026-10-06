import assert from "node:assert/strict"
import test from "node:test"
import { transformHostFile } from "../host-build.mjs"

test("prompt status slot uses session_id and bounded width only when Target is installed", () => {
  const source = 'import { useProject } from "../../context/project"\nexport function Prompt(props: PromptProps) {\n<box width="100%" flexDirection="row" justifyContent="space-between">\n<Switch>\nflexGrow={1}\n                justifyContent={status().type === "retry" ? "space-between" : "flex-start"}\n</Switch>\n<Show when={status().type !== "retry"}>'
  assert.equal(transformHostFile("prompt", source, { patchline: {} }), source)
  const next = transformHostFile("prompt", source, { target: {} })
  assert.match(next, /name="session_prompt_status" session_id=\{props.sessionID!\}/)
  assert.match(next, /Math.max\(0, Math.min\(36, dimensions\(\).width - 58\)\)/)
  assert.equal(next.match(/name="session_prompt_status"/g).length, 1)
})
