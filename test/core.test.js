import assert from "node:assert/strict"
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  acquireSchedulerLease,
  accountMissionUsage,
  addMissionEvidence,
  getMissionHistory,
  missionReport,
  addMissionCheckpoint,
  listMissionCheckpoints,
  recordVerificationResult,
  cleanupStateDir,
  consumeContinuationDeferral,
  createMission,
  deferNextContinuation,
  editMission,
  extractAssistantUsage,
  missionPath,
  markBudgetWrapupSent,
  markContinuationStarted,
  parseMissionCommand,
  pauseMission,
  readMission,
  recordMissionTurnOutcome,
  releaseSchedulerLease,
  renewSchedulerLease,
  resumeMission,
  refreshMissionEvidence,
  normalizeRetryPolicy,
  isRetryableVerificationFailure,
  seedMissionUsageBaselines,
  setMissionBudget,
  setStoppedStatus,
  snapshotMission,
  sleep,
  writeMission,
} from "../src/core.js"

async function withState(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-mission-test-"))
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

test("Mission lifecycle: create, pause, resume, complete, then replace with a fresh mission", async () => {
  await withState(async (dir) => {
    const a = await createMission(dir, "s1", "Ship verified auth flow", 10_000)
    assert.equal(a.status, "active")
    assert.ok(a.missionID)

    await assert.rejects(() => createMission(dir, "s1", "Cannot replace unfinished"), /unfinished Mission/)

    const paused = await pauseMission(dir, "s1", "user pause", a.missionID)
    assert.equal(paused.status, "paused")

    const resumed = await resumeMission(dir, "s1", a.missionID)
    assert.equal(resumed.status, "active")

    const complete = await setStoppedStatus(dir, "s1", "complete", "verified", a.missionID)
    assert.equal(complete.status, "complete")

    const b = await createMission(dir, "s1", "Second mission", 5_000)
    assert.equal(b.status, "active")
    assert.notEqual(b.missionID, a.missionID)
    assert.equal(b.tokensUsed, 0)
    assert.equal(b.continuationCount, 0)
  })
})

test("token accounting uses non-cached input + output, excludes plan mode, splits descendant usage, and is idempotent", async () => {
  await withState(async (dir) => {
    const m = await createMission(dir, "root", "Do work")
    const samples = [
      { sessionID: "root", message: assistant("m1", { input: 100, cached: 40, output: 20 }) },
      { sessionID: "root", message: assistant("m2", { input: 999, output: 999, mode: "plan" }) },
      { sessionID: "child", message: assistant("c1", { input: 50, cached: 10, output: 15 }) },
    ]
    let updated = await accountMissionUsage(dir, "root", samples, { expectedMissionID: m.missionID })
    assert.equal(updated.rootTokensUsed, 80)
    assert.equal(updated.descendantTokensUsed, 55)
    assert.equal(updated.tokensUsed, 135)

    updated = await accountMissionUsage(dir, "root", samples, { expectedMissionID: m.missionID })
    assert.equal(updated.tokensUsed, 135)

    // Same assistant message can grow while streaming; only the positive delta is added.
    updated = await accountMissionUsage(dir, "root", [
      { sessionID: "root", message: assistant("m1", { input: 140, cached: 40, output: 30 }) },
    ], { expectedMissionID: m.missionID })
    assert.equal(updated.rootTokensUsed, 130)
    assert.equal(updated.tokensUsed, 185)
  })
})

test("seeded token baseline excludes pre-Mission usage but charges later delta from the same turn", async () => {
  await withState(async (dir) => {
    const started = Date.now()
    const m = await createMission(dir, "s", "Mid-turn Mission")
    // Simulate an assistant turn that began before Mission creation with 100 billable tokens already spent.
    const partial = assistant("mid", { input: 90, cached: 10, output: 20, created: started - 1000 })
    await seedMissionUsageBaselines(dir, "s", [{ sessionID: "s", message: partial }], { expectedMissionID: m.missionID })

    const completed = assistant("mid", { input: 130, cached: 10, output: 30, created: started - 1000 })
    const updated = await accountMissionUsage(dir, "s", [{ sessionID: "s", message: completed }], { expectedMissionID: m.missionID })
    assert.equal(updated.tokensUsed, 50)
  })
})

test("extractAssistantUsage clamps cached input and excludes plan mode", () => {
  assert.equal(extractAssistantUsage(assistant("a", { input: 10, cached: 100, output: 5 })).tokens, 5)
  assert.equal(extractAssistantUsage(assistant("p", { input: 10, output: 5, mode: "plan" })).tokens, 0)
})

test("active wall-clock accounting advances and persists its baseline", async () => {
  await withState(async (dir) => {
    const m = await createMission(dir, "clock", "Track active time")
    await sleep(12)
    const accounted = await accountMissionUsage(dir, "clock", [], { expectedMissionID: m.missionID })
    assert.ok(accounted.accumulatedActiveMs >= 5)
    const baseline = accounted.activeStartedAtMs
    await sleep(8)
    const accountedAgain = await accountMissionUsage(dir, "clock", [], { expectedMissionID: m.missionID })
    assert.ok(accountedAgain.accumulatedActiveMs >= accounted.accumulatedActiveMs)
    assert.ok(accountedAgain.activeStartedAtMs >= baseline)
  })
})

test("budget crossing is enforced by runtime and budget_limited takes precedence", async () => {
  await withState(async (dir) => {
    const m = await createMission(dir, "s", "Budgeted task", 100)
    let updated = await accountMissionUsage(dir, "s", [
      { sessionID: "s", message: assistant("a", { input: 80, cached: 10, output: 30 }) },
    ], { expectedMissionID: m.missionID })
    assert.equal(updated.tokensUsed, 100)
    assert.equal(updated.status, "budget_limited")

    updated = await pauseMission(dir, "s", "try pause", m.missionID)
    assert.equal(updated.status, "budget_limited")

    updated = await resumeMission(dir, "s", m.missionID)
    assert.equal(updated.status, "budget_limited")

    updated = await setMissionBudget(dir, "s", 200, { expectedMissionID: m.missionID })
    assert.equal(updated.status, "budget_limited", "budget edit does not itself resume")

    updated = await resumeMission(dir, "s", m.missionID)
    assert.equal(updated.status, "active")
  })
})

test("usage_limited may supersede budget_limited, while paused/blocked may not", async () => {
  await withState(async (dir) => {
    const m = await createMission(dir, "u", "Usage priority", 10)
    let state = await accountMissionUsage(dir, "u", [
      { sessionID: "u", message: assistant("u1", { input: 10, output: 1 }) },
    ], { expectedMissionID: m.missionID })
    assert.equal(state.status, "budget_limited")
    state = await setStoppedStatus(dir, "u", "blocked", "runtime", m.missionID)
    assert.equal(state.status, "budget_limited")
    state = await setStoppedStatus(dir, "u", "usage_limited", "provider quota", m.missionID)
    assert.equal(state.status, "usage_limited")
  })
})

test("stale expected mission ID cannot mutate a replacement Mission", async () => {
  await withState(async (dir) => {
    const old = await createMission(dir, "s", "Old")
    await setStoppedStatus(dir, "s", "complete", "done", old.missionID)
    const current = await createMission(dir, "s", "New")

    const stale = await accountMissionUsage(dir, "s", [
      { sessionID: "s", message: assistant("late", { input: 100, output: 50 }) },
    ], { expectedMissionID: old.missionID })
    assert.equal(stale, null)

    const persisted = await readMission(dir, "s")
    assert.equal(persisted.missionID, current.missionID)
    assert.equal(persisted.tokensUsed, 0)
  })
})

test("failed-exec circuit breaker blocks after three qualifying Mission turns and success resets it", async () => {
  await withState(async (dir) => {
    const m = await createMission(dir, "s", "Fix failures")
    let state = await recordMissionTurnOutcome(dir, "s", failedExec("a1"), { expectedMissionID: m.missionID })
    assert.equal(state.runtime.failedExecStreak, 1)
    state = await recordMissionTurnOutcome(dir, "s", failedExec("a2"), { expectedMissionID: m.missionID })
    assert.equal(state.runtime.failedExecStreak, 2)
    state = await recordMissionTurnOutcome(dir, "s", successfulTool("ok"), { expectedMissionID: m.missionID })
    assert.equal(state.runtime.failedExecStreak, 0)
    state = await recordMissionTurnOutcome(dir, "s", failedExec("a3"), { expectedMissionID: m.missionID })
    state = await recordMissionTurnOutcome(dir, "s", failedExec("a4"), { expectedMissionID: m.missionID })
    state = await recordMissionTurnOutcome(dir, "s", failedExec("a5"), { expectedMissionID: m.missionID })
    assert.equal(state.status, "blocked")
    assert.match(state.stopReason, /3 consecutive Mission turns/)
  })
})

test("turn-outcome accounting is idempotent for the same assistant message", async () => {
  await withState(async (dir) => {
    const m = await createMission(dir, "s", "No double count")
    const msg = failedExec("dup")
    let state = await recordMissionTurnOutcome(dir, "s", msg, { expectedMissionID: m.missionID })
    assert.equal(state.runtime.failedExecStreak, 1)
    state = await recordMissionTurnOutcome(dir, "s", msg, { expectedMissionID: m.missionID })
    assert.equal(state.runtime.failedExecStreak, 1)
  })
})

test("empty automatic continuation circuit breaker ignores ordinary turns and blocks after three empty auto turns", async () => {
  await withState(async (dir) => {
    const m = await createMission(dir, "s", "Keep going")
    let state = await recordMissionTurnOutcome(dir, "s", assistant("ordinary", { parts: [] }), {
      expectedMissionID: m.missionID,
      automatic: false,
    })
    assert.equal(state.runtime.emptyAutomaticStreak, 0)

    for (let i = 1; i <= 3; i++) {
      state = await recordMissionTurnOutcome(dir, "s", assistant(`auto-${i}`, { parts: [] }), {
        expectedMissionID: m.missionID,
        automatic: true,
      })
    }
    assert.equal(state.status, "blocked")
    assert.equal(state.runtime.emptyAutomaticStreak, 3)
  })
})

test("resume resets circuit-breaker audit", async () => {
  await withState(async (dir) => {
    const m = await createMission(dir, "s", "Retry")
    await recordMissionTurnOutcome(dir, "s", failedExec("a1"), { expectedMissionID: m.missionID })
    await setStoppedStatus(dir, "s", "blocked", "blocked", m.missionID)
    const resumed = await resumeMission(dir, "s", m.missionID)
    assert.equal(resumed.status, "active")
    assert.equal(resumed.runtime.failedExecStreak, 0)
    assert.equal(resumed.runtime.emptyAutomaticStreak, 0)
  })
})

test("proven completion can supersede budget_limited", async () => {
  await withState(async (dir) => {
    const m = await createMission(dir, "s", "Finish exactly", 10)
    const limited = await accountMissionUsage(dir, "s", [
      { sessionID: "s", message: assistant("budget-cross", { input: 20 }) },
    ], { expectedMissionID: m.missionID })
    assert.equal(limited.status, "budget_limited")

    const completed = await setStoppedStatus(dir, "s", "complete", "Verified against every requirement", m.missionID)
    assert.equal(completed.status, "complete")
  })
})

test("continuation deferral is deterministic and mission-id guarded", async () => {
  await withState(async (dir) => {
    const m = await createMission(dir, "s", "Control plane")
    await deferNextContinuation(dir, "s", 2, m.missionID)
    assert.equal(await consumeContinuationDeferral(dir, "s", m.missionID), true)
    assert.equal(await consumeContinuationDeferral(dir, "s", m.missionID), true)
    assert.equal(await consumeContinuationDeferral(dir, "s", m.missionID), false)
    assert.equal(await consumeContinuationDeferral(dir, "s", "stale-id"), false)
  })
})

test("command parser supports /mission, alias payloads, budget and controls", () => {
  assert.deepEqual(parseMissionCommand(""), { op: "view" })
  assert.deepEqual(parseMissionCommand("Ship it"), { op: "set", objective: "Ship it", tokenBudget: null })
  assert.deepEqual(parseMissionCommand("--budget 12000 Ship it"), { op: "set", objective: "Ship it", tokenBudget: 12000 })
  assert.deepEqual(parseMissionCommand("pause waiting for user"), { op: "pause", reason: "waiting for user" })
  assert.deepEqual(parseMissionCommand("doctor"), { op: "doctor" })
  assert.deepEqual(parseMissionCommand("verify unit"), { op: "verify", verificationID: "unit" })
  assert.deepEqual(parseMissionCommand("history"), { op: "history" })
  assert.deepEqual(parseMissionCommand("explain"), { op: "explain" })
  assert.deepEqual(parseMissionCommand("report"), { op: "report" })
  assert.deepEqual(parseMissionCommand("checkpoint before tests"), { op: "checkpoint", summary: "before tests" })
  assert.deepEqual(parseMissionCommand("budget off"), { op: "budget", tokenBudget: null })
  assert.deepEqual(parseMissionCommand("edit New objective"), { op: "edit", objective: "New objective" })
})

test("snapshot exposes remaining budget and root/descendant split", async () => {
  await withState(async (dir) => {
    const m = await createMission(dir, "s", "Snapshot", 1000)
    const updated = await accountMissionUsage(dir, "s", [
      { sessionID: "s", message: assistant("r", { input: 100, cached: 20, output: 10 }) },
      { sessionID: "c", message: assistant("c", { input: 50, output: 10 }) },
    ], { expectedMissionID: m.missionID })
    const view = snapshotMission(updated)
    assert.equal(view.mission.rootTokensUsed, 90)
    assert.equal(view.mission.descendantTokensUsed, 60)
    assert.equal(view.remainingTokens, 850)
  })
})

test("corrupt persisted state is quarantined instead of being treated as absent", async () => {
  await withState(async (dir) => {
    const file = missionPath(dir, "s")
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, "{not-json", "utf8")
    await assert.rejects(() => readMission(dir, "s"), /corrupt|invalid/i)
    const quarantined = await readdir(path.join(dir, "corrupt"))
    assert.equal(quarantined.length, 1)
    assert.match(quarantined[0], /cw\.json\./)
  })
})

