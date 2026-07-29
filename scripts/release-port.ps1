param(
  [Parameter(Mandatory = $true)]
  [int]$Port,

  [Parameter(Mandatory = $true)]
  [string]$Workspace
)

$ErrorActionPreference = 'Stop'
$resolvedWorkspace = (Resolve-Path -LiteralPath $Workspace).Path
$connections = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue

if (-not $connections) {
  exit 0
}

$ownerPids = $connections | Select-Object -ExpandProperty OwningProcess -Unique

foreach ($ownerPid in $ownerPids) {
  $currentPid = [int]$ownerPid
  $rootPid = $currentPid
  $ownerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $currentPid" -ErrorAction SilentlyContinue
  $isComfyForgeProcess = $ownerProcess -and (
    ([string]$ownerProcess.CommandLine).IndexOf($resolvedWorkspace, [StringComparison]::OrdinalIgnoreCase) -ge 0
  )

  if (-not $isComfyForgeProcess) {
    Write-Error "Le port $Port est utilise par un processus externe a ComfyForge (PID $ownerPid)."
    exit 1
  }

  while ($currentPid -gt 0) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $currentPid" -ErrorAction SilentlyContinue
    if (-not $process) {
      break
    }

    $commandLine = [string]$process.CommandLine
    if ($commandLine.IndexOf($resolvedWorkspace, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
      break
    }

    $rootPid = [int]$process.ProcessId
    $currentPid = [int]$process.ParentProcessId
  }

  Write-Host "[INFO] Arret du processus $rootPid qui utilise le port $Port..."
  & taskkill.exe /PID $rootPid /T /F | Out-Null
}

$deadline = (Get-Date).AddSeconds(10)
while ((Get-Date) -lt $deadline) {
  if (-not (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)) {
    exit 0
  }
  Start-Sleep -Milliseconds 250
}

Write-Error "Le port $Port est toujours utilise apres la tentative d'arret."
exit 1
