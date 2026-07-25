param(
    [switch]$Development
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$target = if ($Development) {
    Join-Path $projectRoot 'backend\.env'
} else {
    Join-Path $projectRoot '.env'
}

if (Test-Path -LiteralPath $target) {
    Write-Host "Le fichier $target existe déjà. Aucune modification effectuée."
    exit 0
}

do {
    $securePassword = Read-Host 'Mot de passe du premier administrateur (12 caractères minimum)' -AsSecureString
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    try {
        $adminPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }

    if ($adminPassword.Length -lt 12) {
        Write-Warning 'Le mot de passe doit contenir au moins 12 caractères.'
    }
} while ($adminPassword.Length -lt 12)

$defaultComfyUrl = if ($Development) {
    'http://127.0.0.1:8188'
} else {
    'http://host.docker.internal:8188'
}
$comfyUrl = Read-Host "URL de ComfyUI [$defaultComfyUrl]"
if ([string]::IsNullOrWhiteSpace($comfyUrl)) {
    $comfyUrl = $defaultComfyUrl
}

$secretBytes = New-Object byte[] 48
$generator = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $generator.GetBytes($secretBytes)
} finally {
    $generator.Dispose()
}
$authSecret = ([BitConverter]::ToString($secretBytes)).Replace('-', '').ToLowerInvariant()

function ConvertTo-DotenvValue([string]$value) {
    return '"' + $value.Replace('\', '\\').Replace('"', '\"') + '"'
}

$lines = @(
    "APP_PASSWORD=$(ConvertTo-DotenvValue $adminPassword)"
    "AUTH_SECRET=$authSecret"
    "COMFY_URL=$(ConvertTo-DotenvValue $comfyUrl)"
    'FRONTEND_PORT=5173'
    'CORS_ORIGINS='
    'SERVICE_URL_ALLOWLIST='
    'ALLOW_PRIVATE_SERVICE_URLS=false'
    'ALLOW_USER_LLM_URLS=false'
)

$encoding = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllLines($target, $lines, $encoding)
$adminPassword = $null

Write-Host "Configuration créée dans $target"
Write-Host 'Conservez ce fichier privé : il est ignoré par Git.'