test("schema-invalid persisted state is quarantined", async () => {
  await withState(async (dir) => {
    const file = missionPath(dir, "s")
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({ sessionID: "s", objective: "" }), "utf8")
    await assert.rejects(() => readMission(dir, "s"), { code: "MISSION_STATE_CORRUPT" })
    assert.equal((await readdir(path.join(dir, "corrupt"))).length, 1)
  })
})

test("scheduler lease has exclusive ownership and may be recovered after expiry", async () => {
  await withState(async (dir) => {
    const mission = await createMission(dir, "s", "Lease guarded continuation")
    const first = await acquireSchedulerLease(dir, "s", "owner-a", {
      expectedMissionID: mission.missionID,
      leaseMs: 1000,
      at: 10_000,
    })
    assert.equal(first.acquired, true)
    assert.equal(first.mission.schedulerLease.owner, "owner-a")

    const denied = await acquireSchedulerLease(dir, "s", "owner-b", {
      expectedMissionID: mission.missionID,
      leaseMs: 1000,
      at: 10_500,
    })
    assert.equal(denied.acquired, false)
    assert.equal(denied.leaseExpiresAtMs, 11_000)

    assert.equal(await renewSchedulerLease(dir, "s", "owner-b", {
      expectedMissionID: mission.missionID,
      leaseMs: 1000,
      at: 10_600,
    }), null)
    const renewed = await renewSchedulerLease(dir, "s", "owner-a", {
      expectedMissionID: mission.missionID,
      leaseMs: 1000,
      at: 10_600,
    })
    assert.equal(renewed.schedulerLease.expiresAtMs, 11_600)

    const recovered = await acquireSchedulerLease(dir, "s", "owner-b", {
      expectedMissionID: mission.missionID,
      leaseMs: 1000,
      at: 11_601,
    })
    assert.equal(recovered.acquired, true)
    assert.equal(recovered.mission.schedulerLease.owner, "owner-b")
    assert.equal(await releaseSchedulerLease(dir, "s", "owner-a", mission.missionID), null)
    const released = await releaseSchedulerLease(dir, "s", "owner-b", mission.missionID)
    assert.equal(released.schedulerLease, null)
  })
})

