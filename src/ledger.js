function isPlanMode(info) {
  const mode = String(info?.mode || "").toLowerCase()
  const agent = String(info?.agent || "").toLowerCase()
  return mode === "plan" || agent === "plan"
}

export function extractLedgerUsage(message, { excludePlanMode = true } = {}) {
  const info = message?.info ?? message
  if (!info || info.role !== "assistant") return null
  const base = {
    id: String(info.id || info.messageID || ""),
    createdAtMs: Number(info.time?.created) || 0,
    completedAtMs: Number(info.time?.completed) || 0,
  }
  if (excludePlanMode && isPlanMode(info)) return { ...base, tokens: 0, excluded: "plan_mode" }
  const tokens = info.tokens || {}
  const input = Math.max(0, Number(tokens.input) || 0)
  const cachedInput = Math.max(0, Number(tokens.cache?.read) || 0)
  const output = Math.max(0, Number(tokens.output) || 0)
  return { ...base, tokens: Math.max(0, input - cachedInput) + output, excluded: null }
}

export class UsageLedger {
  constructor({ createdAtMs = 0, maxEntries = 12_000, rootSessionID = "root", usageByMessage = {} } = {}) {
    this.createdAtMs = Number(createdAtMs) || 0
    this.maxEntries = Math.max(1, Number(maxEntries) || 12_000)
    this.rootSessionID = String(rootSessionID)
    this.usageByMessage = new Map(Object.entries(usageByMessage))
    this.truncated = false
  }
  record(samples = [], { excludePlanMode = true } = {}) {
    let rootDelta = 0
    let descendantDelta = 0
    for (const sample of samples) {
      const sessionID = String(sample?.sessionID || this.rootSessionID)
      const usage = extractLedgerUsage(sample?.message ?? sample, { excludePlanMode })
      if (!usage?.id) continue
      const key = `${sessionID}:${usage.id}`
      if (usage.createdAtMs && usage.createdAtMs < this.createdAtMs && !this.usageByMessage.has(key)) {
        this.usageByMessage.set(key, usage.tokens)
        continue
      }
      const previous = this.usageByMessage.get(key) || 0
      if (usage.tokens > previous) {
        const delta = usage.tokens - previous
        this.usageByMessage.set(key, usage.tokens)
        if (sessionID === this.rootSessionID) rootDelta += delta
        else descendantDelta += delta
      }
    }
    if (this.usageByMessage.size > this.maxEntries) {
      const entries = [...this.usageByMessage.entries()].slice(-this.maxEntries)
      this.usageByMessage = new Map(entries)
      this.truncated = true
    }
    return { rootDelta, descendantDelta, totalDelta: rootDelta + descendantDelta }
  }
  completeness() {
    return { trackedMessages: this.usageByMessage.size, maxEntries: this.maxEntries, truncated: this.truncated }
  }
}
