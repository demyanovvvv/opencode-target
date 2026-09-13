$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Dest = Join-Path $HOME ".config\opencode\plugins"
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Copy-Item -Force (Join-Path $Root "dist\mission.js") (Join-Path $Dest "mission.js")
Write-Host "Installed OpenCode Mission to $(Join-Path $Dest 'mission.js')"
Write-Host "Restart OpenCode and start a new session."
