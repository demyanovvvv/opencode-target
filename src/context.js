// Context settings are independent of the Target lifecycle and survive clearing a goal.
// A dedicated store provides atomic writes, cross-process locks and corruption quarantine.
import path from "node:path"
import { TargetStore } from "./store.js"

const CONTEXT_VERSION = 1
const CONTEXT_DEFAULTS_KEY = "defaults"
const CONTEXT_INITIAL = { enabled: false, threshold: null }

export function recordContextEvent(record, type, details = {}) {
  record.runtime.events = [...(record.runtime.events ?? []), { type, atMs: Date.now(), details }].slice(-50)
}

export function parseContextThreshold(raw) {
  const text = String(raw).trim()
  if (/^(?:[1-9]|[1-9]\d)%$/.test(text)) return { kind: "percent", value: Number(text.slice(0, -1)) }
  const match = text.match(/^(\d+(?:_\d+)*(?:\.\d+)?)([km])?$/i)
  const value = match ? Number(match[1].replaceAll("_", "")) * ({ k: 1000, m: 1000000 }[match[2]?.toLowerCase()] ?? 1) : NaN
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Context threshold must be positive whole tokens (100k, 1m) or 1%–99%.")
  return { kind: "tokens", value }
}

export function parseContextCommand(raw = "") {
  const words = String(raw).trim().split(/\s+/).filter(Boolean)
  const scope = words[0]?.toLowerCase() === "default" ? (words.shift(), "default") : "session"
  const arg = words[0]?.toLowerCase() || "status"
  if (words.length > 1 || (arg === "reset" && scope === "default")) throw new Error("Usage: /target context [default] [100k|70%|on|off|status] or /target context reset")
  if (["status", "on", "off", "reset"].includes(arg)) return { scope, action: arg }
  return { scope, action: "set", threshold: parseContextThreshold(arg) }
}

function validateContextSettings(value) {
  if (!value || typeof value.enabled !== "boolean") throw new Error("Invalid context settings")
  const threshold = value.threshold
  if (threshold !== null && (!threshold || !["tokens", "percent"].includes(threshold.kind) || !Number.isSafeInteger(threshold.value) || threshold.value < 1 || (threshold.kind === "percent" && threshold.value > 99))) throw new Error("Invalid context threshold")
  if (value.enabled && !threshold) throw new Error("Enabled context settings require a threshold")
  return { enabled: value.enabled, threshold: threshold ? { kind: threshold.kind, value: threshold.value } : null }
}

export class ContextSettings {
  constructor(stateDir) { this.store = new TargetStore(path.join(stateDir, "context")) }

  async read(key) {
    const value = await this.store.read(key)
    if (value === null) return null
    try {
      if (value.version !== CONTEXT_VERSION || value.sessionID !== key || !value.runtime || typeof value.runtime !== "object" || Array.isArray(value.runtime)) throw new Error("Invalid context state")
      const pending = value.runtime.pending
      if (pending !== undefined && pending !== null && (typeof pending.id !== "string" || !pending.id || typeof pending.targetID !== "string" || !pending.targetID || !Number.isFinite(pending.startedAtMs) || pending.startedAtMs <= 0 || !Number.isSafeInteger(pending.revision) || pending.revision < 0)) throw new Error("Invalid pending compaction request")
      if (value.revision !== undefined && (!Number.isSafeInteger(value.revision) || value.revision < 0)) throw new Error("Invalid context settings revision")
      if (value.runtime.events !== undefined && !Array.isArray(value.runtime.events)) throw new Error("Invalid context events")
      return { ...value, settings: validateContextSettings(value.settings) }
    } catch (cause) {
      const file = await this.store.quarantine(key)
      const error = new Error(`Context state is corrupt and was quarantined: ${file}`, { cause })
      error.code = "TARGET_CONTEXT_CORRUPT"
      throw error
    }
  }

  async defaults() { return (await this.read(CONTEXT_DEFAULTS_KEY))?.settings ?? { ...CONTEXT_INITIAL } }

  async mutate(sessionID, operation) {
    const key = `session:${sessionID}`
    return this.store.withLock(key, async () => {
      const current = await this.read(key) ?? { version: CONTEXT_VERSION, sessionID: key, settings: await this.defaults(), runtime: {}, source: "default", revision: 0 }
      const next = await operation(current)
      if (next === null) return null
      await this.store.write(key, next)
      return next
    })
  }

  session(sessionID) { return this.mutate(sessionID, (current) => current) }

