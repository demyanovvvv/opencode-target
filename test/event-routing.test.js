import assert from "node:assert/strict"
import test from "node:test"
import { resolveEventAction } from "../src/event-routing.js"

test("resolves lifecycle and session actions while preserving session ID variants", () => {
  assert.deepEqual(resolveEventAction({ type: "server.instance.disposed" }), { action: "dispose" })
  assert.deepEqual(resolveEventAction({ type: "session.deleted", properties: { sessionID: "s" } }), {
    action: "dispose-session", sessionID: "s",
  })
  assert.deepEqual(resolveEventAction({ type: "session.deleted", properties: { info: { id: "sdk-session" } } }), {
    action: "dispose-session", sessionID: "sdk-session",
  })
  assert.deepEqual(resolveEventAction({ type: "session.idle", sessionId: "s" }, true), {
    action: "process-idle", sessionID: "s",
  })
  assert.deepEqual(resolveEventAction({ type: "session.error", properties: { sessionId: "s" } }), {
    action: "process-error", sessionID: "s",
  })
})

test("ignores events without a session and idle events when automatic continuation is off", () => {
  assert.deepEqual(resolveEventAction({ type: "session.deleted" }), { action: "ignore" })
  assert.deepEqual(resolveEventAction({ type: "session.idle", sessionID: "s" }, false), { action: "ignore" })
  assert.deepEqual(resolveEventAction({ type: "message.updated", sessionID: "s" }), { action: "ignore" })
})
