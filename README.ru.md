# OpenCode Target

[English](README.md) · Русский

[Релизы](https://github.com/demyanovvvv/opencode-target/releases) · [История изменений](CHANGELOG.md)

Последний релиз: **v0.5.0**

**Постоянные проверяемые многошаговые цели для OpenCode.**

OpenCode Target — плагин для OpenCode, который сохраняет цель отдельно от истории диалога,
продолжает работу между физическими ходами модели, учитывает токены и время, выполняет проверки и
останавливает бесконечные циклы.

## Возможности

- постоянное состояние Target с отдельным lifecycle;
- автоматическое продолжение после `session.idle`;
- бюджеты токенов, лимиты ходов и времени;
- проверка требований и evidence перед завершением;
- защита от устаревших асинхронных записей;
- учёт root- и descendant-сессий;
- circuit breakers для повторных ошибок и отсутствия прогресса;
- анимированный индикатор Target в TUI OpenCode;
- автоматическая установка обоих плагинов одной командой.

Основная команда:

```text
/target <цель>
```

Короткий алиас:

```text
/t <цель>
```

## Установка

Выберите удобный язык установщика:

- [English installation](README.md#installation)
- русская установка — инструкции ниже

Требуется Node.js 22 или новее. Скачайте и распакуйте [архив релиза v0.5.0](https://github.com/demyanovvvv/opencode-target/releases/tag/v0.5.0), затем выполните установщик из его каталога.

### Linux/macOS

```sh
sh install.sh
```

Установщик выводит сообщения на английском. Для русских сообщений используйте:

```sh
sh install.ru.sh
```

### Windows PowerShell

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Русская версия PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ru.ps1
```

Установщик автоматически:

1. копирует серверный плагин в `~/.config/opencode/plugins/target.js`;
2. копирует TUI-плагин в `~/.config/opencode/tui-plugins/target.js`;
3. создаёт или обновляет `tui.json`/`tui.jsonc`;
4. добавляет TUI-плагин без дубликатов;
5. сохраняет существующие настройки и комментарии JSONC;
6. повторно включает `opencode-target-tui`, если он был отключён.

Для Windows используется эквивалентный каталог `%USERPROFILE%\.config\opencode`.
После установки перезапустите OpenCode и создайте новую сессию.

Установщик не требует `npm install`: JSONC-helper входит в release archive и запускается на Node.js.

### Переменные окружения

```sh
OPENCODE_CONFIG_DIR=/custom/opencode sh install.sh
OPENCODE_TUI_CONFIG=/custom/tui.jsonc sh install.sh
```

`OPENCODE_CONFIG_DIR` меняет каталог конфигурации. `OPENCODE_TUI_CONFIG` указывает конкретный
TUI-конфиг. Повреждённый конфиг не перезаписывается — установщик завершается с ошибкой.

### Установка из исходников вручную

Скопируйте:

```text
dist/target.js      → ~/.config/opencode/plugins/target.js
dist/target-tui.js  → ~/.config/opencode/tui-plugins/target.js
```

И добавьте в `tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["./tui-plugins/target.js"]
}
```

## TUI-индикатор

Индикатор отображается под строкой ввода и следует за текущей сессией.

| Состояние | Отображение |
|---|---|
| Работа модели | Анимированный спиннер `working` |
| Target активен, сессия ожидает | `waiting` |
| OpenCode повторяет запрос | `retrying` |
| Нужен permission или ответ на вопрос | `needs input` |
| Приостановлен | `paused` |
| Заблокирован | `blocked` |
| Исчерпан бюджет | `budget limit` |
| Достигнут runtime/provider limit | `usage limit` |
| Завершён | `complete` |
| State-файл недоступен | `unavailable` |

Индикатор только читает локальный state-файл и не меняет lifecycle Target. При отключённых
анимациях OpenCode значок становится статичным. В узком терминале значения токенов скрываются
первыми.

## Команды

```text
/target <цель>                         Создать новый активный Target
/target status                         Показать состояние
/target doctor                         Проверить state и API OpenCode
/target edit <новая цель>              Изменить цель без смены lifecycle
/target pause [причина]                Приостановить Target
/target resume                         Возобновить Target
/target budget                         Показать бюджет
/target budget 250000                  Установить бюджет
/target budget off                     Убрать бюджет
/target clear                         Очистить сохранённое состояние
/target help                          Показать справку
```

Завершённый Target терминален. Незавершённую цель нельзя заменять новой без предварительного
завершения или очистки. Новая цель получает собственный `target_id`.

## Lifecycle

```text
active → paused → active
active → blocked
active → usage_limited
active → budget_limited
active → complete
```

Модель может завершить физический ход, но не может молча завершить активный Target. Переходы
`pause`, `resume`, `clear` и изменение бюджета принадлежат пользовательским командам. Завершение,
semantic blocked и evidence-аудит выполняются моделью через Target tools. Runtime сам применяет
лимиты использования и бюджета.

## Хранилище

По умолчанию:

- Linux/macOS: `~/.local/state/opencode-target/`;
- Windows: `%LOCALAPPDATA%\opencode-target\`.

Путь можно изменить через `OPENCODE_TARGET_STATE_DIR` или опцию `state_dir`. TUI должен видеть тот
же каталог, если серверный плагин использует явный `state_dir`.

## Конфигурация сервера

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "opencode-target",
      {
        "max_target_token_budget": 200000,
        "auto_continue": true,
        "min_continue_interval_ms": 250,
        "verification": [
          { "id": "tests", "command": "npm test", "requirementID": "tests" }
        ]
      }
    ]
  ]
}
```

## Документация

- [Английский README](README.md)
- [Операционный runbook](docs/operations.md)
- [Архитектура](docs/architecture.md)
- [Формат state](docs/state-format.md)
- [Совместимость](docs/compatibility.md)
- [Безопасность](docs/security.md)
- [Релизный checklist](docs/release.md)
- [История изменений](CHANGELOG.md)

Полное описание model tools и plugin options находится в [английском README](README.md).

## Проверка для разработчиков

```sh
npm install
npm run check
npm run release:check
```

TUI smoke test использует настоящий OpenTUI renderer и проверяет анимацию, все состояния, смену
сессий, узкий терминал, очистку state и остановку таймеров.
