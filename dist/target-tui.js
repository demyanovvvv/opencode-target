// OpenCode Target TUI — generated from src/tui.tsx and src/tui-state.js. Do not edit.

// src/tui.tsx
import { memo as _$memo } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";

// src/tui-state.js
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
var TARGET_STATUSES = ["active", "paused", "blocked", "usage_limited", "budget_limited", "complete"];
function defaultStateDir(env = process.env, platform = process.platform) {
  if (env.OPENCODE_TARGET_STATE_DIR) return path.resolve(env.OPENCODE_TARGET_STATE_DIR);
  if (platform === "win32") return path.join(env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "opencode-target");
  return path.join(env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "opencode-target");
}
function targetPath(stateDir, sessionID) {
  return path.join(stateDir, "targets", `${Buffer.from(String(sessionID)).toString("base64url")}.json`);
}
function resolveIndicatorStateDir(options = {}) {
  return options.state_dir ? path.resolve(String(options.state_dir)) : defaultStateDir();
}
async function readIndicatorState(stateDir, sessionID, { signal } = {}) {
  try {
    const target = JSON.parse(await readFile(targetPath(stateDir, sessionID), { encoding: "utf8", signal }));
    if (!target || ![2, 3].includes(target.version) || target.sessionID !== sessionID || typeof target.targetID !== "string" || !target.targetID || !TARGET_STATUSES.includes(target.status) || target.tokensUsed != null && (!Number.isSafeInteger(target.tokensUsed) || target.tokensUsed < 0) || target.tokenBudget != null && (!Number.isSafeInteger(target.tokenBudget) || target.tokenBudget <= 0)) {
      return { kind: "unavailable" };
    }
    return { kind: "target", target: {
      targetID: target.targetID,
      status: target.status,
      tokensUsed: target.tokensUsed ?? 0,
      tokenBudget: target.tokenBudget ?? null,
      stopReason: target.stopReason ? String(target.stopReason) : null,
      lastError: target.lastError ? String(target.lastError) : null
    } };
  } catch (error) {
    return { kind: error?.code === "ENOENT" ? "missing" : "unavailable" };
  }
}
var frames = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
var states = {
  working: { label: "working", ru: "\u0420\u0430\u0431\u043E\u0442\u0430\u0435\u0442", icon: "\u25CF", color: "accent", intervalMs: 80 },
  waiting: { label: "waiting", ru: "\u041E\u0436\u0438\u0434\u0430\u043D\u0438\u0435", icon: "\u22EF", color: "textMuted", intervalMs: 400 },
  retrying: { label: "retrying", ru: "\u041F\u043E\u0432\u0442\u043E\u0440 \u0437\u0430\u043F\u0440\u043E\u0441\u0430", icon: "\u21BB", color: "warning", intervalMs: 400 },
  input: { label: "needs input", ru: "\u041D\u0443\u0436\u0435\u043D \u043E\u0442\u0432\u0435\u0442", icon: "?", color: "warning" },
  permission: { label: "needs input", ru: "\u041D\u0443\u0436\u043D\u043E \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043D\u0438\u0435", icon: "?", color: "warning" },
  paused: { label: "paused", ru: "\u041F\u0430\u0443\u0437\u0430", icon: "\u2161", color: "warning" },
  blocked: { label: "blocked", ru: "\u041E\u0448\u0438\u0431\u043A\u0430", icon: "!", color: "error" },
  budget_limited: { label: "budget limit", ru: "\u041B\u0438\u043C\u0438\u0442 \u0431\u044E\u0434\u0436\u0435\u0442\u0430", icon: "!", color: "warning" },
  usage_limited: { label: "usage limit", ru: "\u041B\u0438\u043C\u0438\u0442 \u043F\u0440\u043E\u0432\u0430\u0439\u0434\u0435\u0440\u0430", icon: "!", color: "warning" },
  complete: { label: "complete", ru: "\u0417\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u043E", icon: "\u2713", color: "success" },
  unavailable: { label: "unavailable", ru: "\u0421\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E", icon: "?", color: "textMuted" }
};
function compactTokens(value) {
  if (value < 1e3) return String(value);
  const unit = value >= 1e6 ? 1e6 : 1e3;
  return `${Number((value / unit).toFixed(1))}${unit === 1e3 ? "k" : "M"}`;
}
function cleanDetail(value) {
  return String(value || "").replace(/\u001b\[[0-9;]*m/g, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}
function indicatorView(snapshot, activity = {}, { animations = true, frame = 0, width = 80, language = "en" } = {}) {
  if (!snapshot || snapshot.kind === "missing" || snapshot.kind === "loading") return null;
  const target = snapshot.kind === "target" ? snapshot.target : null;
  let state = target?.status ?? "unavailable";
  if (state === "active") {
    state = activity.needsInput ? activity.permission ? "permission" : "input" : activity.type === "busy" ? "working" : activity.type === "retry" ? "retrying" : "waiting";
  }
  const display = states[state] ?? states.unavailable;
  const intervalMs = animations ? display.intervalMs ?? 0 : 0;
  const icon = intervalMs ? frames[frame % frames.length] : display.icon;
  const label = language === "ru" ? display.ru : display.label;
  const reason = cleanDetail(target?.stopReason || target?.lastError);
  const detail = state === "retrying" && activity.attempt ? language === "ru" ? `\u043F\u043E\u043F\u044B\u0442\u043A\u0430 ${activity.attempt}` : `attempt ${activity.attempt}` : state === "paused" ? ["/target resume", reason].filter(Boolean).join(" \xB7 ") : reason;
  const base = `${icon} Target \xB7 ${label}`;
  const budget = target ? target.tokenBudget == null ? `${compactTokens(target.tokensUsed)} tokens` : `${compactTokens(target.tokensUsed)} / ${compactTokens(target.tokenBudget)}` : null;
  const full = [base, detail, budget].filter(Boolean).join(" \xB7 ");
  const text = full.length <= width ? full : base.length <= width ? base : `${icon} ${label}`;
  const clipped = text.length <= width ? text : width <= 1 ? icon.slice(0, width) : `${text.slice(0, width - 1)}\u2026`;
  return { ...display, label, icon, intervalMs, text: clipped };
}
function createTargetObserver({ read, onChange, timers = globalThis, pollMs = 500 }) {
  let sessionID = null;
  let controller = null;
  let timer = null;
  let disposed = false;
  function cancel() {
    controller?.abort();
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  }
  async function poll(id2, current) {
    let result;
    try {
      result = await read(id2, { signal: current.signal });
    } catch {
      result = { kind: "unavailable" };
    }
    if (disposed || current.signal.aborted || controller !== current) return;
    onChange({ ...result, sessionID: id2 });
    timer = timers.setTimeout(() => {
      timer = null;
      return poll(id2, current);
    }, pollMs);
    timer?.unref?.();
  }
  return {
    setSession(id2) {
      if (disposed || id2 === sessionID) return;
      cancel();
      sessionID = id2;
      onChange({ kind: id2 ? "loading" : "missing", sessionID: id2 });
      if (!id2) return;
      controller = new AbortController();
      void poll(id2, controller);
    },
    dispose() {
      disposed = true;
      cancel();
    }
  };
}

// src/tui.tsx
var id = "opencode-target-tui";
function TargetIndicator(props) {
  const dimensions = useTerminalDimensions();
  const theme = () => props.api.theme.current;
  const [snapshot, setSnapshot] = createSignal({
    kind: "missing",
    sessionID: null
  });
  const [disposed, setDisposed] = createSignal(false);
  const [frame, setFrame] = createSignal(0);
  const sessionID = createMemo(() => {
    const route = props.api.route.current;
    return route.name === "session" && typeof route.params?.sessionID === "string" ? route.params.sessionID : null;
  });
  const observer = createTargetObserver({
    read: (sessionID2, context) => readIndicatorState(props.stateDir, sessionID2, context),
    onChange: setSnapshot
  });
  const dispose = () => {
    observer.dispose();
    setDisposed(true);
  };
  const unregister = props.api.lifecycle.onDispose(dispose);
  onCleanup(() => {
    unregister();
    dispose();
  });
  createEffect(() => observer.setSession(sessionID()));
  const activity = createMemo(() => {
    const id2 = sessionID();
    if (!id2) return {};
    return {
      type: props.api.state.session.status(id2)?.type,
      permission: props.api.state.session.permission(id2).length > 0,
      needsInput: props.api.state.session.permission(id2).length > 0 || props.api.state.session.question(id2).length > 0
    };
  });
  const current = () => !disposed() && snapshot().sessionID === sessionID() ? snapshot() : null;
  const animations = () => props.api.kv.get("animations_enabled", true) !== false;
  const view = createMemo(() => indicatorView(current(), activity(), {
    animations: animations(),
    frame: frame(),
    width: Math.max(1, dimensions().width - 2),
    language: props.language
  }));
  const interval = createMemo(() => view()?.intervalMs ?? 0);
  createEffect(() => {
    const delay = interval();
    if (!delay) return;
    const timer = setInterval(() => setFrame((value) => (value + 1) % 10), delay);
    onCleanup(() => clearInterval(timer));
  });
  return _$createComponent(Show, {
    get when() {
      return view();
    },
    children: (value) => (() => {
      var _el$ = _$createElement("box"), _el$2 = _$createElement("text");
      _$insertNode(_el$, _el$2);
      _$setProp(_el$, "paddingLeft", 1);
      _$setProp(_el$, "paddingRight", 1);
      _$setProp(_el$, "height", 1);
      _$setProp(_el$, "flexShrink", 0);
      _$setProp(_el$2, "wrapMode", "none");
      _$insert(_el$2, () => value().text);
      _$effect((_$p) => _$setProp(_el$2, "fg", theme()[value().color], _$p));
      return _el$;
    })()
  });
}
var tui = async (api, options) => {
  const stateDir = resolveIndicatorStateDir(options);
  api.slots.register({
    order: 50,
    slots: {
      app_bottom() {
        return _$createComponent(TargetIndicator, {
          api,
          stateDir,
          get language() {
            return options?.language === "ru" ? "ru" : "en";
          }
        });
      }
    }
  });
};
var plugin = {
  id,
  tui
};
var tui_default = plugin;
export {
  tui_default as default
};
