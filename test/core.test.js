import assert from "node:assert/strict"
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  acquireSchedulerLease,
  accountTargetUsage,
  addTargetEvidence,
  getTargetHistory,
  targetReport,
  addTargetCheckpoint,
  listTargetCheckpoints,
  recordVerificationResult,
  cleanupStateDir,
  consumeContinuationDeferral,
  createTarget,
  deferNextContinuation,
  editTarget,
  extractAssistantUsage,
  targetPath,
  markBudgetWrapupSent,
  markContinuationStarted,
  parseTargetCommand,
  pauseTarget,
  readTarget,
  recordTargetTurnOutcome,
  recordTargetTurnOutcomes,
  releaseSchedulerLease,
  renewSchedulerLease,
  resumeTarget,
  refreshTargetEvidence,
  normalizeRetryPolicy,
  isRetryableVerificationFailure,
  seedTargetUsageBaselines,
  setTargetBudget,
  setStoppedStatus,
  snapshotTarget,
  sleep,
  writeTarget,
} from "../src/core.js"

async function withState(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-target-test-"))
  try {
    await fn(dir)
  } finally {
    await cleanupStateDir(dir)
  }
}

function assistant(id, { input = 0, cached = 0, output = 0, mode = "build", parts = [], created = Date.now() } = {}) {
  return {
    info: {
      id,
      role: "assistant",
      mode,
      agent: mode,
      time: { created, completed: created + 1 },
      tokens: { input, output, reasoning: 0, cache: { read: cached, write: 0 } },
    },
    parts,
  }
}

const failedExec = (id) => assistant(id, {
  parts: [{ type: "tool", tool: "bash", state: { status: "error" } }],
})

const successfulTool = (id) => assistant(id, {
  parts: [{ type: "tool", tool: "bash", state: { status: "completed" } }],
})

test("Target lifecycle: create, pause, resume, complete, then replace with a fresh target", async () => {
  await withState(async (dir) => {
    const a = await createTarget(dir, "s1", "Ship verified auth flow", 10_000)
    assert.equal(a.status, "active")
    assert.ok(a.targetID)

    await assert.rejects(() => createTarget(dir, "s1", "Cannot replace unfinished"), /unfinished Target/)

    const paused = await pauseTarget(dir, "s1", "user pause", a.targetID)
    assert.equal(paused.status, "paused")

    const resumed = await resumeTarget(dir, "s1", a.targetID)
    assert.equal(resumed.status, "active")

    const complete = await setStoppedStatus(dir, "s1", "complete", "verified", a.targetID)
    assert.equal(complete.status, "complete")
    await assert.rejects(
      () => pauseTarget(dir, "s1", "late pause", a.targetID),
      /Completed Targets are immutable/,
    )

    const b = await createTarget(dir, "s1", "Second target", 5_000)
    assert.equal(b.status, "active")
    assert.notEqual(b.targetID, a.targetID)
    assert.equal(b.tokensUsed, 0)
    assert.equal(b.continuationCount, 0)
  })
})

test("unknown persisted status is quarantined instead of becoming active", async () => {
  await withState(async (dir) => {
    const file = targetPath(dir, "corrupt-status")
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({
      version: 3,
      sessionID: "corrupt-status",
      targetID: "target-corrupt-status",
      objective: "Do not revive invalid state",
      status: "future_status",
    }))

    await assert.rejects(
      () => readTarget(dir, "corrupt-status"),
      (error) => error?.code === "TARGET_STATE_CORRUPT",
    )
    assert.equal(await readTarget(dir, "corrupt-status"), null)
  })
})

test("persisted Target identity fields are required and quarantined", async () => {
  await withState(async (dir) => {
    const file = targetPath(dir, "invalid-identity")
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({
      version: 3,
      sessionID: "invalid-identity",
      objective: "Do not synthesize identity",
      status: "paused",
    }))

    await assert.rejects(
      () => readTarget(dir, "invalid-identity"),
      (error) => error?.code === "TARGET_STATE_CORRUPT",
    )
    assert.equal(await readTarget(dir, "invalid-identity"), null)
  })
})

test("persisted Target session identity must match its session file", async () => {
  await withState(async (dir) => {
    const file = targetPath(dir, "requested-session")
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({
      version: 3,
      sessionID: "different-session",
      targetID: "target-mismatch",
      objective: "Do not cross session boundaries",
      status: "paused",
    }))

    await assert.rejects(
      () => readTarget(dir, "requested-session"),
      (error) => error?.code === "TARGET_STATE_CORRUPT",
    )
    assert.equal(await readTarget(dir, "requested-session"), null)
  })
})

