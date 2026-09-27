function getEventSessionID(event) {
  return event?.properties?.sessionID || event?.properties?.sessionId || event?.properties?.info?.id || event?.sessionID || event?.sessionId || null
}

export function resolveEventAction(event, autoContinue = true) {
  if (event?.type === "server.instance.disposed") return { action: "dispose" }
  const sessionID = getEventSessionID(event)
  if (!sessionID) return { action: "ignore" }
  if (event.type === "session.deleted") return { action: "dispose-session", sessionID }
  if (event.type === "session.idle" && autoContinue) return { action: "process-idle", sessionID }
  if (event.type === "session.error") return { action: "process-error", sessionID }
  return { action: "ignore" }
}
