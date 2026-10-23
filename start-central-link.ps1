$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'connection-tools.ps1')
while ($true) {
    try { Invoke-SavedConnection 'central-tunnel' }
    catch { Write-Output 'A kozponti alagut ujracsatlakozik.' }
    Start-Sleep -Seconds 5
}