test("persisted schema accepts version 2 but quarantines unknown versions", async () => {
  await withState(async (dir) => {
    const legacyFile = targetPath(dir, "legacy-v2")
    await mkdir(path.dirname(legacyFile), { recursive: true })
    await writeFile(legacyFile, JSON.stringify({
      version: 2,
      sessionID: "legacy-v2",
      targetID: "target-legacy-v2",
      objective: "Load supported legacy state",
      status: "paused",
      tokenBudget: 500,
      tokensUsed: 12,
      rootTokensUsed: 12,
      descendantTokensUsed: 0,
      timeUsedSeconds: 4,
      createdAtMs: 100,
      updatedAtMs: 200,
      accumulatedActiveMs: 4_000,
      continuationCount: 2,
      budgetWrapupSent: false,
      usageByMessage: { "legacy-message": 12 },
      runtime: { noProgressStreak: 1 },
    }))
    const legacy = await readTarget(dir, "legacy-v2")
    assert.equal(legacy.version, 3)
    assert.equal(legacy.tokenBudget, 500)
    assert.equal(legacy.tokensUsed, 12)
    assert.equal(legacy.continuationCount, 2)
    assert.equal(legacy.usageByMessage["legacy-message"], 12)

    const futureFile = targetPath(dir, "future-v4")
    await writeFile(futureFile, JSON.stringify({
      version: 4,
      sessionID: "future-v4",
      targetID: "target-future-v4",
      objective: "Do not guess future schema semantics",
      status: "paused",
    }))
    await assert.rejects(
      () => readTarget(dir, "future-v4"),
      (error) => error?.code === "TARGET_STATE_CORRUPT",
    )
  })
})

test("token accounting uses non-cached input + output, excludes plan mode, splits descendant usage, and is idempotent", async () => {
  await withState(async (dir) => {
    const m = await createTarget(dir, "root", "Do work")
    const samples = [
      { sessionID: "root", message: assistant("m1", { input: 100, cached: 40, output: 20 }) },
      { sessionID: "root", message: assistant("m2", { input: 999, output: 999, mode: "plan" }) },
      { sessionID: "child", message: assistant("c1", { input: 50, cached: 10, output: 15 }) },
    ]
    let updated = await accountTargetUsage(dir, "root", samples, { expectedTargetID: m.targetID })
    assert.equal(updated.rootTokensUsed, 120)
    assert.equal(updated.descendantTokensUsed, 65)
    assert.equal(updated.tokensUsed, 185)

    updated = await accountTargetUsage(dir, "root", samples, { expectedTargetID: m.targetID })
    assert.equal(updated.tokensUsed, 185)

    // Same assistant message can grow while streaming; only the positive delta is added.
    updated = await accountTargetUsage(dir, "root", [
      { sessionID: "root", message: assistant("m1", { input: 140, cached: 40, output: 30 }) },
    ], { expectedTargetID: m.targetID })
    assert.equal(updated.rootTokensUsed, 170)
    assert.equal(updated.tokensUsed, 235)
  })
})

test("seeded token baseline excludes pre-Target usage but charges later delta from the same turn", async () => {
  await withState(async (dir) => {
    const started = Date.now()
    const m = await createTarget(dir, "s", "Mid-turn Target")
    // Simulate an assistant turn that began before Target creation with 100 billable tokens already spent.
    const partial = assistant("mid", { input: 90, cached: 10, output: 20, created: started - 1000 })
    await seedTargetUsageBaselines(dir, "s", [{ sessionID: "s", message: partial }], { expectedTargetID: m.targetID })

    const completed = assistant("mid", { input: 130, cached: 10, output: 30, created: started - 1000 })
    const updated = await accountTargetUsage(dir, "s", [{ sessionID: "s", message: completed }], { expectedTargetID: m.targetID })
    assert.equal(updated.tokensUsed, 50)
  })
})

test("Target creation persists its usage baseline atomically", async () => {
  await withState(async (dir) => {
    const partial = assistant("mid", { input: 90, cached: 10, output: 20, created: Date.now() - 1000 })
    const target = await createTarget(dir, "atomic", "Start with baseline", null, {
      baselineSamples: [{ sessionID: "atomic", message: partial }],
    })

    assert.equal(target.tokensUsed, 0)
    assert.equal(target.accounting.trackedMessages, 1)
    const completed = assistant("mid", { input: 130, cached: 10, output: 30, created: Date.now() - 1000 })
    const updated = await accountTargetUsage(dir, "atomic", [
      { sessionID: "atomic", message: completed },
    ], { expectedTargetID: target.targetID })
    assert.equal(updated.tokensUsed, 50)
  })
})

