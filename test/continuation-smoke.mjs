import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { MissionPlugin } from "../src/server.js"
import { readMission, setStoppedStatus } from "../src/core.js"

const stateDir = await mkdtemp(path.join(os.tmpdir(), "mission-loop-smoke-"))
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
        const current = await readMission(stateDir, path.id)
        await setStoppedStatus(stateDir, path.id, "complete", "smoke verified", current.missionID)
      }
      return { data: msg }
    },
  },
}

try {
  const hooks = await MissionPlugin({ client }, { state_dir: stateDir, min_continue_interval_ms: 20 })
  const output = { parts: [] }
  await hooks["command.execute.before"]({ command: "mission", sessionID: "loop", arguments: "Finish after two mocked turns" }, output)
  await hooks.event({ event: { type: "session.idle", properties: { sessionID: "loop" } } })
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    const current = await readMission(stateDir, "loop")
    if (promptCount >= 2 && current?.status === "complete" && current.tokensUsed === 60) break
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  const final = await readMission(stateDir, "loop")
  assert.equal(promptCount, 2)
  assert.equal(final.status, "complete")
  assert.equal(final.continuationCount, 2)
  assert.equal(final.tokensUsed, 60)

  const [{ MissionPlugin: MissionPluginA }, { MissionPlugin: MissionPluginB }] = await Promise.all([
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
        const current = await readMission(stateDir, path.id)
        await setStoppedStatus(stateDir, path.id, "complete", "single lease owner", current.missionID)
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
    MissionPluginA({ client: competingClient }, options),
    MissionPluginB({ client: competingClient }, options),
  ])
  const competingOutput = { parts: [] }
  await hooksA["command.execute.before"]({ command: "mission", sessionID: "competing", arguments: "One owner" }, competingOutput)
  await Promise.all([
    hooksA.event({ event: { type: "session.idle", properties: { sessionID: "competing" } } }),
    hooksB.event({ event: { type: "session.idle", properties: { sessionID: "competing" } } }),
  ])
  const competingDeadline = Date.now() + 3000
  while (competingPromptCount < 1 && Date.now() < competingDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.equal(competingPromptCount, 1)
  const competingStatusDeadline = Date.now() + 1000
  while ((await readMission(stateDir, "competing")).status === "active" && Date.now() < competingStatusDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal((await readMission(stateDir, "competing")).status, "complete")

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
        const current = await readMission(stateDir, path.id)
        await setStoppedStatus(stateDir, path.id, "complete", "accounting recovered", current.missionID)
        return { data: { info: { id: "transient-done", role: "assistant", tokens: {} }, parts: [] } }
      },
    },
  }
  const transientHooks = await MissionPlugin({ client: transientClient }, {
    state_dir: stateDir,
    min_continue_interval_ms: 0,
    accounting_retry: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 10 },
  })
  await transientHooks["command.execute.before"](
    { command: "mission", sessionID: "transient", arguments: "Recover accounting" },
    { parts: [] },
  )
  failTransientMessages = true
  await transientHooks.event({ event: { type: "session.idle", properties: { sessionID: "transient" } } })
  const transientDeadline = Date.now() + 3000
  while (Date.now() < transientDeadline) {
    const current = await readMission(stateDir, "transient")
    if (transientPromptCount >= 1 && current?.status === "complete") break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(transientFailures, 2)
  assert.equal(transientPromptCount, 1)
  assert.equal((await readMission(stateDir, "transient")).status, "complete")

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
  const incompleteHooks = await MissionPlugin({ client: incompleteClient }, {
    state_dir: stateDir,
    descendant_max_depth: 0,
  })
  await incompleteHooks["command.execute.before"](
    { command: "mission", sessionID: "incomplete", arguments: "Reject partial accounting" },
    { parts: [] },
  )
  exposeDeepChild = true
  await incompleteHooks.event({ event: { type: "session.idle", properties: { sessionID: "incomplete" } } })
  const incompleteDeadline = Date.now() + 1000
  while ((await readMission(stateDir, "incomplete")).status === "active" && Date.now() < incompleteDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const incompleteMission = await readMission(stateDir, "incomplete")
  assert.equal(incompletePromptCount, 0)
  assert.equal(incompleteMission.status, "paused")
  assert.match(incompleteMission.stopReason, /^Accounting incomplete:/)

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
  const malformedPromptHooks = await MissionPlugin({ client: malformedPromptClient }, {
    state_dir: stateDir,
    accounting_retry: { maxAttempts: 2, baseDelayMs: 10, maxDelayMs: 10 },
  })
  await malformedPromptHooks.tool.create_mission.execute(
    { objective: "Pause on invalid prompt" },
    { sessionID: "malformed-prompt" },
  )
  await malformedPromptHooks.event({ event: { type: "session.idle", properties: { sessionID: "malformed-prompt" } } })
  const malformedPromptDeadline = Date.now() + 1000
  while ((await readMission(stateDir, "malformed-prompt"))?.status === "active" && Date.now() < malformedPromptDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const malformedPromptMission = await readMission(stateDir, "malformed-prompt")
  assert.equal(malformedPromptAttempts, 2)
  assert.equal(malformedPromptMission.status, "paused")
  assert.match(malformedPromptMission.stopReason, /^Continuation host API unavailable after 2 attempts:/)
  console.log("continuation smoke: ok")
} finally {
  await rm(stateDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 })
}
