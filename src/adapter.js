import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

function unwrapData(value) {
  return value?.data ?? value
}

function requireArray(value, endpoint, sessionID) {
  if (Array.isArray(value)) return value
  const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value
  const error = new Error(`OpenCode ${endpoint} API returned ${actual} for session ${sessionID}; expected an array.`)
  error.code = endpoint === "messages" ? "OPENCODE_MESSAGES_FAILED" : "OPENCODE_CHILDREN_FAILED"
  throw error
}

function requirePrompt(value, sessionID) {
  if (value && typeof value === "object" && value.info && Array.isArray(value.parts)) return value
  const error = new Error(`OpenCode prompt API returned an invalid response for session ${sessionID}; expected an assistant message.`)
  error.code = "OPENCODE_PROMPT_FAILED"
  throw error
}

async function withTimeout(operation, timeoutMs, endpoint, sessionID, controller = null) {
  const limit = Number(timeoutMs)
  if (!Number.isFinite(limit) || limit <= 0) return operation()
  let timer
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller?.abort()
          const error = new Error(`OpenCode ${endpoint} API timed out after ${limit}ms for session ${sessionID}.`)
          error.code = "OPENCODE_HOST_TIMEOUT"
          reject(error)
        }, limit)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export function createGitAdapter({ exec = execFileAsync } = {}) {
  return {
    async fingerprint(cwd = process.cwd()) {
      const { stdout: head } = await exec("git", ["rev-parse", "HEAD"], { cwd })
      const { stdout: status } = await exec("git", ["status", "--porcelain=v1"], { cwd })
      return `${String(head).trim()}|${String(status)}`.slice(0, 4000)
    },
  }
}

