import { TargetStore } from "./store.js"

export class TargetRepository {
  constructor(stateDir, { normalize = (value) => value } = {}) {
    this.store = new TargetStore(stateDir)
    this.normalize = normalize
  }

  async read(sessionID) {
    const value = await this.store.read(sessionID)
    return value === null ? null : this.normalize(value)
  }

  async readValidated(sessionID, validate = () => {}) {
    const value = await this.store.read(sessionID)
    if (value === null) return null
    try {
      const normalized = this.normalize(value)
      validate(normalized)
      return normalized
    } catch (error) {
      const quarantine = await this.store.quarantine(sessionID)
      const diagnostic = new Error(`Target state is corrupt and was quarantined: ${quarantine}`)
      diagnostic.code = "TARGET_STATE_CORRUPT"
      diagnostic.cause = error
      throw diagnostic
    }
  }

  async write(target) {
    const normalized = this.normalize(target)
    await this.store.write(normalized.sessionID, normalized)
    return normalized
  }

  async mutate(sessionID, operation) {
    return this.store.withLock(sessionID, async () => {
      const current = await this.read(sessionID)
      const next = await operation(current)
      if (next === null || next === undefined) return next
      return this.write(next)
    })
  }

  async remove(sessionID) {
    return this.store.remove(sessionID)
  }

  async withLock(sessionID, operation) {
    return this.store.withLock(sessionID, operation)
  }
}