  async command(sessionID, parsed) {
    if (parsed.scope === "default") {
      return this.store.withLock(CONTEXT_DEFAULTS_KEY, async () => {
        const current = await this.read(CONTEXT_DEFAULTS_KEY) ?? { version: CONTEXT_VERSION, sessionID: CONTEXT_DEFAULTS_KEY, settings: { ...CONTEXT_INITIAL }, runtime: {} }
        current.settings = this.apply(current.settings, parsed)
        if (parsed.action !== "status") recordContextEvent(current, "settings.changed", { scope: "default", action: parsed.action, ...current.settings })
        await this.store.write(CONTEXT_DEFAULTS_KEY, current)
        return current
      })
    }
    return this.mutate(sessionID, async (current) => {
      if (parsed.action === "status") return current
      current.settings = parsed.action === "reset" ? await this.defaults() : this.apply(current.settings, parsed)
      current.source = parsed.action === "reset" ? "default" : "session"
      current.revision = (current.revision || 0) + 1
      current.runtime = { ...current.runtime, armed: true, awaitingFresh: false, reason: null, failureAttempts: 0, nextRetryAtMs: null }
      recordContextEvent(current, "settings.changed", { scope: "session", action: parsed.action, ...current.settings })
      return current
    })
  }

  apply(settings, parsed) {
    if (parsed.action === "set") return validateContextSettings({ enabled: true, threshold: parsed.threshold })
    if (parsed.action === "on" && !settings.threshold) throw new Error("Set a context threshold first, for example: /target context 100k")
    return validateContextSettings({ ...settings, enabled: parsed.action === "on" ? true : parsed.action === "off" ? false : settings.enabled })
  }
}

function contextMessageAfter(info, other) {
  return !other || (Number(info.time?.created) || 0) > (Number(other.time?.created) || 0) || ((Number(info.time?.created) || 0) === (Number(other.time?.created) || 0) && String(info.id) > String(other.id))
}

export function contextMeasurement(messages = []) {
  let latest = null
  let summary = null
  let user = null
  for (const message of messages) {
    const info = message.info ?? message
    if (info.role === "user" && contextMessageAfter(info, user)) user = info
    if (info.role !== "assistant" || !info.time?.completed || info.error) continue
    if ((info.summary || info.mode === "compaction" || info.agent === "compaction") && contextMessageAfter(info, summary)) summary = info
    if (!(info.summary || info.mode === "compaction" || info.agent === "compaction") && contextMessageAfter(info, latest)) latest = info
  }
  let sample = null
  if (latest && (!summary || contextMessageAfter(latest, summary))) {
    const usage = latest.tokens ?? {}
    const finite = (n) => Number.isFinite(n) && n >= 0 ? n : 0
    const tokens = finite(usage.total) || finite(usage.input) + finite(usage.output) + finite(usage.cache?.read) + finite(usage.cache?.write)
    if (tokens > 0) sample = { id: latest.id, tokens, createdAtMs: latest.time.created, completedAtMs: latest.time.completed, providerID: latest.providerID, modelID: latest.modelID }
  }
  return { sample, summary: summary ? { id: summary.id, createdAtMs: summary.time.created, completedAtMs: summary.time.completed } : null, user }
}

export function contextThresholdTokens(threshold, model) {
  if (!threshold) return null
  if (threshold.kind === "tokens") return threshold.value
  const context = Number(model?.limit?.context)
  return Number.isFinite(context) && context > 0 ? Math.floor(context * threshold.value / 100) : null
}

export function contextStatus(record, { scope = "session", active = false, supported = true } = {}) {
  const { settings, runtime = {} } = record
  const threshold = settings.threshold ? `${settings.threshold.value.toLocaleString("en-US")}${settings.threshold.kind === "percent" ? "%" : " tokens"}` : "not set"
  return [
    "Target context — automatic native /compact",
    `Enabled: ${settings.enabled}; scope: ${scope}; source: ${record.source || scope}`,
    `Threshold: ${threshold}`,
    runtime.modelContext ? `Model window: ${runtime.modelContext.toLocaleString("en-US")} tokens (${runtime.providerID}/${runtime.modelID})` : null,
    runtime.thresholdTokens ? `Trigger: ${runtime.thresholdTokens.toLocaleString("en-US")} tokens` : null,
    runtime.sample ? `Last context: ${runtime.sample.tokens.toLocaleString("en-US")} tokens${runtime.modelContext ? ` (${(runtime.sample.tokens * 100 / runtime.modelContext).toFixed(1)}%)` : ""}; measured ${new Date(runtime.sample.completedAtMs).toISOString()}` : "Last context: no fresh measurement",
    `Compaction: ${!supported ? "unavailable (session.summarize API missing)" : runtime.pending ? "pending" : runtime.reason || (active ? "waiting for threshold" : "waiting for an active Target")}`,
    runtime.lastCompletedAtMs ? `Last successful compaction: ${new Date(runtime.lastCompletedAtMs).toISOString()}` : null,
    runtime.lastError ? `Last error: ${runtime.lastError}` : null,
    runtime.events?.length ? `Recent events:\n${runtime.events.slice(-5).map((event) => `- ${new Date(event.atMs).toISOString()} ${event.type}`).join("\n")}` : null,
  ].filter(Boolean).join("\n")
}