test("scheduler lease cannot mutate a replacement or stopped Mission", async () => {
  await withState(async (dir) => {
    const old = await createMission(dir, "s", "Old")
    await setStoppedStatus(dir, "s", "complete", "done", old.missionID)
    const replacement = await createMission(dir, "s", "Replacement")
    assert.equal(await acquireSchedulerLease(dir, "s", "old-owner", {
      expectedMissionID: old.missionID,
    }), null)
    await setStoppedStatus(dir, "s", "paused", "user pause", replacement.missionID)
    assert.equal(await acquireSchedulerLease(dir, "s", "new-owner", {
      expectedMissionID: replacement.missionID,
    }), null)
  })
})

test("scheduler lease permits one idempotent budget wrap-up", async () => {
  await withState(async (dir) => {
    const mission = await createMission(dir, "s", "Budget", 10)
    await accountMissionUsage(dir, "s", [
      { sessionID: "s", message: assistant("over", { input: 10, output: 1 }) },
    ], { expectedMissionID: mission.missionID })
    const lease = await acquireSchedulerLease(dir, "s", "wrap-owner", {
      expectedMissionID: mission.missionID,
    })
    assert.equal(lease.acquired, true)
    assert.ok(await markBudgetWrapupSent(dir, "s", mission.missionID))
    assert.equal(await markBudgetWrapupSent(dir, "s", mission.missionID), null)
    assert.equal(await acquireSchedulerLease(dir, "s", "other-owner", {
      expectedMissionID: mission.missionID,
    }), null)
  })
})

