export class SchedulerState {
  constructor(timers = globalThis) {
    this.timers = timers
    this.inFlight = new Set()
    this.rechecks = new Map()
    this.heartbeats = new Map()
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
    }
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
    this.resetRetries(sessionID)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const sessionID of [...this.rechecks.keys()]) this.clearRecheck(sessionID)
    for (const sessionID of [...this.heartbeats.keys()]) this.stopHeartbeat(sessionID)
    this.retries.clear()
  }
}
