import { normalizeRetryPolicy } from "./core.js"

const DEFAULT_COMMAND = "target"
const DEFAULT_ALIAS = "t"

function integerOption(options, name, fallback, minimum) {
  const raw = options?.[name]
  if (raw === undefined || raw === null || raw === "") return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}`)
  }
  return value
}

function normalizeVerificationOptions(value) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error("verification must be an array")
  return value.map((item, index) => {
    const id = String(item?.id || `verification-${index + 1}`).trim()
    const command = String(item?.command || "").trim()
    if (!id || !command) throw new Error("verification entries require non-empty id and command")
    return {
      id,
      command,
      requirementID: item?.requirementID == null ? null : String(item.requirementID).trim(),
      retry: normalizeRetryPolicy(item?.retry),
    }
  })
}

export function normalizePluginOptions(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("Target plugin options must be an object")
  }
  const commandName = String(options.command_name ?? DEFAULT_COMMAND).trim()
  if (!commandName || /\s/.test(commandName)) throw new Error("command_name must be a non-empty command without whitespace")
  const alias = options.alias === false ? false : String(options.alias ?? DEFAULT_ALIAS).trim()
  if (alias !== false && (!alias || /\s/.test(alias))) throw new Error("alias must be false or a non-empty command without whitespace")
  if (options.auto_continue !== undefined && typeof options.auto_continue !== "boolean") {
    throw new Error("auto_continue must be a boolean")
  }
  if (options.exec_tool_names !== undefined && (
    !Array.isArray(options.exec_tool_names) ||
    options.exec_tool_names.some((name) => typeof name !== "string" || !name.trim())
  )) {
    throw new Error("exec_tool_names must be an array of non-empty strings")
  }
  const maxBudget = integerOption(options, "max_target_token_budget", null, 1)
  return Object.freeze({
    ...options,
    state_dir: options.state_dir == null ? null : String(options.state_dir),
    worktree: options.worktree == null ? null : String(options.worktree),
    command_name: commandName,
    alias,
    auto_continue: options.auto_continue ?? true,
    host_api_timeout_ms: integerOption(options, "host_api_timeout_ms", 30_000, 1),
    max_target_token_budget: maxBudget,
    min_continue_interval_ms: integerOption(options, "min_continue_interval_ms", 250, 0),
    failed_exec_threshold: integerOption(options, "failed_exec_threshold", 3, 1),
    empty_auto_threshold: integerOption(options, "empty_auto_threshold", 3, 1),
    descendant_max_depth: integerOption(options, "descendant_max_depth", 6, 0),
    descendant_max_sessions: integerOption(options, "descendant_max_sessions", 96, 1),
    scheduler_lease_ms: integerOption(options, "scheduler_lease_ms", 30_000, 1_000),
    continuation_watchdog_ms: integerOption(options, "continuation_watchdog_ms", 60_000, 1_000),
    max_automatic_turns: integerOption(options, "max_automatic_turns", null, 1),
    max_active_seconds: integerOption(options, "max_active_seconds", null, 1),
    max_no_progress_turns: integerOption(options, "max_no_progress_turns", null, 1),
    verification: normalizeVerificationOptions(options.verification),
    accounting_retry: normalizeRetryPolicy(options.accounting_retry ?? {
      maxAttempts: 3,
      baseDelayMs: 500,
      maxDelayMs: 5000,
    }),
    exec_tool_names: options.exec_tool_names?.map((name) => name.trim()),
  })
}
