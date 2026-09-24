export function eventErrorText(event) {
  const value = event?.properties?.error ?? event?.error ?? ""
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function isUsageLimitError(text) {
  return /(?:429|rate.?limit|quota|usage.?limit|insufficient.?quota|too many requests|usage.?limited)/i.test(text)
}

export function isAbortError(text) {
  return /(?:aborted|cancelled|canceled|MessageAbortedError|AbortError|interrupted)/i.test(text)
}

export function isTransientAccountingError(error) {
  return error?.code === "OPENCODE_MESSAGES_FAILED" ||
    error?.code === "OPENCODE_CHILDREN_FAILED" ||
    error?.code === "OPENCODE_PROMPT_FAILED"
}
