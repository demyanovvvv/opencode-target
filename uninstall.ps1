param([switch]$Local, [switch]$Global, [string]$ProjectDir, [string]$ConfigDir, [string]$StateDir, [string]$TuiConfig)
& (Join-Path $PSScriptRoot "install.ps1") @PSBoundParameters -Uninstall
exit $LASTEXITCODE
