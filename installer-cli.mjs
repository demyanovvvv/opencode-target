import path from "node:path"
import os from "node:os"
import { createInterface } from "node:readline/promises"
import { fileURLToPath } from "node:url"
import { installTargetFiles } from "./install-config.mjs"

export async function runInstaller(args, root) {
  const ru = args.includes("--ru")
  const uninstall = args.includes("--uninstall")
  const value = (flag) => { const i = args.indexOf(flag); if (i < 0) return null; if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Missing value for ${flag}`); return args[i + 1] }
  const allowed = new Set(["--ru", "--uninstall", "--install-files", "--local", "--global", "--project-dir", "--config-dir", "--tui-config", "--state-dir"])
  for (let i = 0; i < args.length; i++) {
    if (!allowed.has(args[i])) throw new Error(`Unknown argument: ${args[i]}`)
    if (["--project-dir", "--config-dir", "--tui-config", "--state-dir"].includes(args[i])) { value(args[i]); i++ }
  }
  if (args.includes("--local") && args.includes("--global")) throw new Error("Choose one scope")
  let scope = args.includes("--local") ? "local" : args.includes("--global") || value("--config-dir") ? "global" : null
  let project = value("--project-dir")
  if (!scope) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const lines = rl[Symbol.asyncIterator]()
    const ask = async (prompt) => {
      process.stdout.write(prompt)
      const answer = await lines.next()
      if (answer.done) throw new Error(ru ? "Укажите --local или --global" : "Specify --local or --global")
      return answer.value.trim()
    }
    try {
      console.log(ru ? "1. Локально (для проекта)\n2. Глобально (для пользователя)" : "1. Local (project)\n2. Global (user)")
      const answer = await ask(ru ? "Выберите область [1/2]: " : "Choose scope [1/2]: ")
      if (!["1", "2"].includes(answer)) throw new Error(ru ? "Выберите 1 или 2" : "Choose 1 or 2")
      scope = answer === "1" ? "local" : "global"
      if (scope === "local" && !project) project = await ask(ru ? `Каталог проекта [${process.cwd()}]: ` : `Project directory [${process.cwd()}]: `) || process.cwd()
    } finally { rl.close() }
  }
  if (scope === "global" && project) throw new Error("--project-dir requires --local")
  if (scope === "local" && value("--config-dir")) throw new Error("--config-dir cannot be combined with --local")
  const configDir = scope === "local" ? path.resolve(project || process.cwd(), ".opencode") : path.resolve(value("--config-dir") || process.env.OPENCODE_CONFIG_DIR || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "opencode"))
  const tuiConfig = value("--tui-config") || (scope === "global" ? process.env.OPENCODE_TUI_CONFIG : null)
  console.log(`${scope}: ${configDir}`)
  const result = await installTargetFiles({ configDir, root, scope, tuiConfig, stateDir: value("--state-dir"), uninstall })
  if (uninstall) console.log(ru ? "OpenCode Target полностью удалён из выбранной области." : "Removed OpenCode Target completely from the selected scope.")
  else {
    console.log(`${ru ? result.previousVersion ? "Обновлён" : "Установлен" : result.previousVersion ? "Updated" : "Installed"} OpenCode Target: ${result.previousVersion ? result.previousVersion + " → " : ""}${result.version}`)
    console.log(ru ? "Перезапустите OpenCode и создайте новую сессию." : "Restart OpenCode and start a new session.")
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runInstaller(process.argv.slice(2), path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."))
}
