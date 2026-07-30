param(
  [ValidateSet('check', 'backend', 'frontend', 'schema', 'seed', 'db-init', 'fullstack')]
  [string]$Task = 'check'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSCommandPath

function Add-ToPath {
  param([string]$PathEntry)

  if ($PathEntry -and (Test-Path $PathEntry) -and -not (($env:Path -split ';') -contains $PathEntry)) {
    $env:Path = "$PathEntry;$env:Path"
  }
}

Add-ToPath 'C:\Program Files\nodejs'
Add-ToPath "$env:LOCALAPPDATA\Programs\nodejs"

$postgresRoots = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending
foreach ($root in $postgresRoots) {
  Add-ToPath (Join-Path $root.FullName 'bin')
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
$psql = Get-Command psql.exe -ErrorAction SilentlyContinue

function Test-HttpEndpoint {
  param(
    [string]$Url,
    [string]$ContentPattern
  )

  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 400) {
      return $false
    }

    if ($ContentPattern) {
      return $response.Content -match [Regex]::Escape($ContentPattern)
    }

    return $true
  } catch {
    return $false
  }
}

function Get-ListeningPid {
  param([int]$Port)

  $tcpConnection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($tcpConnection) {
    return [int]$tcpConnection.OwningProcess
  }

  $netstatLine = netstat -ano | Select-String ":$Port" | Select-Object -First 1
  if (-not $netstatLine) {
    return $null
  }

  $parts = ($netstatLine.ToString() -split '\s+') | Where-Object { $_ }
  $pidText = $parts[-1]
  if ($pidText -match '^\d+$') {
    return [int]$pidText
  }

  return $null
}

function Wait-ForHttpEndpoint {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 45
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-HttpEndpoint -Url $Url) {
      return $true
    }

    Start-Sleep -Milliseconds 500
  }

  return $false
}

function Start-BackendBackground {
  Require-Command $node 'node' 'Install Node.js or add C:\Program Files\nodejs to PATH.'

  $logsDir = Join-Path $repoRoot 'logs'
  if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
  }

  $stdoutPath = Join-Path $logsDir 'backend-auto.log'
  $stderrPath = Join-Path $logsDir 'backend-auto.err.log'

  foreach ($path in @($stdoutPath, $stderrPath)) {
    if (Test-Path $path) {
      Remove-Item $path -Force
    }
  }

  $process = Start-Process `
    -FilePath $node.Source `
    -ArgumentList @('src/server.js') `
    -WorkingDirectory (Join-Path $repoRoot 'backend') `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru

  return @{
    Process = $process
    Stdout = $stdoutPath
    Stderr = $stderrPath
  }
}

function Ensure-BackendRunning {
  Require-Command $npm 'npm' 'Install Node.js or add C:\Program Files\nodejs to PATH.'

  if (Test-HttpEndpoint -Url 'http://localhost:5000/api/health') {
    return
  }

  $backendPid = Get-ListeningPid -Port 5000
  if ($backendPid) {
    throw "Port 5000 is already in use by PID $backendPid, but Acureal backend health is not responding. Stop it with Stop-Process -Id $backendPid -Force or close the other terminal, then rerun the command."
  }

  Write-Host 'Backend is not running. Starting it in the background...'
  $backendStart = Start-BackendBackground

  if (-not (Wait-ForHttpEndpoint -Url 'http://localhost:5000/api/health')) {
    $stderrPreview = if (Test-Path $backendStart.Stderr) {
      (Get-Content $backendStart.Stderr -ErrorAction SilentlyContinue | Select-Object -First 20) -join [Environment]::NewLine
    } else {
      ''
    }

    throw @"
Backend did not become healthy on http://localhost:5000/api/health within 45 seconds.
Check:
  $($backendStart.Stdout)
  $($backendStart.Stderr)
$stderrPreview
"@
  }

  Write-Host 'Backend started at http://localhost:5000/api/health'
}