export function createOpenCodeAdapter(client, { timeoutMs = 30_000, compactionTimeoutMs = 120_000 } = {}) {
  const pendingPrompts = new Set()
  const pendingMessages = new Map()
  const pendingCompactions = new Set()
  let models = null
  let modelsAt = 0
  return {
    async model(providerID, modelID) {
      if (!providerID || !modelID || typeof client.provider?.list !== "function") return null
      if (!models || Date.now() - modelsAt > 30000) {
        const response = await withTimeout(() => client.provider.list(), timeoutMs, "providers", providerID)
        if (response?.error || response?.response?.ok === false) throw new Error("OpenCode provider API failed")
        models = unwrapData(response)?.all ?? []
        modelsAt = Date.now()
      }
      return models.find((provider) => provider.id === providerID)?.models?.[modelID] ?? null
    },
    ...(typeof client.session?.summarize === "function" ? {
      async summarize(sessionID, model) {
        if (pendingCompactions.has(sessionID)) {
          const error = new Error("A native compaction request is still unsettled")
          error.code = "OPENCODE_COMPACTION_UNCERTAIN"
          throw error
        }
        const controller = new AbortController()
        pendingCompactions.add(sessionID)
        try {
          const response = await withTimeout(() => Promise.resolve().then(() => client.session.summarize({
            path: { id: sessionID }, body: { ...model, auto: false }, signal: controller.signal,
          })).finally(() => pendingCompactions.delete(sessionID)), compactionTimeoutMs, "summarize", sessionID, controller)
          if (response?.error || response?.response?.ok === false || unwrapData(response) !== true) {
            const error = new Error(`Native compaction request failed: ${JSON.stringify(response?.error ?? unwrapData(response))}`)
            error.code = "OPENCODE_COMPACTION_FAILED"
            throw error
          }
          return true
        } catch (cause) {
          if (cause?.code === "OPENCODE_COMPACTION_FAILED") throw cause
          const error = new Error(`Native compaction result is uncertain: ${cause.message}`, { cause })
          error.code = "OPENCODE_COMPACTION_UNCERTAIN"
          throw error
        }
      },
    } : {}),
    async messages(sessionID) {
      if (pendingMessages.has(sessionID)) return pendingMessages.get(sessionID)
      const operation = (async () => {
      const controller = new AbortController()
      try {
        const data = unwrapData(await withTimeout(
          () => client.session.messages({ path: { id: sessionID }, signal: controller.signal }),
          timeoutMs,
          "messages",
          sessionID,
          controller,
        ))
        return requireArray(data, "messages", sessionID)
      } catch (error) {
        if (error?.code === "OPENCODE_MESSAGES_FAILED") throw error
        const failure = new Error(`OpenCode messages API failed for session ${sessionID}: ${error?.message || String(error)}`)
        failure.code = "OPENCODE_MESSAGES_FAILED"
        failure.cause = error
        throw failure
      }
      })()
      pendingMessages.set(sessionID, operation)
      try { return await operation } finally { pendingMessages.delete(sessionID) }
    },
    async status(sessionID) {
      const controller = new AbortController()
      const response = await withTimeout(() => client.session.status({ signal: controller.signal }), timeoutMs, "status", sessionID, controller)
      if (response?.error || response?.response?.ok === false) throw new Error("Session status unavailable")
      return (response?.data ?? response)?.[sessionID]?.type
    },
    async children(sessionID) {
      try {
        const data = unwrapData(await withTimeout(
          () => client.session.children({ path: { id: sessionID } }),
          timeoutMs,
          "children",
          sessionID,
        ))
        return requireArray(data, "children", sessionID)
      } catch (error) {
        if (error?.code === "OPENCODE_CHILDREN_FAILED") throw error
        const failure = new Error(`OpenCode children API failed for session ${sessionID}: ${error?.message || String(error)}`)
        failure.code = "OPENCODE_CHILDREN_FAILED"
        failure.cause = error
        throw failure
      }
    },
    async prompt(sessionID, text) {
      if (pendingPrompts.has(sessionID)) {
        const error = new Error(`OpenCode prompt is still pending for session ${sessionID}; refusing an overlapping continuation.`)
        error.code = "OPENCODE_PROMPT_PENDING"
        throw error
      }
      const controller = new AbortController()
      pendingPrompts.add(sessionID)
      try {
        const response = await withTimeout(
          () => Promise.resolve().then(() => client.session.prompt({
            path: { id: sessionID },
            body: { parts: [{ type: "text", text, synthetic: true }] },
            signal: controller.signal,
          })).finally(() => pendingPrompts.delete(sessionID)),
          timeoutMs,
          "prompt",
          sessionID,
          controller,
        )
        return requirePrompt(unwrapData(response), sessionID)
      } catch (error) {
        if (error?.code === "OPENCODE_PROMPT_FAILED" || error?.code === "OPENCODE_PROMPT_PENDING") throw error
        const failure = new Error(`OpenCode prompt API failed for session ${sessionID}: ${error?.message || String(error)}`)
        failure.code = "OPENCODE_PROMPT_FAILED"
        failure.cause = error
        throw failure
      }
    },
    async promptAsync(sessionID, text) {
      if (pendingPrompts.has(sessionID)) {
        const error = new Error(`OpenCode prompt is still pending for session ${sessionID}; refusing an overlapping continuation.`)
        error.code = "OPENCODE_PROMPT_PENDING"
        throw error
      }
      const controller = new AbortController()
      pendingPrompts.add(sessionID)
      try {
        const result = await withTimeout(
          () => Promise.resolve().then(() => client.session.promptAsync({
            path: { id: sessionID },
            body: { parts: [{ type: "text", text, synthetic: true }] },
            signal: controller.signal,
          })).finally(() => pendingPrompts.delete(sessionID)),
          timeoutMs,
          "prompt_async",
          sessionID,
          controller,
        )
        if (result?.error || result?.response?.ok === false) {
          throw new Error(`OpenCode async prompt rejected (${result?.response?.status ?? "unknown"}): ${result?.error?.message || JSON.stringify(result?.error)}`)
        }
      } catch (error) {
        if (error?.code === "OPENCODE_PROMPT_FAILED" || error?.code === "OPENCODE_PROMPT_PENDING") throw error
        const failure = new Error(`OpenCode async prompt API failed for session ${sessionID}: ${error?.message || String(error)}`)
        failure.code = "OPENCODE_PROMPT_FAILED"
        failure.cause = error
        throw failure
      }
    },
  }
}
