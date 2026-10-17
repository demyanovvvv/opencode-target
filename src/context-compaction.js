// Coordinates native compaction without owning the assistant's continuation loop.
// Durable request identities fence duplicate events, replacement Targets and restarts.
import { randomUUID } from "node:crypto"
import { accountTargetUsage, acquireSchedulerLease, newSchedulerOwnerID, readTarget, releaseSchedulerLease, setStoppedStatus } from "./core.js"
import { contextMeasurement, contextStatus, contextThresholdTokens, recordContextEvent } from "./context.js"

export class ContextCompactor {
  constructor({ stateDir, settings, adapter, timeoutMs = 120000, pendingInput = () => false, onReady = () => {}, log = () => {} }) {
    Object.assign(this, { stateDir, settings, adapter, timeoutMs, pendingInput, onReady, log })
    this.checks = new Map()
    this.rechecks = new Set()
    this.requests = new Map()
    this.timers = new Map()
    this.disposed = false
  }

  check(sessionID, options = {}) {
    if (this.disposed) return Promise.resolve(false)
    if (this.checks.has(sessionID)) {
      this.rechecks.add(sessionID)
      return this.checks.get(sessionID)
    }
    const operation = (async () => {
      let pending
      do {
        this.rechecks.delete(sessionID)
        pending = await this.evaluate(sessionID, options)
      } while (!this.disposed && this.rechecks.delete(sessionID))
      return pending
    })().finally(() => this.checks.delete(sessionID))
    this.checks.set(sessionID, operation)
    return operation
  }

