import { readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const TARGET_STATUSES = ["active", "paused", "blocked", "usage_limited", "budget_limited", "complete"]

function defaultStateDir(env = process.env, platform = process.platform) {
  if (env.OPENCODE_TARGET_STATE_DIR) return path.resolve(env.OPENCODE_TARGET_STATE_DIR)
  if (platform === "win32") return path.join(env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "opencode-target")
  return path.join(env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "opencode-target")
}

function targetPath(stateDir, sessionID) {
  return path.join(stateDir, "targets", `${Buffer.from(String(sessionID)).toString("base64url")}.json`)
}

export function resolveIndicatorStateDir(options = {}) {
  return options.state_dir ? path.resolve(String(options.state_dir)) : defaultStateDir()
}

// Deliberately avoid readTarget/TargetStore: an observer must never quarantine or write state.
export async function readIndicatorState(stateDir, sessionID, { signal } = {}) {
  try {
    const target = JSON.parse(await readFile(targetPath(stateDir, sessionID), { encoding: "utf8", signal }))
    if (!target || ![2, 3].includes(target.version) || target.sessionID !== sessionID ||
        typeof target.targetID !== "string" || !target.targetID || !TARGET_STATUSES.includes(target.status) ||
        (target.tokensUsed != null && (!Number.isSafeInteger(target.tokensUsed) || target.tokensUsed < 0)) ||
        (target.tokenBudget != null && (!Number.isSafeInteger(target.tokenBudget) || target.tokenBudget <= 0))) {
      return { kind: "unavailable" }
    }
    return { kind: "target", target: {
      targetID: target.targetID,
      status: target.status,
      tokensUsed: target.tokensUsed ?? 0,
      tokenBudget: target.tokenBudget ?? null,
    } }
  } catch (error) {
    return { kind: error?.code === "ENOENT" ? "missing" : "unavailable" }
  }
}

const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const states = {
  working: { label: "working", icon: "●", color: "accent", intervalMs: 80 },
  waiting: { label: "waiting", icon: "⋯", color: "textMuted", intervalMs: 400 },
  retrying: { label: "retrying", icon: "↻", color: "warning", intervalMs: 400 },
  input: { label: "needs input", icon: "?", color: "warning" },
  paused: { label: "paused", icon: "Ⅱ", color: "warning" },
  blocked: { label: "blocked", icon: "!", color: "error" },
  budget_limited: { label: "budget limit", icon: "!", color: "warning" },
  usage_limited: { label: "usage limit", icon: "!", color: "warning" },
  complete: { label: "complete", icon: "✓", color: "success" },
  unavailable: { label: "unavailable", icon: "?", color: "textMuted" },
}

function compactTokens(value) {
  if (value < 1000) return String(value)
  const unit = value >= 1_000_000 ? 1_000_000 : 1000
  return `${Number((value / unit).toFixed(1))}${unit === 1000 ? "k" : "M"}`
}

export function indicatorView(snapshot, activity = {}, { animations = true, frame = 0, width = 80 } = {}) {
  if (!snapshot || snapshot.kind === "missing" || snapshot.kind === "loading") return null
  const target = snapshot.kind === "target" ? snapshot.target : null
  let state = target?.status ?? "unavailable"
  if (state === "active") {
    state = activity.needsInput ? "input" : activity.type === "busy" ? "working" : activity.type === "retry" ? "retrying" : "waiting"
  }
  const display = states[state] ?? states.unavailable
  const intervalMs = animations ? display.intervalMs ?? 0 : 0
  const icon = intervalMs ? frames[frame % frames.length] : display.icon
  const base = `${icon} Target · ${display.label}`
  const budget = target
    ? target.tokenBudget == null ? `${compactTokens(target.tokensUsed)} tokens` : `${compactTokens(target.tokensUsed)} / ${compactTokens(target.tokenBudget)}`
    : null
  const full = budget ? `${base} · ${budget}` : base
  const text = full.length <= width ? full : base.length <= width ? base : `${icon} ${display.label}`
  const clipped = text.length <= width ? text : width <= 1 ? icon.slice(0, width) : `${text.slice(0, width - 1)}…`
  return { ...display, icon, intervalMs, text: clipped }
}

export function createTargetObserver({ read, onChange, timers = globalThis, pollMs = 500 }) {
  let sessionID = null
  let controller = null
  let timer = null
  let disposed = false

  function cancel() {
    controller?.abort()
    if (timer !== null) timers.clearTimeout(timer)
    timer = null
  }

  async function poll(id, current) {
    let result
    try {
      result = await read(id, { signal: current.signal })
    } catch {
      result = { kind: "unavailable" }
    }
    if (disposed || current.signal.aborted || controller !== current) return
    onChange({ ...result, sessionID: id })
    timer = timers.setTimeout(() => {
      timer = null
      return poll(id, current)
    }, pollMs)
    timer?.unref?.()
  }

  return {
    setSession(id) {
      if (disposed || id === sessionID) return
      cancel()
      sessionID = id
      onChange({ kind: id ? "loading" : "missing", sessionID: id })
      if (!id) return
      controller = new AbortController()
      void poll(id, controller)
    },
    dispose() {
      disposed = true
      cancel()
    },
  }
}
