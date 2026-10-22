function isPlanMode(info) {
  const mode = String(info?.mode || "").toLowerCase()
  const agent = String(info?.agent || "").toLowerCase()
  return mode === "plan" || agent === "plan"
}

export function extractLedgerUsage(message, { excludePlanMode = true, tokenSemantics = "legacy" } = {}) {
  const info = message?.info ?? message
  if (!info || info.role !== "assistant") return null
  const base = {
    id: String(info.id || info.messageID || ""),
    createdAtMs: Number(info.time?.created) || 0,
    completedAtMs: Number(info.time?.completed) || 0,
  }
  if (excludePlanMode && isPlanMode(info)) return { ...base, tokens: 0, excluded: "plan_mode" }
  const count = (tokens = {}) => {
    const safe = value => Number.isSafeInteger(value) && value > 0 ? value : 0
    const input = safe(tokens.input)
    const output = safe(tokens.output)
    return tokenSemantics === "opencode-normalized-v1"
      ? input + output + safe(tokens.reasoning) + safe(tokens.cache?.write)
      : Math.max(0, input - safe(tokens.cache?.read)) + output
  }
  // Message tokens are the latest request snapshot, not an additional request.
  // Retries may retain the message ID while producing distinct step-finish parts.
  const requests = new Map()
  for (const part of message?.parts || []) {
    if (part.type === "step-finish" && part.id) requests.set(part.id, count(part.tokens))
  }
  return { ...base, tokens: Math.max(count(info.tokens), [...requests.values()].reduce((sum, value) => sum + value, 0)), excluded: null }
}

export class UsageLedger {
  constructor({ createdAtMs = 0, maxEntries = 12_000, rootSessionID = "root", usageByMessage = {} } = {}) {
    this.createdAtMs = Number(createdAtMs) || 0
    this.maxEntries = Math.max(1, Number(maxEntries) || 12_000)
    this.rootSessionID = String(rootSessionID)
    this.usageByMessage = new Map(Object.entries(usageByMessage))
    this.truncated = false
  }
  record(samples = [], { excludePlanMode = true, tokenSemantics = "legacy" } = {}) {
    let rootDelta = 0
    let descendantDelta = 0
    for (const sample of samples) {
      const sessionID = String(sample?.sessionID || this.rootSessionID)
      const usage = extractLedgerUsage(sample?.message ?? sample, { excludePlanMode, tokenSemantics })
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
    // These are durable deduplication identities, not an evictable cache.
    // Full-history scans must still recognize records after restart.
    return { rootDelta, descendantDelta, totalDelta: rootDelta + descendantDelta }
  }
  completeness() {
    return { trackedMessages: this.usageByMessage.size, maxEntries: null, truncated: this.truncated }
  }
}
