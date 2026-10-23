$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'connection-tools.ps1')
while ($true) {
    try { Invoke-SavedConnection 'web-tunnel' }
    catch { Write-Output 'A miner webes alagutja ujracsatlakozik.' }
    Start-Sleep -Seconds 5
}
