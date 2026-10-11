# Repository metadata

## Short description

Use this description for the GitHub repository About field and package metadata:

> OpenCode plugin for persistent goals, automatic continuation, token budgets, and evidence-based completion checks.

Russian equivalent:

> Плагин OpenCode для сохранения целей, автоматического продолжения работы, бюджетов токенов и проверки завершения по доказательствам.

Completion checks describe the model's requirement/evidence audit and explicitly requested command
gates, not a guarantee of task completion. Automatic continuation applies only while a Target is active.

## GitHub Topics

Recommended topics, matching the package keywords:

```text
opencode
opencode-plugin
coding-agent
goal
target
persistent-state
automatic-continuation
token-budget
token-accounting
verification
tui
```

The primary discovery topics are `opencode`, `opencode-plugin`, and `coding-agent`.
`goal` and `target` identify the plugin's objective-oriented workflow and terminology.
The remaining topics describe persistent state, automatic continuation, token budgets and accounting,
completion verification, and the terminal indicator. `token-accounting` covers root/descendant usage,
cached-input subtraction, and incremental accounting, beyond simply setting a budget.

Omit `javascript`: it describes implementation rather than the plugin's purpose. Also omit
`ai-coding` and `ai-agents` as broad overlaps with `coding-agent`, and `goal-tracking` because it can
suggest a personal goal tracker and overlaps with `goal`. Avoid `autonomous` and `task-automation`:
Target continues an active model session within limits, rather than providing general automation.

Repository About/Topics are configured separately on GitHub;
editing package metadata does not update those remote fields.
