/** @jsxImportSource @opentui/solid */
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createTargetObserver, indicatorView, readIndicatorState, resolveIndicatorStateDir } from "./tui-state.js"

const id = "opencode-target-tui"

function TargetIndicator(props: { api: TuiPluginApi; stateDir: string }) {
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
      needsInput: props.api.state.session.permission(id).length > 0 || props.api.state.session.question(id).length > 0,
    }
  })
  const current = () => !disposed() && snapshot().sessionID === sessionID() ? snapshot() : null
  const animations = () => props.api.kv.get<boolean>("animations_enabled", true) !== false
  const view = createMemo(() => indicatorView(current(), activity(), {
    animations: animations(),
    frame: frame(),
    width: Math.max(1, dimensions().width - 2),
  }))
  const interval = createMemo(() => view()?.intervalMs ?? 0)

  createEffect(() => {
    const delay = interval()
    if (!delay) return
    const timer = setInterval(() => setFrame((value) => (value + 1) % 10), delay)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <Show when={view()}>
      {(value) => (
        <box paddingLeft={1} paddingRight={1} height={1} flexShrink={0}>
          <text fg={theme()[value().color]} wrapMode="none">{value().text}</text>
        </box>
      )}
    </Show>
  )
}

const tui: TuiPlugin = async (api, options) => {
  const stateDir = resolveIndicatorStateDir(options)
  api.slots.register({
    order: 50,
    slots: {
      app_bottom() {
        return <TargetIndicator api={api} stateDir={stateDir} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = { id, tui }
export default plugin
