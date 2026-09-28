import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { transformAsync } from "@babel/core"
import solid from "babel-preset-solid"
import { build, transform } from "esbuild"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
await build({
  absWorkingDir: root,
  entryPoints: ["src/tui.tsx"],
  outfile: "dist/target-tui.js",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  packages: "external",
  banner: { js: "// OpenCode Target TUI — generated from src/tui.tsx and src/tui-state.js. Do not edit." },
  plugins: [{
    name: "solid",
    setup(builder) {
      builder.onLoad({ filter: /\.tsx$/ }, async ({ path: filename }) => {
        const source = await transform(await readFile(filename, "utf8"), { loader: "tsx", jsx: "preserve" })
        const result = await transformAsync(source.code, {
          filename, babelrc: false, configFile: false,
          presets: [[solid, { moduleName: "@opentui/solid", generate: "universal" }]],
        })
        return { contents: result.code, loader: "js" }
      })
    },
  }],
})
console.log("Built dist/target-tui.js")