  async evaluate(sessionID, { leaseOwner = null } = {}) {
    const target = await readTarget(this.stateDir, sessionID)
    if (!target) return false
    let record = await this.settings.session(sessionID)
    if (!record.settings.enabled && !record.runtime.pending) return false
    const messages = await this.adapter.messages(sessionID)
    const measurement = contextMeasurement(messages)
    const { sample, summary } = measurement
    const pending = record.runtime.pending
    if (pending) {
      if (summary && summary.id !== pending.summaryID && summary.createdAtMs >= pending.startedAtMs) {
        await this.completed(sessionID, pending.id, summary)
        record = await this.settings.session(sessionID)
      } else {
        if (!pending.uncertainAtMs && !this.requests.has(sessionID) && Date.now() - pending.startedAtMs >= this.timeoutMs) {
          await this.fail(sessionID, pending, new Error("Compaction result could not be confirmed after restart or timeout"), true)
        }
        this.wake(sessionID, pending.uncertainAtMs ? 1000 : Math.max(1000, this.timeoutMs - (Date.now() - pending.startedAtMs)))
        return true
      }
    }
    if (summary && summary.id !== record.runtime.summaryID) {
      record = await this.settings.mutate(sessionID, (current) => {
        current.runtime = { ...current.runtime, summaryID: summary.id, lastCompletedAtMs: summary.completedAtMs, awaitingFresh: true, armed: false, sample: null, reason: "waiting for fresh context after compaction" }
        return current
      })
    }
    // Summary completion releases work even if its transport is still settling.
    // Keep the transport fence only for subsequent compaction requests.
    if (this.requests.has(sessionID)) return false
    if (target.status !== "active") return false
    if (!record.settings.enabled) return false
    if (!sample) return false
    const revision = record.revision
    const modelIdentity = measurement.user?.model ?? { providerID: sample.providerID, modelID: sample.modelID }
    let model = null
    try { model = await this.adapter.model?.(modelIdentity.providerID, modelIdentity.modelID) } catch (error) { this.log("warn", "Context model lookup failed", { error: error.message }) }
    const thresholdTokens = contextThresholdTokens(record.settings.threshold, model)
    record = await this.settings.mutate(sessionID, (current) => {
      if (current.revision !== revision || current.runtime.pending) return current
      const runtime = current.runtime
      Object.assign(runtime, { sample, modelContext: Number(model?.limit?.context) || null, thresholdTokens, ...modelIdentity })
      if (thresholdTokens === null) runtime.reason = "model context window is unavailable"
      else if (sample.tokens < thresholdTokens) Object.assign(runtime, { armed: true, awaitingFresh: false, reason: null, failureAttempts: 0, nextRetryAtMs: null })
      else if (runtime.awaitingFresh) Object.assign(runtime, { armed: false, awaitingFresh: false, reason: "Context threshold is below the context size after compaction; increase the threshold." })
      return current
    })
    if (record.revision !== revision) { this.wake(sessionID, 50); return true }
    if (!record.settings.enabled || record.runtime.pending || !thresholdTokens || sample.tokens < thresholdTokens || record.runtime.armed === false || this.pendingInput(sessionID)) return Boolean(record.runtime.pending)
    if (record.runtime.nextRetryAtMs > Date.now()) {
      this.wake(sessionID, record.runtime.nextRetryAtMs - Date.now())
      return true
    }
    if (typeof this.adapter.summarize !== "function" || !modelIdentity.providerID || !modelIdentity.modelID) {
      await this.settings.mutate(sessionID, (current) => { current.runtime.reason = "native compaction API or model identity unavailable"; return current })
      return false
    }
    const accounted = await accountTargetUsage(this.stateDir, sessionID, messages.map((message) => ({ sessionID, message })), { expectedTargetID: target.targetID })
    if (!accounted || accounted.status !== "active") return false

    const owner = leaseOwner ?? newSchedulerOwnerID()
    const lease = leaseOwner ? { acquired: true } : await acquireSchedulerLease(this.stateDir, sessionID, owner, { expectedTargetID: target.targetID, leaseMs: 30000 })
    if (!lease?.acquired) { this.wake(sessionID, 50); return true }
    try {
      const live = await readTarget(this.stateDir, sessionID)
      if (live?.targetID !== target.targetID || live.status !== "active" || this.disposed || this.pendingInput(sessionID)) return false
      const request = { id: randomUUID(), targetID: target.targetID, startedAtMs: Date.now(), sampleID: sample.id, summaryID: summary?.id ?? null, revision: record.revision }
      let claimed = false
      await this.settings.mutate(sessionID, (current) => {
        if (!current.settings.enabled || current.revision !== record.revision || current.runtime.pending || current.runtime.armed === false) return current
        current.runtime.pending = request
        current.runtime.reason = "native compaction requested"
        recordContextEvent(current, "compaction.requested", { targetID: request.targetID, tokens: sample.tokens, thresholdTokens })
        claimed = true
        return current
      })
      if (!claimed) return Boolean((await this.settings.session(sessionID)).runtime.pending)
      this.log("info", "Target native compaction requested", { sessionID, tokens: sample.tokens, thresholdTokens })
      // Dispatch out of the host event hook. The endpoint can wait for the busy loop.
      const operation = Promise.resolve().then(() => this.adapter.summarize(sessionID, modelIdentity))
        .then(async () => {
          if (this.disposed) return
          const result = contextMeasurement(await this.adapter.messages(sessionID)).summary
          if (!result || result.id === request.summaryID) throw new Error("Native compaction returned without a completed summary")
          await this.completed(sessionID, request.id, result)
        }).catch(async (error) => { if (!this.disposed) await this.fail(sessionID, request, error, error?.code === "OPENCODE_COMPACTION_UNCERTAIN") })
        .catch((error) => this.log("error", "Context result persistence failed", { sessionID, error: error.message }))
        .finally(() => { this.requests.delete(sessionID) })
      this.requests.set(sessionID, operation)
      this.wake(sessionID, this.timeoutMs)
      return true
    } finally { if (!leaseOwner) await releaseSchedulerLease(this.stateDir, sessionID, owner, target.targetID) }
  }

