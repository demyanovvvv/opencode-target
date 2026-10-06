param([switch]$Uninstall)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Config = if ($env:OPENCODE_CONFIG_DIR) { $env:OPENCODE_CONFIG_DIR } elseif ($env:XDG_CONFIG_HOME) { Join-Path $env:XDG_CONFIG_HOME "opencode" } else { Join-Path $HOME ".config\opencode" }
if ($Uninstall) {
  & node (Join-Path $Root "dist\install-config.mjs") --config-dir $Config --uninstall
  exit $LASTEXITCODE
}
$Dest = Join-Path $Config "plugins"
$TuiDest = Join-Path $Config "tui-plugins"
$Action = if ((Test-Path (Join-Path $Dest "target.js")) -or (Test-Path (Join-Path $TuiDest "target.js"))) { "Updated" } else { "Installed" }
$ConfigTool = Join-Path $Root "dist\install-config.mjs"
& node $ConfigTool --config-dir $Config --install-files
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "$Action OpenCode Target to $(Join-Path $Dest 'target.js')"
Write-Host "$Action Target indicator to $(Join-Path $TuiDest 'target.js')"
Write-Host "Target TUI indicator was registered automatically in tui.json/tui.jsonc."
Write-Host "Restart OpenCode and start a new session."