test("runtime limits stop a Mission by automatic turns and no-progress turns", async () => {
  await withState(async (dir) => {
    const mission = await createMission(dir, "s", "Limited", null, {
      maxAutomaticTurns: 2,
      maxNoProgressTurns: 2,
    })
    const first = await markContinuationStarted(dir, "s", mission.missionID)
    await recordMissionTurnOutcome(dir, "s", assistant("a", { parts: [] }), {
      expectedMissionID: mission.missionID,
      automatic: true,
    })
    const second = await markContinuationStarted(dir, "s", mission.missionID)
    await recordMissionTurnOutcome(dir, "s", assistant("b", { parts: [] }), {
      expectedMissionID: mission.missionID,
      automatic: true,
    })
    const final = await readMission(dir, "s")
    assert.equal(first.continuationCount, 1)
    assert.equal(second.continuationCount, 2)
    assert.equal(final.status, "usage_limited")
    assert.match(final.stopReason, /automatic turn limit|no-progress/i)
  })
})

test("active time limit is enforced when accounting a Mission", async () => {
  await withState(async (dir) => {
    const mission = await createMission(dir, "s", "Timed", null, { maxActiveSeconds: 1 })
    const state = await readMission(dir, "s")
    state.accumulatedActiveMs = 2_000
    await writeMission(dir, state)
    const updated = await accountMissionUsage(dir, "s", [], { expectedMissionID: mission.missionID })
    assert.equal(updated.status, "usage_limited")
    assert.match(updated.stopReason, /active time limit/i)
  })
})

