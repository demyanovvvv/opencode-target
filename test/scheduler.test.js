import assert from "node:assert/strict"
import test from "node:test"

import { SchedulerState } from "../src/scheduler.js"

function fakeTimers() {
  let nextID = 1
  const timeouts = new Map()
  const intervals = new Map()
  return {
    api: {
      setTimeout(callback, delay) {
        const id = nextID++
        timeouts.set(id, { callback, delay })
        return id
      },
      clearTimeout(id) {
        timeouts.delete(id)
      },
      setInterval(callback, delay) {
        const id = nextID++
        intervals.set(id, { callback, delay })
        return id
      },
      clearInterval(id) {
        intervals.delete(id)
      },
    },
    timeouts,
    intervals,
  }
}

test("runExclusive deduplicates a session and releases it after completion", async () => {
  const scheduler = new SchedulerState()
  let release
  const blocked = new Promise((resolve) => {
    release = resolve
  })

  const first = scheduler.runExclusive("session-a", async () => {
    await blocked
    return "finished"
  })
  const duplicate = await scheduler.runExclusive("session-a", async () => "duplicate")

  assert.deepEqual(duplicate, { started: false, value: undefined })
  release()
  assert.deepEqual(await first, { started: true, value: "finished" })
  assert.deepEqual(await scheduler.runExclusive("session-a", async () => "next"), {
    started: true,
    value: "next",
  })
})

test("scheduler instances do not share in-process ownership", async () => {
  const first = new SchedulerState()
  const second = new SchedulerState()
  let release
  const blocked = new Promise((resolve) => {
    release = resolve
  })

  const running = first.runExclusive("same-session", () => blocked)
  assert.deepEqual(await second.runExclusive("same-session", async () => "independent"), {
    started: true,
    value: "independent",
  })
  release()
  await running
})

test("whenIdle resolves immediately when no work is in flight", async () => {
  const scheduler = new SchedulerState()
  let settled = false
  const pending = scheduler.whenIdle("session-a").then(() => { settled = true })
  await Promise.resolve()
  assert.equal(settled, true)
  await pending
})

test("whenIdle waits for in-flight work and any scheduled recheck", async () => {
  const timers = fakeTimers()
  const scheduler = new SchedulerState(timers.api)
  let release
  const blocked = new Promise((resolve) => { release = resolve })
  let recheckRun = null
  const run = scheduler.runExclusive("session-a", async () => {
    await blocked
    scheduler.scheduleRecheck("session-a", 10, () => {
      recheckRun = scheduler.runExclusive("session-a", async () => {})
    })
  })
  let settled = false
  const idle = scheduler.whenIdle("session-a").then(() => { settled = true })
  await Promise.resolve()
  assert.equal(settled, false)

  release()
  await run
  await Promise.resolve()
  assert.equal(settled, false, "a pending recheck keeps the session unsettled")
  assert.equal(scheduler.isSettled("session-a"), false)

  const recheck = [...timers.timeouts.values()].at(-1)
  recheck.callback()
  await recheckRun
  await Promise.resolve()
  assert.equal(settled, true)
  await idle
})

test("disposing a session resolves pending idle waiters", async () => {
  const scheduler = new SchedulerState()
  let release
  const blocked = new Promise((resolve) => { release = resolve })
  let settled = false
  const idle = scheduler.whenIdle("session-a").then(() => { settled = true })
  const run = scheduler.runExclusive("session-a", () => blocked)
  await Promise.resolve()

  scheduler.disposeSession("session-a")
  await Promise.resolve()
  assert.equal(settled, true)

  release()
  await run
  await idle
})

test("scheduleRecheck replaces the existing session timer before invoking", () => {
  const timers = fakeTimers()
  const scheduler = new SchedulerState(timers.api)
  const calls = []

  scheduler.scheduleRecheck("session-a", 25, () => calls.push("old"))
  const oldID = [...timers.timeouts.keys()][0]
  scheduler.scheduleRecheck("session-a", -1, () => calls.push("new"))
  const [newID, timer] = [...timers.timeouts.entries()][0]

  assert.notEqual(newID, oldID)
  assert.equal(timers.timeouts.has(oldID), false)
  assert.equal(timer.delay, 0)
  timer.callback()
  assert.deepEqual(calls, ["new"])
  assert.equal(scheduler.hasScheduledRecheck("session-a"), false)
})

