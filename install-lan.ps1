$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'connection-tools.ps1')
Invoke-SavedConnection 'install-lan'
