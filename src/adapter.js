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

async function withTimeout(operation, timeoutMs, endpoint, sessionID) {
  const limit = Number(timeoutMs)
  if (!Number.isFinite(limit) || limit <= 0) return operation()
  let timer
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
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

export function createOpenCodeAdapter(client, { timeoutMs = 30_000 } = {}) {
  return {
    async messages(sessionID) {
      try {
        const data = unwrapData(await withTimeout(
          () => client.session.messages({ path: { id: sessionID } }),
          timeoutMs,
          "messages",
          sessionID,
        ))
        return requireArray(data, "messages", sessionID)
      } catch (error) {
        if (error?.code === "OPENCODE_MESSAGES_FAILED") throw error
        const failure = new Error(`OpenCode messages API failed for session ${sessionID}: ${error?.message || String(error)}`)
        failure.code = "OPENCODE_MESSAGES_FAILED"
        failure.cause = error
        throw failure
      }
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
      try {
        const response = await withTimeout(
          () => client.session.prompt({
            path: { id: sessionID },
            body: { parts: [{ type: "text", text, synthetic: true }] },
          }),
          timeoutMs,
          "prompt",
          sessionID,
        )
        return requirePrompt(unwrapData(response), sessionID)
      } catch (error) {
        if (error?.code === "OPENCODE_PROMPT_FAILED") throw error
        const failure = new Error(`OpenCode prompt API failed for session ${sessionID}: ${error?.message || String(error)}`)
        failure.code = "OPENCODE_PROMPT_FAILED"
        failure.cause = error
        throw failure
      }
    },
  }
}
