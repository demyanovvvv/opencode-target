import path from "node:path"
import os from "node:os"
import { withHostLock, readComponents } from "../host-components.mjs"
import { buildHost, runHostCommand } from "../host-build.mjs"
import { resolveHostBinary, deployHostRuntime } from "../host-runtime.mjs"

const configDir = process.env.OPENCODE_CONFIG_DIR || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "opencode")
await withHostLock(configDir, async () => {
  const upstream = process.env.OPENCODE_UPSTREAM_VERSION || (await runHostCommand(await resolveHostBinary(), ["--version"], configDir)).split("+")[0]
  console.log(await buildHost({ upstream, components: await readComponents(configDir), configDir, coordinator: await deployHostRuntime(configDir) }))
})
