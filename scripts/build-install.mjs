import path from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
await build({
  absWorkingDir: root,
  entryPoints: ["install-config.mjs"],
  outfile: "dist/install-config.mjs",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  mainFields: ["module", "main"],
  packages: "bundle",
  external: ["node:*"],
  banner: { js: "// OpenCode Target installer helper — generated from install-config.mjs. Do not edit." },
})
console.log("Built dist/install-config.mjs")
