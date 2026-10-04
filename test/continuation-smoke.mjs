import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { TargetPlugin } from "../src/server.js"
import { readTarget, setStoppedStatus } from "../src/core.js"

const stateDir = await mkdtemp(path.join(os.tmpdir(), "target-loop-smoke-"))
const messages = new Map()
let promptCount = 0
const client = {
  app: { log: async () => ({}) },
  session: {
    messages: async ({ path }) => ({ data: messages.get(path.id) || [] }),
    children: async () => ({ data: [] }),
    prompt: async ({ path }) => {
      promptCount += 1
      const msg = {
        info: {
          id: `auto-${promptCount}`,
          role: "assistant",
          mode: "build",
          agent: "build",
          time: { created: Date.now(), completed: Date.now() },
          tokens: { input: 25, output: 10, reasoning: 0, cache: { read: 5, write: 0 } },
        },
        parts: [{ type: "text", text: `continuation ${promptCount}` }],
      }
      messages.set(path.id, [...(messages.get(path.id) || []), msg])
      if (promptCount === 2) {
        const current = await readTarget(stateDir, path.id)
        await setStoppedStatus(stateDir, path.id, "complete", "smoke verified", current.targetID)
      }
      return { data: msg }
    },
  },
}

try {
  const hooks = await TargetPlugin({ client }, { state_dir: stateDir, min_continue_interval_ms: 20 })
  const output = { parts: [] }
  await hooks["command.execute.before"]({ command: "target", sessionID: "loop", arguments: "Finish after two mocked turns" }, output)
  await hooks.event({ event: { type: "session.idle", properties: { sessionID: "loop" } } })
  await hooks.whenIdle("loop")
  const final = await readTarget(stateDir, "loop")
  assert.equal(promptCount, 2)
  assert.equal(final.status, "complete")
  assert.equal(final.continuationCount, 2)
  assert.equal(final.tokensUsed, 60)

  const [{ TargetPlugin: TargetPluginA }, { TargetPlugin: TargetPluginB }] = await Promise.all([
    import("../src/server.js?lease-instance=a"),
    import("../src/server.js?lease-instance=b"),
  ])
  let competingPromptCount = 0
  const competingClient = {
    app: client.app,
    session: {
      messages: async ({ path }) => ({ data: messages.get(path.id) || [] }),
      children: async () => ({ data: [] }),
      prompt: async ({ path }) => {
        competingPromptCount += 1
        const current = await readTarget(stateDir, path.id)
        await setStoppedStatus(stateDir, path.id, "complete", "single lease owner", current.targetID)
        return { data: {
          info: {
            id: `competing-${competingPromptCount}`,
            role: "assistant",
            mode: "build",
            agent: "build",
            time: { created: Date.now(), completed: Date.now() },
            tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
          },
          parts: [{ type: "text", text: "completed by lease owner" }],
        } }
      },
    },
  }
  const options = { state_dir: stateDir, min_continue_interval_ms: 0, scheduler_lease_ms: 1000 }
  const [hooksA, hooksB] = await Promise.all([
    TargetPluginA({ client: competingClient }, options),
    TargetPluginB({ client: competingClient }, options),
  ])
  const competingOutput = { parts: [] }
  await hooksA["command.execute.before"]({ command: "target", sessionID: "competing", arguments: "One owner" }, competingOutput)
  await Promise.all([
    hooksA.event({ event: { type: "session.idle", properties: { sessionID: "competing" } } }),
    hooksB.event({ event: { type: "session.idle", properties: { sessionID: "competing" } } }),
  ])
  await Promise.all([hooksA.whenIdle("competing"), hooksB.whenIdle("competing")])
  assert.equal(competingPromptCount, 1)
  assert.equal((await readTarget(stateDir, "competing")).status, "complete")

  let transientFailures = 0
  let transientPromptCount = 0
  let failTransientMessages = false
  const transientClient = {
    app: client.app,
    session: {
      messages: async () => {
        if (failTransientMessages && transientFailures < 2) {
          transientFailures += 1
          throw new Error("temporary messages outage")
        }
        return { data: [] }
      },
      children: async () => ({ data: [] }),
      prompt: async ({ path }) => {
        transientPromptCount += 1
        const current = await readTarget(stateDir, path.id)
        await setStoppedStatus(stateDir, path.id, "complete", "accounting recovered", current.targetID)
        return { data: { info: { id: "transient-done", role: "assistant", tokens: {} }, parts: [] } }
      },
    },
  }
  const transientHooks = await TargetPlugin({ client: transientClient }, {
    state_dir: stateDir,
    min_continue_interval_ms: 0,
    accounting_retry: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 10 },
  })
  await transientHooks["command.execute.before"](
    { command: "target", sessionID: "transient", arguments: "Recover accounting" },
    { parts: [] },
  )
  failTransientMessages = true
  await transientHooks.event({ event: { type: "session.idle", properties: { sessionID: "transient" } } })
  await transientHooks.whenIdle("transient")
  assert.equal(transientFailures, 2)
  assert.equal(transientPromptCount, 1)
  assert.equal((await readTarget(stateDir, "transient")).status, "complete")

  let exposeDeepChild = false
  let incompletePromptCount = 0
  const incompleteClient = {
    app: client.app,
    session: {
      messages: async () => ({ data: [] }),
      children: async ({ path }) => ({ data: exposeDeepChild && path.id === "incomplete" ? [{ id: "child" }] : [] }),
      prompt: async () => {
        incompletePromptCount += 1
        return { data: {} }
      },
    },
  }
  const incompleteHooks = await TargetPlugin({ client: incompleteClient }, {
    state_dir: stateDir,
    descendant_max_depth: 0,
  })
  await incompleteHooks["command.execute.before"](
    { command: "target", sessionID: "incomplete", arguments: "Reject partial accounting" },
    { parts: [] },
  )
  exposeDeepChild = true
  await incompleteHooks.event({ event: { type: "session.idle", properties: { sessionID: "incomplete" } } })
  await incompleteHooks.whenIdle("incomplete")
  const incompleteTarget = await readTarget(stateDir, "incomplete")
  assert.equal(incompletePromptCount, 0)
  assert.equal(incompleteTarget.status, "paused")
  assert.match(incompleteTarget.stopReason, /^Accounting incomplete:/)

  let malformedPromptAttempts = 0
  const malformedPromptClient = {
    app: client.app,
    session: {
      messages: async () => ({ data: [] }),
      children: async () => ({ data: [] }),
      prompt: async () => {
        malformedPromptAttempts += 1
        return { data: { not: "an assistant message" } }
      },
    },
  }
  const malformedPromptHooks = await TargetPlugin({ client: malformedPromptClient }, {
    state_dir: stateDir,
    accounting_retry: { maxAttempts: 2, baseDelayMs: 10, maxDelayMs: 10 },
  })
  await malformedPromptHooks.tool.create_target.execute(
    { objective: "Pause on invalid prompt" },
    { sessionID: "malformed-prompt" },
  )
  await malformedPromptHooks.event({ event: { type: "session.idle", properties: { sessionID: "malformed-prompt" } } })
  await malformedPromptHooks.whenIdle("malformed-prompt")
  const malformedPromptTarget = await readTarget(stateDir, "malformed-prompt")
  assert.equal(malformedPromptAttempts, 2)
  assert.equal(malformedPromptTarget.status, "paused")
  assert.match(malformedPromptTarget.stopReason, /^Continuation host API unavailable after 2 attempts:/)
  let hangingCalls = 0
  let hangingSignal
  const hangingHooks = await TargetPlugin({ client: {
    app: client.app,
    session: {
      messages: async () => ({ data: [] }),
      children: async () => ({ data: [] }),
      prompt: async ({ signal }) => {
        hangingCalls += 1
        hangingSignal = signal
        return new Promise(() => {})
      },
    },
  } }, { state_dir: stateDir, host_api_timeout_ms: 10,
    accounting_retry: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 10 } })
  await hangingHooks.tool.create_target.execute({ objective: "Do not overlap a hanging request" }, { sessionID: "hanging" })
  await hangingHooks.event({ event: { type: "session.idle", properties: { sessionID: "hanging" } } })
  await hangingHooks.event({ event: { type: "session.idle", properties: { sessionID: "hanging" } } })
  await hangingHooks.whenIdle("hanging")
  const hangingTarget = await readTarget(stateDir, "hanging")
  assert.equal(hangingCalls, 1)
  assert.equal(hangingSignal.aborted, true)
  assert.equal(hangingTarget.status, "paused")
  assert.equal(hangingTarget.schedulerLease, null)
  assert.match(hangingTarget.stopReason, /still pending/)
  await hangingHooks.event({ event: { type: "server.instance.disposed" } })
  console.log("continuation smoke: ok")
} finally {
  await rm(stateDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 })
}
