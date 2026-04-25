$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appUrl = 'http://127.0.0.1:3001/'

try {
  $existingConnection = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1

  if ($existingConnection) {
    Stop-Process -Id $existingConnection.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
  }
} catch {
}

$nodePath = (Get-Command node -ErrorAction Stop).Source

Start-Process -FilePath $nodePath -ArgumentList 'server.js' -WorkingDirectory $projectDir -WindowStyle Minimized

$serverReady = $false

for ($attempt = 1; $attempt -le 10; $attempt++) {
  Start-Sleep -Seconds 1

  try {
    $response = Invoke-WebRequest -Uri $appUrl -UseBasicParsing -TimeoutSec 3

    if ($response.StatusCode -eq 200) {
      $serverReady = $true
      break
    }
  } catch {
  }
}

Start-Process $appUrl

if (-not $serverReady) {
  Write-Host 'The server is starting, but the browser was opened before the health check succeeded.'
}
