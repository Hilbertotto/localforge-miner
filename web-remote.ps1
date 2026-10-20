param([ValidateSet('install','open')][string]$Mode='open')
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath (Join-Path $PSScriptRoot '.local\connection.json')) {
    . (Join-Path $PSScriptRoot 'connection-tools.ps1')
    Invoke-SavedConnection $Mode
    exit 0
}
$rigAddress = Read-Host 'Ubuntu gep IP-cime'
$rigUser = Read-Host 'Ubuntu felhasznalonev (pelda: hilbi1)'
$parsedAddress = $null
if (-not [System.Net.IPAddress]::TryParse($rigAddress, [ref]$parsedAddress) -or $parsedAddress.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { throw 'Ervenyes IPv4-cim szukseges.' }
if ($rigUser -notmatch '^[a-z_][a-z0-9_-]{0,31}$') { throw 'Hibas felhasznalonev.' }
Get-Command ssh.exe -ErrorAction Stop | Out-Null
$rigTarget = "$rigUser@$rigAddress"
if ($Mode -eq 'install') {
    Get-Command scp.exe,tar.exe -ErrorAction Stop | Out-Null
    $archivePath = Join-Path $env:TEMP ('localforge-' + [guid]::NewGuid().ToString('N') + '.tar.gz')
    try {
        & tar.exe -czf $archivePath -C $PSScriptRoot server.mjs package.json src public scripts install-web.sh
        if ($LASTEXITCODE -ne 0) { throw 'A csomagolas sikertelen.' }
        & scp.exe $archivePath "${rigTarget}:localforge-upload.tar.gz"
        if ($LASTEXITCODE -ne 0) { throw 'A masolas sikertelen.' }
        & ssh.exe -t $rigTarget 'set -e; d=$(mktemp -d "$HOME/localforge-install.XXXXXX"); tar -xzf "$HOME/localforge-upload.tar.gz" -C "$d"; cd "$d"; sed -i "s/\r$//" install-web.sh; sudo bash install-web.sh'
        if ($LASTEXITCODE -ne 0) { throw 'A tavoli telepites nem fejezodott be.' }
    } finally {
        if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath }
    }
} else {
    Write-Host 'Az SSH kapcsolat letrejotte utan nyisd meg: http://127.0.0.1:8080'
    Write-Host 'Ezt az ablakot hagyd nyitva. Leallitas: Ctrl+C. A banyaszat ettol tovabb fut.'
    & ssh.exe -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L 127.0.0.1:8080:127.0.0.1:8080 $rigTarget
    if ($LASTEXITCODE -ne 0) { throw 'Az SSH alagut megszakadt vagy nem indult el.' }
}