test("a pre-Target turn missing from activation snapshot is baselined on first observation", async () => {
  await withState(async (dir) => {
    const target = await createTarget(dir, "late", "Track only post-activation delta")
    const first = assistant("late-turn", {
      input: 100,
      created: target.createdAtMs - 100,
    })
    first.info.time.completed = target.createdAtMs + 100

    let updated = await accountTargetUsage(dir, "late", [
      { sessionID: "late", message: first },
    ], { expectedTargetID: target.targetID })
    assert.equal(updated.tokensUsed, 0)
    assert.equal(updated.usageByMessage["late:late-turn"], 100)

    const later = assistant("late-turn", {
      input: 130,
      created: target.createdAtMs - 100,
    })
    later.info.time.completed = target.createdAtMs + 200
    updated = await accountTargetUsage(dir, "late", [
      { sessionID: "late", message: later },
    ], { expectedTargetID: target.targetID })
    assert.equal(updated.tokensUsed, 30)
  })
})

test("Target preserves more than 12000 watermarks through persistence, replay and new requests", async () => {
  await withState(async (dir) => {
    const baselineSamples = Array.from({ length: 12_001 }, (_, index) => ({
      sessionID: "oversized",
      message: assistant(`old-${index}`, { input: 1, created: Date.now() - 1000 }),
    }))

    const target = await createTarget(dir, "oversized", "Keep complete baseline", null, { baselineSamples })
    assert.equal(Object.keys((await readTarget(dir, "oversized")).usageByMessage).length, 12_001)
    const samples = [...baselineSamples, ...Array.from({ length: 12_001 }, (_, i) => ({
      sessionID: i % 2 ? "child" : "oversized",
      message: assistant(`new-${i}`, { input: 2, created: target.createdAtMs + 1 }),
    }))]
    const options = { expectedTargetID: target.targetID }
    const first = await accountTargetUsage(dir, "oversized", samples, options)
    assert.equal(first.tokensUsed, 24_002)
    assert.equal(first.rootTokensUsed, 12_002)
    assert.equal(first.descendantTokensUsed, 12_000)
    assert.equal((await accountTargetUsage(dir, "oversized", samples, options)).tokensUsed, first.tokensUsed)
    assert.equal((await accountTargetUsage(dir, "oversized", [], options)).tokensUsed, first.tokensUsed)
    assert.equal((await readTarget(dir, "oversized")).accounting.trackedMessages, 24_002)
  })
})

test("extractAssistantUsage clamps cached input and excludes plan mode", () => {
  assert.equal(extractAssistantUsage(assistant("a", { input: 10, cached: 100, output: 5 })).tokens, 5)
  assert.equal(extractAssistantUsage(assistant("p", { input: 10, output: 5, mode: "plan" })).tokens, 0)
})

test("legacy semantics survive load without charging formula migration and concurrent replays", async () => {
  await withState(async dir => {
    const target = await createTarget(dir, "legacy", "Preserve legacy counters")
    const sample = { sessionID: "legacy", message: assistant("old", { input: 100, cached: 40, output: 20 }) }
    const legacy = { ...target, tokensUsed: 80, rootTokensUsed: 80, usageByMessage: { "legacy:old": 80 }, accounting: { truncated: true } }
    await writeFile(targetPath(dir, "legacy"), JSON.stringify(legacy))
    await Promise.all(Array.from({ length: 4 }, () => accountTargetUsage(dir, "legacy", [sample], { expectedTargetID: target.targetID })))
    const loaded = await readTarget(dir, "legacy")
    assert.equal(loaded.tokensUsed, 80)
    assert.equal(loaded.accounting.tokenSemantics, "legacy")
    assert.equal(loaded.accounting.truncated, true)
  })
})

test("active wall-clock accounting advances and persists its baseline", async () => {
  await withState(async (dir) => {
    const m = await createTarget(dir, "clock", "Track active time")
    await sleep(12)
    const accounted = await accountTargetUsage(dir, "clock", [], { expectedTargetID: m.targetID })
    assert.ok(accounted.accumulatedActiveMs >= 5)
    const baseline = accounted.activeStartedAtMs
    await sleep(8)
    const accountedAgain = await accountTargetUsage(dir, "clock", [], { expectedTargetID: m.targetID })
    assert.ok(accountedAgain.accumulatedActiveMs >= accounted.accumulatedActiveMs)
    assert.ok(accountedAgain.activeStartedAtMs >= baseline)
  })
})

