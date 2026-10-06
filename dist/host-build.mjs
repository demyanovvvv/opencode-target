import { readFile, writeFile, mkdir, realpath, access } from "node:fs/promises"
import path from "node:path"
import { spawn } from "node:child_process"
import { hostVersion, hostSemver } from "./host-components.mjs"

function replace(source, anchor, replacement) {
  if (!source.includes(anchor)) throw new Error(`Unsupported OpenCode seam: ${anchor}`)
  return source.replace(anchor, replacement)
}

export function transformHostFile(kind, source, components, coordinator = "", configDir = "") {
  if (kind === "registry" && components.patchline) {
    source = replace(source, "if (tool.id === ApplyPatchTool.id) return usePatch", "if (tool.id === ApplyPatchTool.id) return true")
    source = replace(source, "if (tool.id === EditTool.id || tool.id === WriteTool.id) return !usePatch", "if (tool.id === EditTool.id || tool.id === WriteTool.id) return true")
  }
  if (kind === "session" && components.patchline) {
    const start = source.indexOf("function ToolPart(props:")
    const end = source.indexOf("type ToolProps =", start)
    if (start < 0 || end < 0) throw new Error("Unsupported OpenCode ToolPart")
    let block = source.slice(start, end)
    block = replace(block, "  const ctx = use()", "  const ctx = use()\n  const pluginRuntime = usePluginRuntime()")
    block = replace(block, "<Switch>", '<pluginRuntime.Slot name={`tool_${props.part.tool}`} mode="replace" part={props.part} message={props.message} last={props.last}>\n      <Switch>')
    block = replace(block, "</Switch>", "</Switch>\n      </pluginRuntime.Slot>")
    source = source.slice(0, start) + block + source.slice(end)
    if (!source.includes('import { usePluginRuntime }')) source = 'import { usePluginRuntime } from "../../plugin/runtime"\n' + source
  }
  if (kind === "installation") {
    source = replace(source, "semver.major(current)", 'semver.major(current.split("+")[0]!)')
    source = replace(source, "semver.minor(current)", 'semver.minor(current.split("+")[0]!)')
    if (Object.keys(components).length) {
      const anchor = 'upgrade: Effect.fn("Installation.upgrade")(function* (m: Method, target: string) {'
      source = replace(source, anchor, `${anchor}\n        // Shared component host upgrade; installer-independent.\n        const coordinated = yield* run(["node", ${JSON.stringify(coordinator)}, "--config-dir", ${JSON.stringify(configDir)}, "--upstream", target])\n        if (coordinated.code !== 0) return yield* Effect.fail(new UpgradeFailedError({ stderr: coordinated.stderr || coordinated.stdout }))\n        return`)
    }
  }
  if (kind === "compatibility") source = replace(source, "export async function checkPluginCompatibility(target: string, opencodeVersion: string, pkg?: PluginPackage) {", 'export async function checkPluginCompatibility(target: string, opencodeVersion: string, pkg?: PluginPackage) {\n  const [base, ...metadata] = opencodeVersion.split("+")\n  opencodeVersion = base + (metadata.length ? `+${metadata.join(".")}` : "")')
  return source
}

export async function runHostCommand(command, args, cwd, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
    let output = ""
    child.stdout.on("data", (data) => { output += data; if (process.env.HOST_BUILD_VERBOSE) process.stderr.write(data) })
    child.stderr.on("data", (data) => { output += data; if (process.env.HOST_BUILD_VERBOSE) process.stderr.write(data) })
    child.on("error", reject)
    child.on("close", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(`${command} ${args.join(" ")} failed (${code}): ${output}`)))
  })
}

// The checkout is private to this coordinator; never reset a user's checkout.
export async function buildHost({ upstream, components, configDir, coordinator }) {
  components = Object.fromEntries(Object.entries(components).filter(([, component]) => component.requiresHost !== false))
  hostVersion(upstream, components)
  const host = path.join(configDir, "host-build", upstream)
  await mkdir(path.dirname(host), { recursive: true })
  try { await access(path.join(host, ".git")) } catch {
    await runHostCommand("git", ["clone", "--depth", "1", "--branch", `v${upstream}`, "https://github.com/anomalyco/opencode.git", host], configDir)
  }
  if (await runHostCommand("git", ["describe", "--tags", "--exact-match", "HEAD"], host) !== `v${upstream}`) throw new Error("Host checkout version mismatch")
  const seams = {
    prompt: "packages/tui/src/component/prompt/index.tsx",
    session: "packages/tui/src/routes/session/index.tsx",
    registry: "packages/opencode/src/tool/registry.ts",
    installation: "packages/opencode/src/installation/index.ts",
    compatibility: "packages/opencode/src/plugin/shared.ts",
  }
  for (const [kind, file] of Object.entries(seams)) {
    const source = await runHostCommand("git", ["show", `HEAD:${file}`], host)
    await writeFile(path.join(host, file), transformHostFile(kind, source.replaceAll("\r\n", "\n"), components, coordinator, configDir) + "\n")
  }
  // Build/package metadata gets valid SemVer; the runtime constant keeps the display contract.
  const script = "packages/script/src/index.ts"
  const scriptSource = await runHostCommand("git", ["show", `HEAD:${script}`], host)
  await writeFile(path.join(host, script), scriptSource)
  const build = "packages/opencode/script/build.ts"
  const buildSource = await runHostCommand("git", ["show", `HEAD:${build}`], host)
  const versionAnchor = "OPENCODE_VERSION: `'${Script.version}'`"
  await writeFile(path.join(host, build), replace(buildSource, versionAnchor, `OPENCODE_VERSION: ${JSON.stringify(JSON.stringify(hostVersion(upstream, components)))}`))
  // Materialize the complete store before native lifecycle scripts resolve peers.
  await runHostCommand("bun", ["install", "--frozen-lockfile", "--ignore-scripts"], host)
  await runHostCommand("bun", ["install", "--frozen-lockfile"], host)
  await runHostCommand("bun", ["run", "script/build.ts", "--single", "--skip-install", "--skip-embed-web-ui"], path.join(host, "packages/opencode"), { OPENCODE_VERSION: hostSemver(upstream, components), OPENCODE_CHANNEL: "latest" })
  const binary = path.join(host, "packages/opencode/dist", `opencode-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`, "bin", process.platform === "win32" ? "opencode.exe" : "opencode")
  await access(binary)
  return realpath(binary)
}
