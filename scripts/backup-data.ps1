param(
    [string]$DestinationRoot
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($DestinationRoot)) {
    $DestinationRoot = Join-Path (Split-Path -Parent $projectRoot) 'ComfyForge-data-backups'
}

$resolvedProject = [IO.Path]::GetFullPath($projectRoot)
$resolvedDestination = [IO.Path]::GetFullPath($DestinationRoot)
if ($resolvedDestination.StartsWith($resolvedProject + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The backup destination must be outside the project repository.'
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path $resolvedDestination "ComfyForge-data-$stamp"
$databaseSnapshot = Join-Path $backupDir 'backend\data\history.db'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $databaseSnapshot) | Out-Null

Push-Location (Join-Path $projectRoot 'backend')
try {
    npm run cli -- backup $databaseSnapshot
    if ($LASTEXITCODE -ne 0) { throw "Database backup failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}

$workflowSource = Join-Path $projectRoot 'backend\workflows'
if (Test-Path -LiteralPath $workflowSource) {
    Copy-Item -LiteralPath $workflowSource -Destination (Join-Path $backupDir 'backend\workflows') -Recurse
}
$companionSource = Join-Path $projectRoot 'backend\data\companions'
if (Test-Path -LiteralPath $companionSource) {
    Copy-Item -LiteralPath $companionSource -Destination (Join-Path $backupDir 'backend\data\companions') -Recurse
}
$imageSource = Join-Path $projectRoot 'images'
if (Test-Path -LiteralPath $imageSource) {
    Copy-Item -LiteralPath $imageSource -Destination (Join-Path $backupDir 'images') -Recurse
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'VERSION') -Destination (Join-Path $backupDir 'VERSION')

foreach ($configuration in @('.env', 'backend\.env')) {
    $source = Join-Path $projectRoot $configuration
    if (Test-Path -LiteralPath $source) {
        $safeName = $configuration.Replace('\', '-') + '.private'
        Copy-Item -LiteralPath $source -Destination (Join-Path $backupDir $safeName)
    }
}

$manifest = [ordered]@{
    createdAt = (Get-Date).ToUniversalTime().ToString('o')
    version = (Get-Content -Raw (Join-Path $projectRoot 'VERSION')).Trim()
    databaseSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $databaseSnapshot).Hash
    containsPrivateConfiguration = (Get-ChildItem -LiteralPath $backupDir -Filter '*.private').Count -gt 0
}
$manifest | ConvertTo-Json | Set-Content -Encoding utf8 -LiteralPath (Join-Path $backupDir 'manifest.json')

Write-Host "Verified ComfyForge data backup created at: $backupDir"
Write-Warning 'This backup may contain private configuration and must not be committed or shared.'