test("budget crossing is enforced by runtime and budget_limited takes precedence", async () => {
  await withState(async (dir) => {
    const m = await createTarget(dir, "s", "Budgeted task", 100)
    let updated = await accountTargetUsage(dir, "s", [
      { sessionID: "s", message: assistant("a", { input: 80, cached: 10, output: 30 }) },
    ], { expectedTargetID: m.targetID })
    assert.equal(updated.tokensUsed, 110)
    assert.equal(updated.status, "budget_limited")

    updated = await pauseTarget(dir, "s", "try pause", m.targetID)
    assert.equal(updated.status, "budget_limited")

    updated = await resumeTarget(dir, "s", m.targetID)
    assert.equal(updated.status, "budget_limited")

    updated = await setTargetBudget(dir, "s", 200, { expectedTargetID: m.targetID })
    assert.equal(updated.status, "budget_limited", "budget edit does not itself resume")

    updated = await resumeTarget(dir, "s", m.targetID)
    assert.equal(updated.status, "active")
  })
})

test("usage_limited may supersede budget_limited, while paused/blocked may not", async () => {
  await withState(async (dir) => {
    const m = await createTarget(dir, "u", "Usage priority", 10)
    let state = await accountTargetUsage(dir, "u", [
      { sessionID: "u", message: assistant("u1", { input: 10, output: 1 }) },
    ], { expectedTargetID: m.targetID })
    assert.equal(state.status, "budget_limited")
    state = await setStoppedStatus(dir, "u", "blocked", "runtime", m.targetID)
    assert.equal(state.status, "budget_limited")
    state = await setStoppedStatus(dir, "u", "usage_limited", "provider quota", m.targetID)
    assert.equal(state.status, "usage_limited")
  })
})

test("stale expected target ID cannot mutate a replacement Target", async () => {
  await withState(async (dir) => {
    const old = await createTarget(dir, "s", "Old")
    await setStoppedStatus(dir, "s", "complete", "done", old.targetID)
    const current = await createTarget(dir, "s", "New")

    const stale = await accountTargetUsage(dir, "s", [
      { sessionID: "s", message: assistant("late", { input: 100, output: 50 }) },
    ], { expectedTargetID: old.targetID })
    assert.equal(stale, null)

    const persisted = await readTarget(dir, "s")
    assert.equal(persisted.targetID, current.targetID)
    assert.equal(persisted.tokensUsed, 0)
  })
})

test("failed-exec circuit breaker blocks after three qualifying Target turns and success resets it", async () => {
  await withState(async (dir) => {
    const m = await createTarget(dir, "s", "Fix failures")
    let state = await recordTargetTurnOutcome(dir, "s", failedExec("a1"), { expectedTargetID: m.targetID })
    assert.equal(state.runtime.failedExecStreak, 1)
    state = await recordTargetTurnOutcome(dir, "s", failedExec("a2"), { expectedTargetID: m.targetID })
    assert.equal(state.runtime.failedExecStreak, 2)
    state = await recordTargetTurnOutcome(dir, "s", successfulTool("ok"), { expectedTargetID: m.targetID })
    assert.equal(state.runtime.failedExecStreak, 0)
    state = await recordTargetTurnOutcome(dir, "s", failedExec("a3"), { expectedTargetID: m.targetID })
    state = await recordTargetTurnOutcome(dir, "s", failedExec("a4"), { expectedTargetID: m.targetID })
    state = await recordTargetTurnOutcome(dir, "s", failedExec("a5"), { expectedTargetID: m.targetID })
    assert.equal(state.status, "blocked")
    assert.match(state.stopReason, /3 consecutive Target turns/)
  })
})

test("turn-outcome accounting is idempotent for the same assistant message", async () => {
  await withState(async (dir) => {
    const m = await createTarget(dir, "s", "No double count")
    const msg = failedExec("dup")
    let state = await recordTargetTurnOutcome(dir, "s", msg, { expectedTargetID: m.targetID })
    assert.equal(state.runtime.failedExecStreak, 1)
    state = await recordTargetTurnOutcome(dir, "s", msg, { expectedTargetID: m.targetID })
    assert.equal(state.runtime.failedExecStreak, 1)
  })
})

