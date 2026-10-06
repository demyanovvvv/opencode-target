/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createTargetObserver, indicatorView, readIndicatorState, resolveIndicatorStateDir } from "./tui-state.js"

const id = "opencode-target-tui"

function TargetIndicator(props: { api: TuiPluginApi; stateDir: string; language: "en" | "ru"; width?: number }) {
  const dimensions = useTerminalDimensions()
  const theme = () => props.api.theme.current
  const [snapshot, setSnapshot] = createSignal({ kind: "missing", sessionID: null })
  const [disposed, setDisposed] = createSignal(false)
  const [frame, setFrame] = createSignal(0)
  const sessionID = createMemo(() => {
    const route = props.api.route.current
    return route.name === "session" && typeof route.params?.sessionID === "string" ? route.params.sessionID : null
  })
  const observer = createTargetObserver({
    read: (sessionID, context) => readIndicatorState(props.stateDir, sessionID, context),
    onChange: setSnapshot,
  })
  const dispose = () => {
    observer.dispose()
    setDisposed(true)
  }
  const unregister = props.api.lifecycle.onDispose(dispose)
  onCleanup(() => { unregister(); dispose() })
  createEffect(() => observer.setSession(sessionID()))

  const activity = createMemo(() => {
    const id = sessionID()
    if (!id) return {}
    return {
      type: props.api.state.session.status(id)?.type,
      permission: props.api.state.session.permission(id).length > 0,
      needsInput: props.api.state.session.permission(id).length > 0 || props.api.state.session.question(id).length > 0,
    }
  })
  const current = () => !disposed() && snapshot().sessionID === sessionID() ? snapshot() : null
  const animations = () => props.api.kv.get<boolean>("animations_enabled", true) !== false
  const view = createMemo(() => indicatorView(current(), activity(), {
    animations: animations(),
    frame: frame(),
    width: Math.max(0, Math.min(36, dimensions().width - 2, props.width ?? 36) - 2),
    language: props.language,
  }))
  const interval = createMemo(() => view()?.intervalMs ?? 0)

  createEffect(() => {
    const delay = interval()
    if (!delay) return
    const timer = setInterval(() => setFrame((value) => (value + 1) % 10), delay)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <box flexDirection="row" gap={1} height={view()?.text ? 1 : 0} flexShrink={0}>
      <Show when={view()}>
        {(value) => <><text fg={theme().textMuted}>│</text><text fg={theme()[value().color]} wrapMode="none">{value().text}</text></>}
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api, options) => {
  const stateDir = resolveIndicatorStateDir(options)
  api.slots.register<{ session_prompt_status: { session_id: string; width: number } }>({
    order: 50,
    slots: {
      session_prompt_status(_context, input) {
        return <TargetIndicator api={api} stateDir={stateDir} width={input.width} language={options?.language === "ru" ? "ru" : "en"} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = { id, tui }
export default plugin
