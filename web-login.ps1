$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'connection-tools.ps1')
$taskConnection = Get-Content -LiteralPath (Join-Path $PSScriptRoot '.local\connection.json') -Raw | ConvertFrom-Json
if (-not $taskConnection.webPassword) { throw 'A webes LAN eleres meg nincs beallitva.' }
Write-Host ('Webcim: http://' + $taskConnection.host + ':8080/')
Write-Host ('Felhasznalo: ' + $taskConnection.webUsername)
Write-Host ('Webes jelszo: ' + (Get-PlainLocalSecret $taskConnection.webPassword))
Write-Host 'Ez kulon webes jelszo, nem az Ubuntu/SSH jelszava.'