test("empty automatic continuation circuit breaker ignores ordinary turns and blocks after three empty auto turns", async () => {
  await withState(async (dir) => {
    const m = await createTarget(dir, "s", "Keep going")
    let state = await recordTargetTurnOutcome(dir, "s", assistant("ordinary", { parts: [] }), {
      expectedTargetID: m.targetID,
      automatic: false,
    })
    assert.equal(state.runtime.emptyAutomaticStreak, 0)

    for (let i = 1; i <= 3; i++) {
      state = await recordTargetTurnOutcome(dir, "s", assistant(`auto-${i}`, { parts: [] }), {
        expectedTargetID: m.targetID,
        automatic: true,
      })
    }
    assert.equal(state.status, "blocked")
    assert.equal(state.runtime.emptyAutomaticStreak, 3)
  })
})

test("resume resets circuit-breaker audit", async () => {
  await withState(async (dir) => {
    const m = await createTarget(dir, "s", "Retry")
    await recordTargetTurnOutcome(dir, "s", failedExec("a1"), { expectedTargetID: m.targetID })
    await setStoppedStatus(dir, "s", "blocked", "blocked", m.targetID)
    const resumed = await resumeTarget(dir, "s", m.targetID)
    assert.equal(resumed.status, "active")
    assert.equal(resumed.runtime.failedExecStreak, 0)
    assert.equal(resumed.runtime.emptyAutomaticStreak, 0)
  })
})

test("proven completion can supersede budget_limited", async () => {
  await withState(async (dir) => {
    const m = await createTarget(dir, "s", "Finish exactly", 10)
    const limited = await accountTargetUsage(dir, "s", [
      { sessionID: "s", message: assistant("budget-cross", { input: 20 }) },
    ], { expectedTargetID: m.targetID })
    assert.equal(limited.status, "budget_limited")

    const completed = await setStoppedStatus(dir, "s", "complete", "Verified against every requirement", m.targetID)
    assert.equal(completed.status, "complete")
  })
})

test("continuation deferral is deterministic and target-id guarded", async () => {
  await withState(async (dir) => {
    const m = await createTarget(dir, "s", "Control plane")
    await deferNextContinuation(dir, "s", 2, m.targetID)
    assert.equal(await consumeContinuationDeferral(dir, "s", m.targetID), true)
    assert.equal(await consumeContinuationDeferral(dir, "s", m.targetID), true)
    assert.equal(await consumeContinuationDeferral(dir, "s", m.targetID), false)
    assert.equal(await consumeContinuationDeferral(dir, "s", "stale-id"), false)
  })
})

test("command parser supports /target, alias payloads, budget and controls", () => {
  assert.deepEqual(parseTargetCommand(""), { op: "view" })
  assert.deepEqual(parseTargetCommand("Ship it"), { op: "set", objective: "Ship it", tokenBudget: null })
  assert.deepEqual(parseTargetCommand("--budget 12000 Ship it"), { op: "set", objective: "Ship it", tokenBudget: 12000 })
  assert.deepEqual(parseTargetCommand("pause waiting for user"), { op: "pause", reason: "waiting for user" })
  assert.deepEqual(parseTargetCommand("doctor"), { op: "doctor" })
  assert.deepEqual(parseTargetCommand("verify unit"), { op: "verify", verificationID: "unit" })
  assert.deepEqual(parseTargetCommand("history"), { op: "history" })
  assert.deepEqual(parseTargetCommand("explain"), { op: "explain" })
  assert.deepEqual(parseTargetCommand("report"), { op: "report" })
  assert.deepEqual(parseTargetCommand("checkpoint before tests"), { op: "checkpoint", summary: "before tests" })
  assert.deepEqual(parseTargetCommand("budget off"), { op: "budget", tokenBudget: null })
  assert.deepEqual(parseTargetCommand("edit New objective"), { op: "edit", objective: "New objective" })
})

test("snapshot exposes remaining budget and root/descendant split", async () => {
  await withState(async (dir) => {
    const m = await createTarget(dir, "s", "Snapshot", 1000)
    const updated = await accountTargetUsage(dir, "s", [
      { sessionID: "s", message: assistant("r", { input: 100, cached: 20, output: 10 }) },
      { sessionID: "c", message: assistant("c", { input: 50, output: 10 }) },
    ], { expectedTargetID: m.targetID })
    const view = snapshotTarget(updated)
    assert.equal(view.target.rootTokensUsed, 110)
    assert.equal(view.target.descendantTokensUsed, 60)
    assert.equal(view.remainingTokens, 830)
  })
})