  async completed(sessionID, requestID, summary) {
    let completed = false
    await this.settings.mutate(sessionID, (current) => {
      if (current.runtime.pending?.id !== requestID) return current
      const sameRevision = current.runtime.pending.revision === current.revision
      current.runtime = { ...current.runtime, pending: null, summaryID: summary.id, lastCompletedAtMs: summary.completedAtMs, sample: null, awaitingFresh: sameRevision, armed: !sameRevision, reason: sameRevision ? "waiting for fresh context after compaction" : null, lastError: null, failureAttempts: 0, nextRetryAtMs: null }
      recordContextEvent(current, "compaction.completed", { summaryID: summary.id })
      completed = true
      return current
    })
    if (!completed) return
    this.clearTimer(sessionID)
    this.log("info", "Target native compaction completed", { sessionID })
    if (!this.disposed) this.onReady(sessionID)
  }

  async compacting(sessionID) {
    const target = await readTarget(this.stateDir, sessionID)
    if (target?.status !== "active") return
    const summary = contextMeasurement(await this.adapter.messages(sessionID)).summary
    await this.settings.mutate(sessionID, (current) => {
      if (current.runtime.pending) return current
      current.runtime.pending = { id: randomUUID(), targetID: target.targetID, startedAtMs: Date.now(), summaryID: summary?.id ?? null, revision: current.revision, manual: true }
      current.runtime.reason = "native compaction in progress"
      recordContextEvent(current, "compaction.observed", { targetID: target.targetID })
      return current
    })
    this.wake(sessionID, this.timeoutMs)
  }

  async fail(sessionID, request, error, uncertain = false) {
    let attempts = 0
    let waiting = false
    let changed = false
    await this.settings.mutate(sessionID, (current) => {
      if (current.runtime.pending?.id !== request.id) return current
      if (uncertain) {
        waiting = true
        if (current.runtime.pending.uncertainAtMs) return current
        current.runtime.pending = { ...current.runtime.pending, uncertainAtMs: Date.now() }
        Object.assign(current.runtime, { lastError: String(error.message || error).slice(0, 500), reason: "waiting for compaction result", nextRetryAtMs: null })
        recordContextEvent(current, "compaction.uncertain", { targetID: request.targetID, error: current.runtime.lastError })
        changed = true
        return current
      }
      attempts = (current.runtime.failureAttempts || 0) + 1
      Object.assign(current.runtime, { pending: null, lastError: String(error.message || error).slice(0, 500), failureAttempts: attempts, reason: "compaction failed", nextRetryAtMs: Date.now() + Math.min(5000, 500 * 2 ** (attempts - 1)) })
      recordContextEvent(current, "compaction.failed", { targetID: request.targetID, error: current.runtime.lastError, uncertain, attempt: attempts })
      changed = true
      return current
    })
    if (changed) this.clearTimer(sessionID)
    if (attempts >= 3) await setStoppedStatus(this.stateDir, sessionID, "paused", `Automatic compaction failed: ${error.message}`, request.targetID)
    else if (attempts) this.wake(sessionID, Math.min(5000, 500 * 2 ** (attempts - 1)))
    if (waiting) this.wake(sessionID, 1000)
    if (changed) this.log("warn", uncertain ? "Target native compaction awaiting result" : "Target native compaction failed", { sessionID, error: error.message, uncertain })
  }

  async status(sessionID) {
    const target = await readTarget(this.stateDir, sessionID)
    return contextStatus(await this.settings.session(sessionID), { active: target?.status === "active", supported: typeof this.adapter.summarize === "function" })
  }

  wake(sessionID, delay) {
    if (this.disposed || this.timers.has(sessionID)) return
    const timer = setTimeout(() => {
      this.timers.delete(sessionID)
      void this.check(sessionID).then((pending) => { if (!pending && !this.disposed) this.onReady(sessionID) }).catch((error) => this.log("warn", "Context check failed", { sessionID, error: error.message }))
    }, Math.max(50, delay))
    timer.unref?.()
    this.timers.set(sessionID, timer)
  }

  clearTimer(sessionID) { clearTimeout(this.timers.get(sessionID)); this.timers.delete(sessionID) }
  async settled(sessionID) { await this.checks.get(sessionID); await this.requests.get(sessionID) }
  disposeSession(sessionID) { this.clearTimer(sessionID); this.rechecks.delete(sessionID) }
  dispose() { this.disposed = true; this.rechecks.clear(); for (const id of this.timers.keys()) this.clearTimer(id) }
}
