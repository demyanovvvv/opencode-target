import assert from "node:assert/strict"
import test from "node:test"
import { normalizeVerificationResult } from "../src/verification.js"

test("normalizeVerificationResult exposes one typed result for passed shell output", () => {
  assert.deepEqual(normalizeVerificationResult({ exitCode: 0, stdout: "passed", stderr: "" }, { attempts: 2 }), {
    passed: true,
    attempts: 2,
    retryableFailure: true,
    output: "passed",
    errorKind: null,
  })
})

test("normalizeVerificationResult preserves failed output and error kind", () => {
  assert.deepEqual(normalizeVerificationResult({ exitCode: 1, stdout: "", stderr: "failed" }, { attempts: 1 }), {
    passed: false,
    attempts: 1,
    retryableFailure: false,
    output: "failed",
    errorKind: "exit_code",
  })
})

test("normalizeVerificationResult identifies signal-style command failures", () => {
  assert.equal(normalizeVerificationResult({ exitCode: 137 }, {}).errorKind, "exit_code")
})