test("corrupt persisted state is quarantined instead of being treated as absent", async () => {
  await withState(async (dir) => {
    const file = targetPath(dir, "s")
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, "{not-json", "utf8")
    await assert.rejects(() => readTarget(dir, "s"), /corrupt|invalid/i)
    const quarantined = await readdir(path.join(dir, "corrupt"))
    assert.equal(quarantined.length, 1)
    assert.match(quarantined[0], /cw\.json\./)
  })
})

test("schema-invalid persisted state is quarantined", async () => {
  await withState(async (dir) => {
    const file = targetPath(dir, "s")
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({ sessionID: "s", objective: "" }), "utf8")
    await assert.rejects(() => readTarget(dir, "s"), { code: "TARGET_STATE_CORRUPT" })
    assert.equal((await readdir(path.join(dir, "corrupt"))).length, 1)
  })
})

test("scheduler lease has exclusive ownership and may be recovered after expiry", async () => {
  await withState(async (dir) => {
    const target = await createTarget(dir, "s", "Lease guarded continuation")
    const first = await acquireSchedulerLease(dir, "s", "owner-a", {
      expectedTargetID: target.targetID,
      leaseMs: 1000,
      at: 10_000,
    })
    assert.equal(first.acquired, true)
    assert.equal(first.target.schedulerLease.owner, "owner-a")

    const denied = await acquireSchedulerLease(dir, "s", "owner-b", {
      expectedTargetID: target.targetID,
      leaseMs: 1000,
      at: 10_500,
    })
    assert.equal(denied.acquired, false)
    assert.equal(denied.leaseExpiresAtMs, 11_000)

    assert.equal(await renewSchedulerLease(dir, "s", "owner-b", {
      expectedTargetID: target.targetID,
      leaseMs: 1000,
      at: 10_600,
    }), null)
    const renewed = await renewSchedulerLease(dir, "s", "owner-a", {
      expectedTargetID: target.targetID,
      leaseMs: 1000,
      at: 10_600,
    })
    assert.equal(renewed.schedulerLease.expiresAtMs, 11_600)

    const recovered = await acquireSchedulerLease(dir, "s", "owner-b", {
      expectedTargetID: target.targetID,
      leaseMs: 1000,
      at: 11_601,
    })
    assert.equal(recovered.acquired, true)
    assert.equal(recovered.target.schedulerLease.owner, "owner-b")
    assert.equal(await releaseSchedulerLease(dir, "s", "owner-a", target.targetID), null)
    const released = await releaseSchedulerLease(dir, "s", "owner-b", target.targetID)
    assert.equal(released.schedulerLease, null)
  })
})

test("an expired scheduler lease cannot be revived by renewal", async () => {
  await withState(async (dir) => {
    const target = await createTarget(dir, "expired-renewal", "Fence expired owner")
    const acquired = await acquireSchedulerLease(dir, "expired-renewal", "owner-a", {
      expectedTargetID: target.targetID,
      leaseMs: 1_000,
      at: 10_000,
    })
    assert.equal(acquired.acquired, true)
    assert.equal(await renewSchedulerLease(dir, "expired-renewal", "owner-a", {
      expectedTargetID: target.targetID,
      leaseMs: 1_000,
      at: 11_001,
    }), null)
    assert.equal((await acquireSchedulerLease(dir, "expired-renewal", "owner-b", {
      expectedTargetID: target.targetID,
      leaseMs: 1_000,
      at: 11_001,
    })).acquired, true)
  })
})

test("scheduler lease cannot mutate a replacement or stopped Target", async () => {
  await withState(async (dir) => {
    const old = await createTarget(dir, "s", "Old")
    await setStoppedStatus(dir, "s", "complete", "done", old.targetID)
    const replacement = await createTarget(dir, "s", "Replacement")
    assert.equal(await acquireSchedulerLease(dir, "s", "old-owner", {
      expectedTargetID: old.targetID,
    }), null)
    await setStoppedStatus(dir, "s", "paused", "user pause", replacement.targetID)
    assert.equal(await acquireSchedulerLease(dir, "s", "new-owner", {
      expectedTargetID: replacement.targetID,
    }), null)
  })
})