test("completion requires evidence for every declared requirement", async () => {
  await withState(async (dir) => {
    const mission = await createMission(dir, "s", "Verified", null, {
      requirements: [
        { id: "tests", text: "Tests pass" },
        { id: "docs", text: "Documentation is updated" },
      ],
    })
    await assert.rejects(
      () => setStoppedStatus(dir, "s", "complete", "done", mission.missionID),
      /requirements|evidence/i,
    )
    const withTests = await addMissionEvidence(dir, "s", "tests", {
      kind: "command",
      summary: "npm test: 10 passed",
    }, mission.missionID)
    assert.equal(withTests.requirements[0].status, "verified")
    await assert.rejects(
      () => setStoppedStatus(dir, "s", "complete", "done", mission.missionID),
      /requirements|evidence/i,
    )
    await addMissionEvidence(dir, "s", "docs", {
      kind: "inspection",
      summary: "README reviewed",
    }, mission.missionID)
    const complete = await setStoppedStatus(dir, "s", "complete", "done", mission.missionID)
    assert.equal(complete.status, "complete")
    assert.equal(complete.requirements.every((requirement) => requirement.status === "verified"), true)
  })
})

test("configured verification gates are persisted and record pass/fail evidence", async () => {
  await withState(async (dir) => {
    const mission = await createMission(dir, "s", "Verify", null, {
      requirements: [{ id: "tests", text: "Tests pass" }],
      verification: [{ id: "unit", command: "npm test", requirementID: "tests" }],
    })
    assert.deepEqual(mission.verification, [{ id: "unit", command: "npm test", requirementID: "tests" }])
    const failed = await recordVerificationResult(dir, "s", "unit", {
      passed: false,
      summary: "npm test: 1 failed",
      attempts: 2,
    }, mission.missionID)
    assert.equal(failed.requirements[0].status, "open")
    assert.equal((await getMissionHistory(dir, "s")).at(-1).attempts, 2)
    const passed = await recordVerificationResult(dir, "s", "unit", {
      passed: true,
      summary: "npm test: all passed",
    }, mission.missionID)
    assert.equal(passed.requirements[0].status, "verified")
  })
})

