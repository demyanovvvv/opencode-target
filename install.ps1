$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Config = if ($env:OPENCODE_CONFIG_DIR) { $env:OPENCODE_CONFIG_DIR } elseif ($env:XDG_CONFIG_HOME) { Join-Path $env:XDG_CONFIG_HOME "opencode" } else { Join-Path $HOME ".config\opencode" }
$Dest = Join-Path $Config "plugins"
$TuiDest = Join-Path $Config "tui-plugins"
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
New-Item -ItemType Directory -Force -Path $TuiDest | Out-Null
Copy-Item -Force (Join-Path $Root "dist\target.js") (Join-Path $Dest "target.js")
Copy-Item -Force (Join-Path $Root "dist\target-tui.js") (Join-Path $TuiDest "target.js")
$ConfigTool = Join-Path $Root "dist\install-config.mjs"
& node $ConfigTool --config-dir $Config
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Installed OpenCode Target to $(Join-Path $Dest 'target.js')"
Write-Host "Installed Target indicator to $(Join-Path $TuiDest 'target.js')"
Write-Host "Target TUI indicator was registered automatically in tui.json/tui.jsonc."
Write-Host "Restart OpenCode and start a new session."