test("scheduler lease permits one idempotent budget wrap-up", async () => {
  await withState(async (dir) => {
    const target = await createTarget(dir, "s", "Budget", 10)
    await accountTargetUsage(dir, "s", [
      { sessionID: "s", message: assistant("over", { input: 10, output: 1 }) },
    ], { expectedTargetID: target.targetID })
    const lease = await acquireSchedulerLease(dir, "s", "wrap-owner", {
      expectedTargetID: target.targetID,
    })
    assert.equal(lease.acquired, true)
    assert.ok(await markBudgetWrapupSent(dir, "s", target.targetID))
    assert.equal(await markBudgetWrapupSent(dir, "s", target.targetID), null)
    assert.equal(await acquireSchedulerLease(dir, "s", "other-owner", {
      expectedTargetID: target.targetID,
    }), null)
  })
})

test("runtime limits stop a Target by automatic turns and no-progress turns", async () => {
  await withState(async (dir) => {
    const target = await createTarget(dir, "s", "Limited", null, {
      maxAutomaticTurns: 2,
      maxNoProgressTurns: 2,
    })
    const first = await markContinuationStarted(dir, "s", target.targetID)
    await recordTargetTurnOutcome(dir, "s", assistant("a", { parts: [] }), {
      expectedTargetID: target.targetID,
      automatic: true,
    })
    const second = await markContinuationStarted(dir, "s", target.targetID)
    await recordTargetTurnOutcome(dir, "s", assistant("b", { parts: [] }), {
      expectedTargetID: target.targetID,
      automatic: true,
    })
    const final = await readTarget(dir, "s")
    assert.equal(first.continuationCount, 1)
    assert.equal(second.continuationCount, 2)
    assert.equal(final.status, "usage_limited")
    assert.match(final.stopReason, /automatic turn limit|no-progress/i)
  })
})

test("active time limit is enforced when accounting a Target", async () => {
  await withState(async (dir) => {
    const target = await createTarget(dir, "s", "Timed", null, { maxActiveSeconds: 1 })
    const state = await readTarget(dir, "s")
    state.accumulatedActiveMs = 2_000
    await writeTarget(dir, state)
    const updated = await accountTargetUsage(dir, "s", [], { expectedTargetID: target.targetID })
    assert.equal(updated.status, "usage_limited")
    assert.match(updated.stopReason, /active time limit/i)
  })
})

test("completion requires evidence for every declared requirement", async () => {
  await withState(async (dir) => {
    const target = await createTarget(dir, "s", "Verified", null, {
      requirements: [
        { id: "tests", text: "Tests pass" },
        { id: "docs", text: "Documentation is updated" },
      ],
    })
    await assert.rejects(
      () => setStoppedStatus(dir, "s", "complete", "done", target.targetID),
      /requirements|evidence/i,
    )
    const withTests = await addTargetEvidence(dir, "s", "tests", {
      kind: "command",
      summary: "npm test: 10 passed",
    }, target.targetID)
    assert.equal(withTests.requirements[0].status, "verified")
    await assert.rejects(
      () => setStoppedStatus(dir, "s", "complete", "done", target.targetID),
      /requirements|evidence/i,
    )
    await addTargetEvidence(dir, "s", "docs", {
      kind: "inspection",
      summary: "README reviewed",
    }, target.targetID)
    const complete = await setStoppedStatus(dir, "s", "complete", "done", target.targetID)
    assert.equal(complete.status, "complete")
    assert.equal(complete.requirements.every((requirement) => requirement.status === "verified"), true)
  })
})

test("configured verification gates are persisted and record pass/fail evidence", async () => {
  await withState(async (dir) => {
    const target = await createTarget(dir, "s", "Verify", null, {
      requirements: [{ id: "tests", text: "Tests pass" }],
      verification: [{ id: "unit", command: "npm test", requirementID: "tests" }],
    })
    assert.deepEqual(target.verification, [{
      id: "unit",
      command: "npm test",
      requirementID: "tests",
      retry: { maxAttempts: 1, baseDelayMs: 250, maxDelayMs: 5000 },
    }])
    const failed = await recordVerificationResult(dir, "s", "unit", {
      passed: false,
      summary: "npm test: 1 failed",
      attempts: 2,
      errorKind: "exit_code",
    }, target.targetID)
    assert.equal(failed.requirements[0].status, "open")
    assert.equal((await getTargetHistory(dir, "s")).at(-1).details.attempts, 2)
    assert.equal((await getTargetHistory(dir, "s")).at(-1).details.errorKind, "exit_code")
    assert.equal(failed.requirements[0].evidence.at(-1).errorKind, "exit_code")
    const passed = await recordVerificationResult(dir, "s", "unit", {
      passed: true,
      summary: "npm test: all passed",
    }, target.targetID)
    assert.equal(passed.requirements[0].status, "verified")
  })
})

