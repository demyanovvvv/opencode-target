import path from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const { readFile, copyFile } = await import("node:fs/promises")
const version = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version
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
  define: { TARGET_PACKAGE_VERSION: JSON.stringify(version) },
  banner: { js: "// OpenCode Target installer helper — generated from install-config.mjs. Do not edit." },
})
console.log("Built dist/install-config.mjs")
for (const name of ["host-components.mjs", "host-build.mjs", "host-runtime.mjs", "host-cli.mjs"]) await copyFile(path.join(root, name), path.join(root, "dist", name))
await build({
  absWorkingDir: root, entryPoints: ["host-components.mjs"], outfile: "dist/host-components.mjs",
  bundle: true, format: "esm", platform: "node", target: "node22", mainFields: ["module", "main"], external: ["node:*"],
})
