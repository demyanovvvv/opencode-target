$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Dest = Join-Path $HOME ".config\opencode\plugins"
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Copy-Item -Force (Join-Path $Root "dist\target.js") (Join-Path $Dest "target.js")
Write-Host "Installed OpenCode Target to $(Join-Path $Dest 'target.js')"
Write-Host "Restart OpenCode and start a new session."
