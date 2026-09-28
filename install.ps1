$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Config = if ($env:XDG_CONFIG_HOME) { Join-Path $env:XDG_CONFIG_HOME "opencode" } else { Join-Path $HOME ".config\opencode" }
$Dest = Join-Path $Config "plugins"
$TuiDest = Join-Path $Config "tui-plugins"
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
New-Item -ItemType Directory -Force -Path $TuiDest | Out-Null
Copy-Item -Force (Join-Path $Root "dist\target.js") (Join-Path $Dest "target.js")
Copy-Item -Force (Join-Path $Root "dist\target-tui.js") (Join-Path $TuiDest "target.js")
Write-Host "Installed OpenCode Target to $(Join-Path $Dest 'target.js')"
Write-Host "Installed Target indicator to $(Join-Path $TuiDest 'target.js')"
Write-Host 'Enable the indicator by adding "./tui-plugins/target.js" to the plugin array in tui.json next to tui-plugins/.'
Write-Host "Restart OpenCode and start a new session."
