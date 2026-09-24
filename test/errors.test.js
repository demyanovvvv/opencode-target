import assert from "node:assert/strict"
import test from "node:test"
import { eventErrorText, isAbortError, isTransientAccountingError, isUsageLimitError } from "../src/errors.js"

test("event error text extracts common event shapes and safely serializes values", () => {
  assert.equal(eventErrorText({ properties: { error: "offline" } }), "offline")
  assert.equal(eventErrorText({ error: { code: "429" } }), '{"code":"429"}')
  const circular = {}; circular.self = circular
  assert.equal(eventErrorText({ error: circular }), "[object Object]")
  assert.equal(eventErrorText({}), "")
})

test("classifies provider limits, interruptions, and transient host API errors", () => {
  for (const text of ["HTTP 429", "rate limit exceeded", "provider quota", "usage_limited"]) {
    assert.equal(isUsageLimitError(text), true, text)
  }
  for (const text of ["request aborted", "cancelled", "MessageAbortedError"]) {
    assert.equal(isAbortError(text), true, text)
  }
  assert.equal(isUsageLimitError("ordinary tool failure"), false)
  assert.equal(isAbortError("ordinary tool failure"), false)
  for (const code of ["OPENCODE_MESSAGES_FAILED", "OPENCODE_CHILDREN_FAILED", "OPENCODE_PROMPT_FAILED"]) {
    assert.equal(isTransientAccountingError({ code }), true, code)
  }
  assert.equal(isTransientAccountingError({ code: "ACCOUNTING_TRAVERSAL_INCOMPLETE" }), false)
})