test("verification evidence becomes stale after the worktree fingerprint changes", async () => {
  await withState(async (dir) => {
    const mission = await createMission(dir, "s", "Fresh evidence", null, {
      requirements: [{ id: "tests", text: "Tests pass" }],
    })
    await addMissionEvidence(dir, "s", "tests", {
      kind: "command",
      summary: "passed",
      fingerprint: "tree-a",
    }, mission.missionID)
    let current = await readMission(dir, "s")
    assert.equal(current.requirements[0].status, "verified")
    current = await refreshMissionEvidence(dir, "s", "tree-b", mission.missionID)
    assert.equal(current.requirements[0].status, "open")
    assert.equal(current.requirements[0].evidence.at(-1).stale, true)
  })
})

test("Mission journal and report explain lifecycle and missing requirements", async () => {
  await withState(async (dir) => {
    const mission = await createMission(dir, "s", "Report", null, {
      requirements: [{ id: "tests", text: "Tests pass" }],
    })
    const history = await getMissionHistory(dir, "s")
    assert.ok(history.some((event) => event.type === "created"))
    const report = await missionReport(dir, "s")
    assert.equal(report.status, "active")
    assert.deepEqual(report.missingRequirements, ["tests"])
    assert.ok(report.historyLength >= 1)
    assert.deepEqual(report.verificationSummary, { total: 0, passed: 0, failed: 0, attempts: 0 })
    assert.deepEqual(report.unresolvedRisks, ["Missing evidence: tests"])
  })
})

test("manual checkpoints persist bounded metadata without changing lifecycle", async () => {
  await withState(async (dir) => {
    const mission = await createMission(dir, "s", "Checkpoint")
    const checkpoint = await addMissionCheckpoint(dir, "s", {
      fingerprint: "tree-a",
      commit: "abc123",
      summary: "Before refactor",
    }, mission.missionID)
    assert.equal(checkpoint.status, "active")
    assert.equal(checkpoint.checkpoints[0].fingerprint, "tree-a")
    assert.equal((await listMissionCheckpoints(dir, "s")).length, 1)
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
