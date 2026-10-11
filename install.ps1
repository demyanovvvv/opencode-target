param([switch]$Uninstall, [switch]$Local, [switch]$Global, [string]$ProjectDir, [string]$ConfigDir, [string]$StateDir, [string]$TuiConfig, [switch]$Russian)
$ErrorActionPreference = "Stop"
if ($Russian) { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new() }
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Local -and -not $Global -and -not $ConfigDir) {
  if ($Russian) { Write-Host "1. Локально (для проекта)`n2. Глобально (для пользователя)" } else { Write-Host "1. Local (project)`n2. Global (user)" }
  $Prompt = if ($Russian) { "Выберите область [1/2]" } else { "Choose scope [1/2]" }
  $Choice = if ([Console]::IsInputRedirected) { [Console]::ReadLine() } else { Read-Host $Prompt }
  if ($Choice -eq "1") {
    $Local = $true
    if (-not $ProjectDir) {
      $Prompt = if ($Russian) { "Каталог проекта [$PWD]" } else { "Project directory [$PWD]" }
      $ProjectDir = if ([Console]::IsInputRedirected) { [Console]::ReadLine() } else { Read-Host $Prompt }
      if (-not $ProjectDir) { $ProjectDir = "$PWD" }
    }
  } elseif ($Choice -eq "2") { $Global = $true } else { throw "Choose 1 or 2 / Выберите 1 или 2" }
}
$Arguments = @("--install-files")
if ($Uninstall) { $Arguments += "--uninstall" }
if ($Local) { $Arguments += "--local" }
if ($Global) { $Arguments += "--global" }
if ($Russian) { $Arguments += "--ru"; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new() }
if ($ProjectDir) { $Arguments += @("--project-dir", $ProjectDir) }
if ($ConfigDir) { $Arguments += @("--config-dir", $ConfigDir) }
if ($StateDir) { $Arguments += @("--state-dir", $StateDir) }
if ($TuiConfig) { $Arguments += @("--tui-config", $TuiConfig) }
& node (Join-Path $Root "dist\install-config.mjs") @Arguments
exit $LASTEXITCODE
