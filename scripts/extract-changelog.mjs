import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const version = process.argv[2] ?? JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version
const output = process.argv[3]

const changelog = await readFile(path.join(root, "CHANGELOG.md"), "utf8")
const lines = changelog.split(/\r?\n/)
const header = `## [${version}]`
const start = lines.findIndex((line) => line.startsWith(header))
if (start === -1) {
  console.error(`CHANGELOG.md has no section for ${version}`)
  process.exit(1)
}
let end = lines.findIndex((line, index) => index > start && /^## \[/.test(line))
if (end === -1) end = lines.length
const body = lines.slice(start, end).join("\n").trim()
if (!body) {
  console.error(`CHANGELOG.md section for ${version} is empty`)
  process.exit(1)
}

if (output) {
  await writeFile(output, body + "\n")
  console.log(`wrote ${output}`)
} else {
  process.stdout.write(body + "\n")
}