test("a stale recheck callback cannot remove its replacement", () => {
  const timers = fakeTimers()
  const scheduler = new SchedulerState(timers.api)
  scheduler.scheduleRecheck("session-a", 10, () => {})
  const stale = [...timers.timeouts.values()][0]

  scheduler.scheduleRecheck("session-a", 20, () => {})
  stale.callback()

  assert.equal(scheduler.hasScheduledRecheck("session-a"), true)
})

test("heartbeat is stopped on replacement and session disposal", () => {
  const timers = fakeTimers()
  const scheduler = new SchedulerState(timers.api)

  scheduler.startHeartbeat("session-a", 100, () => {})
  const oldID = [...timers.intervals.keys()][0]
  scheduler.startHeartbeat("session-a", 200, () => {})
  const [newID, heartbeat] = [...timers.intervals.entries()][0]

  assert.notEqual(newID, oldID)
  assert.equal(timers.intervals.has(oldID), false)
  assert.equal(heartbeat.delay, 200)
  scheduler.disposeSession("session-a")
  assert.equal(timers.intervals.size, 0)
})

test("dispose clears all pending timers and prevents new timers", () => {
  const timers = fakeTimers()
  const scheduler = new SchedulerState(timers.api)
  scheduler.scheduleRecheck("session-a", 10, () => {})
  scheduler.startHeartbeat("session-b", 10, () => {})

  scheduler.dispose()

  assert.equal(timers.timeouts.size, 0)
  assert.equal(timers.intervals.size, 0)
  assert.equal(scheduler.scheduleRecheck("session-c", 10, () => {}), false)
  assert.equal(scheduler.startHeartbeat("session-c", 10, () => {}), false)
})

test("nextRetry applies bounded exponential backoff and resets after success", () => {
  const scheduler = new SchedulerState()
  const policy = { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 150 }

  assert.deepEqual(scheduler.nextRetry("session-a", policy), { attempt: 1, retry: true, delayMs: 100 })
  assert.deepEqual(scheduler.nextRetry("session-a", policy), { attempt: 2, retry: true, delayMs: 150 })
  assert.deepEqual(scheduler.nextRetry("session-a", policy), { attempt: 3, retry: false, delayMs: 0 })

  scheduler.resetRetries("session-a")
  assert.deepEqual(scheduler.nextRetry("session-a", policy), { attempt: 1, retry: true, delayMs: 100 })
})

test("session and scheduler disposal clear retry state", () => {
  const scheduler = new SchedulerState()
  const policy = { maxAttempts: 2, baseDelayMs: 10, maxDelayMs: 10 }
  scheduler.nextRetry("session-a", policy)
  scheduler.disposeSession("session-a")
  assert.deepEqual(scheduler.nextRetry("session-a", policy), { attempt: 1, retry: true, delayMs: 10 })

  scheduler.nextRetry("session-b", policy)
  scheduler.dispose()
  assert.deepEqual(scheduler.nextRetry("session-b", policy), { attempt: 0, retry: false, delayMs: 0 })
})

test("retry scopes are independent within one session", () => {
  const scheduler = new SchedulerState()
  const policy = { maxAttempts: 2, baseDelayMs: 10, maxDelayMs: 10 }

  assert.equal(scheduler.nextRetry("session-a", policy, "pre").attempt, 1)
  assert.equal(scheduler.nextRetry("session-a", policy, "post").attempt, 1)
  assert.equal(scheduler.nextRetry("session-a", policy, "post").retry, false)
  scheduler.resetRetries("session-a", "post")
  assert.equal(scheduler.nextRetry("session-a", policy, "post").attempt, 1)
  assert.equal(scheduler.nextRetry("session-a", policy, "pre").retry, false)
})