test("verification evidence becomes stale after the worktree fingerprint changes", async () => {
  await withState(async (dir) => {
    const target = await createTarget(dir, "s", "Fresh evidence", null, {
      requirements: [{ id: "tests", text: "Tests pass" }],
    })
    await addTargetEvidence(dir, "s", "tests", {
      kind: "command",
      summary: "passed",
      fingerprint: "tree-a",
    }, target.targetID)
    let current = await readTarget(dir, "s")
    assert.equal(current.requirements[0].status, "verified")
    current = await refreshTargetEvidence(dir, "s", "tree-b", target.targetID)
    assert.equal(current.requirements[0].status, "open")
    assert.equal(current.requirements[0].evidence.at(-1).stale, true)
  })
})

test("Target journal and report explain lifecycle and missing requirements", async () => {
  await withState(async (dir) => {
    const target = await createTarget(dir, "s", "Report", null, {
      requirements: [{ id: "tests", text: "Tests pass" }],
    })
    const history = await getTargetHistory(dir, "s")
    assert.ok(history.some((event) => event.type === "created"))
    const report = await targetReport(dir, "s")
    assert.equal(report.status, "active")
    assert.deepEqual(report.missingRequirements, ["tests"])
    assert.ok(report.historyLength >= 1)
    assert.deepEqual(report.verificationSummary, { total: 0, passed: 0, failed: 0, attempts: 0 })
    assert.deepEqual(report.unresolvedRisks, ["Missing evidence: tests"])
    assert.equal(report.accounting.truncated, false)
  })
})

test("manual checkpoints persist bounded metadata without changing lifecycle", async () => {
  await withState(async (dir) => {
    const target = await createTarget(dir, "s", "Checkpoint")
    const checkpoint = await addTargetCheckpoint(dir, "s", {
      fingerprint: "tree-a",
      commit: "abc123",
      summary: "Before refactor",
    }, target.targetID)
    assert.equal(checkpoint.status, "active")
    assert.equal(checkpoint.checkpoints[0].fingerprint, "tree-a")
    assert.equal((await listTargetCheckpoints(dir, "s")).length, 1)
  })
})

test("retry policy normalizes bounds and classifies only transient failures", () => {
  assert.deepEqual(normalizeRetryPolicy({ maxAttempts: 4, baseDelayMs: 10, maxDelayMs: 100 }), {
    maxAttempts: 4,
    baseDelayMs: 10,
    maxDelayMs: 100,
  })
  assert.equal(normalizeRetryPolicy({ maxAttempts: 0 }).maxAttempts, 1)
  assert.equal(isRetryableVerificationFailure({ code: "ETIMEDOUT" }), true)
  assert.equal(isRetryableVerificationFailure({ code: "ENOENT" }), false)
  assert.equal(isRetryableVerificationFailure(new Error("connection reset by peer")), true)
})

test("async continuation outcomes retain automatic classification after reload", async () => {
  await withState(async (dir) => {
    const target = await createTarget(dir, "async", "finish")
    await markContinuationStarted(dir, "async", target.targetID)
    const pending = await readTarget(dir, "async")
    assert.ok(pending.runtime.pendingAutomaticAtMs)
    const message = assistant("automatic-empty", { created: pending.runtime.pendingAutomaticAtMs + 1 })
    const next = await recordTargetTurnOutcome(dir, "async", message, { expectedTargetID: target.targetID })
    assert.equal(next.runtime.emptyAutomaticStreak, 1)
    assert.equal(next.runtime.lastTurnClassification.automatic, true)
    assert.equal(next.runtime.pendingAutomaticAtMs, null)
  })
})

test("completion watermark prevents replay beyond 500 assistant IDs", async () => {
  await withState(async (dir) => {
    const target = await createTarget(dir, "long", "finish")
    const messages = Array.from({ length: 520 }, (_, i) => assistant(`m-${i}`, { created: target.createdAtMs + i + 1, parts: [{ type: "text", text: "progress" }] }))
    const next = await recordTargetTurnOutcomes(dir, "long", messages, { expectedTargetID: target.targetID })
    assert.equal(next.runtime.evaluatedAssistantMessageIDs.length, 500)
    assert.equal(next.runtime.lastTurnClassification.assistantMessageID, "m-519")
    const replay = await recordTargetTurnOutcome(dir, "long", messages[0], { expectedTargetID: target.targetID })
    assert.equal(replay.runtime.lastTurnClassification.assistantMessageID, "m-519")
  })
})
