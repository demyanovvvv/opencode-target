import assert from "node:assert/strict"
import test from "node:test"
import { transformHostFile } from "../host-build.mjs"

test("Target uses the upstream prompt slot without transforming host source", () => {
  const source = 'import { useProject } from "../../context/project"\nexport function Prompt(props: PromptProps) {\n<box width="100%" flexDirection="row" justifyContent="space-between">\n<Switch>\nflexGrow={1}\n                justifyContent={status().type === "retry" ? "space-between" : "flex-start"}\n</Switch>\n<Show when={status().type !== "retry"}>'
  assert.equal(transformHostFile("prompt", source, { patchline: {} }), source)
  const next = transformHostFile("prompt", source, { target: {} })
  assert.equal(next, source)
  assert.doesNotMatch(next, /session_prompt_status/)
})
