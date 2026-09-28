// OpenCode Target TUI — generated from src/tui.tsx and src/tui-state.js. Do not edit.

// src/tui.tsx
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
      tokenBudget: target.tokenBudget ?? null
    } };
  } catch (error) {
    return { kind: error?.code === "ENOENT" ? "missing" : "unavailable" };
  }
}
var frames = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
var states = {
  working: { label: "working", icon: "\u25CF", color: "accent", intervalMs: 80 },
  waiting: { label: "waiting", icon: "\u22EF", color: "textMuted", intervalMs: 400 },
  retrying: { label: "retrying", icon: "\u21BB", color: "warning", intervalMs: 400 },
  input: { label: "needs input", icon: "?", color: "warning" },
  paused: { label: "paused", icon: "\u2161", color: "warning" },
  blocked: { label: "blocked", icon: "!", color: "error" },
  budget_limited: { label: "budget limit", icon: "!", color: "warning" },
  usage_limited: { label: "usage limit", icon: "!", color: "warning" },
  complete: { label: "complete", icon: "\u2713", color: "success" },
  unavailable: { label: "unavailable", icon: "?", color: "textMuted" }
};
function compactTokens(value) {
  if (value < 1e3) return String(value);
  const unit = value >= 1e6 ? 1e6 : 1e3;
  return `${Number((value / unit).toFixed(1))}${unit === 1e3 ? "k" : "M"}`;
}
function indicatorView(snapshot, activity = {}, { animations = true, frame = 0, width = 80 } = {}) {
  if (!snapshot || snapshot.kind === "missing" || snapshot.kind === "loading") return null;
  const target = snapshot.kind === "target" ? snapshot.target : null;
  let state = target?.status ?? "unavailable";
  if (state === "active") {
    state = activity.needsInput ? "input" : activity.type === "busy" ? "working" : activity.type === "retry" ? "retrying" : "waiting";
  }
  const display = states[state] ?? states.unavailable;
  const intervalMs = animations ? display.intervalMs ?? 0 : 0;
  const icon = intervalMs ? frames[frame % frames.length] : display.icon;
  const base = `${icon} Target \xB7 ${display.label}`;
  const budget = target ? target.tokenBudget == null ? `${compactTokens(target.tokensUsed)} tokens` : `${compactTokens(target.tokensUsed)} / ${compactTokens(target.tokenBudget)}` : null;
  const full = budget ? `${base} \xB7 ${budget}` : base;
  const text = full.length <= width ? full : base.length <= width ? base : `${icon} ${display.label}`;
  const clipped = text.length <= width ? text : width <= 1 ? icon.slice(0, width) : `${text.slice(0, width - 1)}\u2026`;
  return { ...display, icon, intervalMs, text: clipped };
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
      needsInput: props.api.state.session.permission(id2).length > 0 || props.api.state.session.question(id2).length > 0
    };
  });
  const current = () => !disposed() && snapshot().sessionID === sessionID() ? snapshot() : null;
  const animations = () => props.api.kv.get("animations_enabled", true) !== false;
  const view = createMemo(() => indicatorView(current(), activity(), {
    animations: animations(),
    frame: frame(),
    width: Math.max(1, dimensions().width - 2)
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
          stateDir
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
