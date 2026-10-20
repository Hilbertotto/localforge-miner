$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath (Join-Path $PSScriptRoot '.local\connection.json')) {
    . (Join-Path $PSScriptRoot 'connection-tools.ps1')
    Invoke-SavedConnection 'base'
    exit 0
}
$rigAddress = Read-Host 'Ubuntu gep IP-cime (pelda: 192.168.1.50)'
$rigUser = Read-Host 'Ubuntu felhasznalonev'
$parsedAddress = $null
if (-not [System.Net.IPAddress]::TryParse($rigAddress, [ref]$parsedAddress) -or $parsedAddress.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { throw 'Ervenyes IPv4-cim szukseges.' }
if ($rigUser -notmatch '^[a-z_][a-z0-9_-]{0,31}$') { throw 'Hibas felhasznalonev.' }
Get-Command ssh.exe, scp.exe -ErrorAction Stop | Out-Null
$rigTarget = "$rigUser@$rigAddress"
& scp.exe (Join-Path $PSScriptRoot 'setup-ubuntu.sh') "${rigTarget}:setup-ubuntu.sh"
if ($LASTEXITCODE -ne 0) { throw 'A masolas sikertelen.' }
& ssh.exe -t $rigTarget "sed -i 's/\r$//' setup-ubuntu.sh && sudo bash setup-ubuntu.sh"
if ($LASTEXITCODE -ne 0) { throw 'A tavoli telepites sikertelen.' }
