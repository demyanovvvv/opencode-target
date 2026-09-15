function sessionID(value) {
  const id = value?.id || value?.sessionID || value?.sessionId
  return id ? String(id) : null
}

function incompleteTraversal(reason, limit, id) {
  const error = new Error(`Usage accounting traversal exceeded ${reason} limit ${limit} at session ${id}.`)
  error.code = "ACCOUNTING_TRAVERSAL_INCOMPLETE"
  error.reason = reason
  error.limit = limit
  error.sessionID = id
  return error
}

export async function collectSessionUsage(adapter, rootSessionID, { maxDepth = 6, maxSessions = 96 } = {}) {
  const depthLimit = Math.max(0, Number(maxDepth) || 0)
  const sessionLimit = Math.max(1, Number(maxSessions) || 1)
  const samples = []
  const queue = [{ id: rootSessionID, depth: 0 }]
  const seen = new Set()

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current?.id || seen.has(current.id)) continue
    if (seen.size >= sessionLimit) throw incompleteTraversal("max_sessions", sessionLimit, current.id)
    seen.add(current.id)

    const messages = await adapter.messages(current.id)
    for (const message of messages) {
      samples.push({ sessionID: current.id, message, descendant: current.id !== rootSessionID })
    }

    const children = await adapter.children(current.id)
    const unseenChildren = children.map(sessionID).filter((id) => id && !seen.has(id))
    if (current.depth >= depthLimit && unseenChildren.length > 0) {
      throw incompleteTraversal("max_depth", depthLimit, current.id)
    }
    for (const id of unseenChildren) queue.push({ id, depth: current.depth + 1 })
  }

  return samples
}
