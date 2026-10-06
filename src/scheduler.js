export class SchedulerState {
  constructor(timers = globalThis) {
    this.timers = timers
    this.inFlight = new Set()
    this.inFlightWaiters = new Map()
    this.rechecks = new Map()
    this.heartbeats = new Map()
    this.continuationWatchdogs = new Map()
    this.retries = new Map()
    this.disposed = false
  }

  async runExclusive(sessionID, operation) {
    if (this.disposed || this.inFlight.has(sessionID)) {
      return { started: false, value: undefined }
    }
    this.inFlight.add(sessionID)
    try {
      return { started: true, value: await operation() }
    } finally {
      this.inFlight.delete(sessionID)
      this.resolveIdleWaiters(sessionID)
    }
  }

  isSettled(sessionID) {
    return !this.inFlight.has(sessionID) && !this.rechecks.has(sessionID)
  }

  resolveIdleWaiters(sessionID) {
    if (!this.isSettled(sessionID)) return
    const waiters = this.inFlightWaiters.get(sessionID)
    if (!waiters) return
    this.inFlightWaiters.delete(sessionID)
    for (const resolve of waiters) resolve()
  }

  whenIdle(sessionID) {
    if (this.isSettled(sessionID)) return Promise.resolve()
    let resolve
    const promise = new Promise((r) => { resolve = r })
    const waiters = this.inFlightWaiters.get(sessionID) ?? new Set()
    waiters.add(resolve)
    this.inFlightWaiters.set(sessionID, waiters)
    return promise
  }

  scheduleRecheck(sessionID, delayMs, operation) {
    if (this.disposed) return false
    this.clearRecheck(sessionID)
    const timer = this.timers.setTimeout(() => {
      if (this.rechecks.get(sessionID) === timer) this.rechecks.delete(sessionID)
      operation()
    }, Math.max(0, delayMs))
    this.rechecks.set(sessionID, timer)
    return true
  }

  hasScheduledRecheck(sessionID) {
    return this.rechecks.has(sessionID)
  }

  clearRecheck(sessionID) {
    const timer = this.rechecks.get(sessionID)
    if (timer !== undefined) this.timers.clearTimeout(timer)
    this.rechecks.delete(sessionID)
  }

  startHeartbeat(sessionID, intervalMs, operation) {
    if (this.disposed) return false
    this.stopHeartbeat(sessionID)
    const timer = this.timers.setInterval(operation, intervalMs)
    this.heartbeats.set(sessionID, timer)
    return true
  }

  stopHeartbeat(sessionID) {
    const timer = this.heartbeats.get(sessionID)
    if (timer !== undefined) this.timers.clearInterval(timer)
    this.heartbeats.delete(sessionID)
  }

  startContinuationWatchdog(sessionID, delayMs, operation) {
    if (this.disposed) return false
    this.stopContinuationWatchdog(sessionID)
    const timer = this.timers.setTimeout(() => {
      if (this.continuationWatchdogs.get(sessionID) !== timer || this.disposed) return
      this.continuationWatchdogs.delete(sessionID)
      operation()
    }, Math.max(0, delayMs))
    timer?.unref?.()
    this.continuationWatchdogs.set(sessionID, timer)
    return true
  }

  stopContinuationWatchdog(sessionID) {
    const timer = this.continuationWatchdogs.get(sessionID)
    if (timer !== undefined) this.timers.clearTimeout(timer)
    this.continuationWatchdogs.delete(sessionID)
  }

  nextRetry(sessionID, { maxAttempts = 1, baseDelayMs = 250, maxDelayMs = 5000 } = {}, scope = "default") {
    if (this.disposed) return { attempt: 0, retry: false, delayMs: 0 }
    const sessionRetries = this.retries.get(sessionID) || new Map()
    const attempt = (sessionRetries.get(scope) || 0) + 1
    sessionRetries.set(scope, attempt)
    this.retries.set(sessionID, sessionRetries)
    const retry = attempt < maxAttempts
    const delayMs = retry ? Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1))) : 0
    return { attempt, retry, delayMs }
  }

  resetRetries(sessionID, scope = null) {
    if (scope == null) {
      this.retries.delete(sessionID)
      return
    }
    const sessionRetries = this.retries.get(sessionID)
    if (!sessionRetries) return
    sessionRetries.delete(scope)
    if (sessionRetries.size === 0) this.retries.delete(sessionID)
  }

  disposeSession(sessionID) {
    this.clearRecheck(sessionID)
    this.stopHeartbeat(sessionID)
    this.stopContinuationWatchdog(sessionID)
    this.resetRetries(sessionID)
    this.resolveIdleWaiters(sessionID)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const sessionID of [...this.rechecks.keys()]) this.clearRecheck(sessionID)
    for (const sessionID of [...this.heartbeats.keys()]) this.stopHeartbeat(sessionID)
    for (const sessionID of [...this.continuationWatchdogs.keys()]) this.stopContinuationWatchdog(sessionID)
    for (const sessionID of [...this.inFlightWaiters.keys()]) this.resolveIdleWaiters(sessionID)
    this.retries.clear()
  }
}
