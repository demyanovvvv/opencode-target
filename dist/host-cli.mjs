import path from "node:path"
import { withHostLock } from "./host-components.mjs"
import { installCoordinatedHostLocked } from "./host-runtime.mjs"

const value = (name) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1] }
const configDir = value("--config-dir")
if (!configDir) throw new Error("--config-dir is required")
await withHostLock(path.resolve(configDir), () => installCoordinatedHostLocked(path.resolve(configDir), value("--upstream")))
