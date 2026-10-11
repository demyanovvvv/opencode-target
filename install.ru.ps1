param([switch]$Uninstall, [switch]$Local, [switch]$Global, [string]$ProjectDir, [string]$ConfigDir, [string]$StateDir, [string]$TuiConfig)
& (Join-Path $PSScriptRoot "install.ps1") @PSBoundParameters -Russian
exit $LASTEXITCODE