function Require-Command {
  param(
    [object]$CommandRef,
    [string]$Name,
    [string]$Message
  )

  if (-not $CommandRef) {
    throw "$Name is not available. $Message"
  }
}

switch ($Task) {
  'check' {
    Write-Host "Repo root: $repoRoot"
    Write-Host "node: $(if ($node) { $node.Source } else { 'NOT FOUND' })"
    Write-Host "npm:  $(if ($npm) { $npm.Source } else { 'NOT FOUND' })"
    Write-Host "psql: $(if ($psql) { $psql.Source } else { 'NOT FOUND' })"
    Write-Host ''
    Write-Host 'Available commands:'
    Write-Host '  .\run-redip.ps1 check'
    Write-Host '  .\run-redip.ps1 schema'
    Write-Host '  .\run-redip.ps1 seed'
    Write-Host '  .\run-redip.ps1 db-init'
    Write-Host '  .\run-redip.ps1 backend'
    Write-Host '  .\run-redip.ps1 frontend'
    Write-Host '  .\run-redip.ps1 fullstack'
  }

  'backend' {
    Require-Command $npm 'npm' 'Install Node.js or add C:\Program Files\nodejs to PATH.'

    if (Test-HttpEndpoint -Url 'http://localhost:5000/api/health') {
      Write-Host 'Backend already running at http://localhost:5000/api/health'
      Write-Host 'Open another terminal for .\run-redip.ps1 frontend if you still need the UI.'
      break
    }

    $backendPid = Get-ListeningPid -Port 5000
    if ($backendPid) {
      throw "Port 5000 is already in use by PID $backendPid. Stop it with Stop-Process -Id $backendPid -Force or close the other terminal, then rerun .\run-redip.ps1 backend."
    }

    Push-Location (Join-Path $repoRoot 'backend')
    try {
      & $npm.Source run dev
    } finally {
      Pop-Location
    }
  }

  'frontend' {
    Require-Command $npm 'npm' 'Install Node.js or add C:\Program Files\nodejs to PATH.'

    Ensure-BackendRunning

    if (Test-HttpEndpoint -Url 'http://127.0.0.1:5173/' -ContentPattern 'Acureal') {
      Write-Host 'Frontend already running at http://127.0.0.1:5173/'
      break
    }

    Push-Location (Join-Path $repoRoot 'frontend')
    try {
      & $npm.Source run dev
    } finally {
      Pop-Location
    }
  }

  'fullstack' {
    Require-Command $npm 'npm' 'Install Node.js or add C:\Program Files\nodejs to PATH.'
    Ensure-BackendRunning

    if (Test-HttpEndpoint -Url 'http://127.0.0.1:5173/' -ContentPattern 'Acureal') {
      Write-Host 'Frontend already running at http://127.0.0.1:5173/'
      break
    }

    Push-Location (Join-Path $repoRoot 'frontend')
    try {
      & $npm.Source run dev
    } finally {
      Pop-Location
    }
  }

  'schema' {
    Require-Command $npm 'npm' 'Install Node.js or add C:\Program Files\nodejs to PATH.'
    Push-Location (Join-Path $repoRoot 'backend')
    try {
      & $npm.Source run migrate
    } finally {
      Pop-Location
    }
  }

  'seed' {
    Require-Command $npm 'npm' 'Install Node.js or add C:\Program Files\nodejs to PATH.'
    Push-Location (Join-Path $repoRoot 'backend')
    try {
      & $npm.Source run seed
    } finally {
      Pop-Location
    }
  }

  'db-init' {
    Require-Command $npm 'npm' 'Install Node.js or add C:\Program Files\nodejs to PATH.'
    Push-Location (Join-Path $repoRoot 'backend')
    try {
      & $npm.Source run migrate
      if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
      & $npm.Source run seed
      exit $LASTEXITCODE
    } finally {
      Pop-Location
    }
  }
}
