export function createHostSessionAdapter(client) {
  const adapter = client?.adapter || client
  return {
    messages(sessionID) { return adapter.messages(sessionID) },
    children(sessionID) { return adapter.children(sessionID) },
    prompt(sessionID, text) { return adapter.prompt(sessionID, text) },
  }
}

export function normalizePromptResponse(response) {
  if (!response) return null
  if (response.info && Array.isArray(response.parts)) return response
  if (response.message?.info && Array.isArray(response.message?.parts)) return response.message
  return null
}
