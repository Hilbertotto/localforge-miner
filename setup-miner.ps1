param(
    [string]$Repository = 'Hilbertotto/localforge-miner',
    [string]$Version = 'latest',
    [string]$Address,
    [string]$UserName,
    [switch]$SkipDrivers,
    [switch]$TunnelOnly,
    [switch]$Plan
)
$ErrorActionPreference = 'Stop'
if ($Repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw 'Hibas GitHub repository.' }
if ($Version -ne 'latest' -and $Version -notmatch '^v[0-9]+\.[0-9]+\.[0-9]+$') { throw 'Verzio: latest vagy v0.3.0 formatum.' }
if ($Plan) {
    Write-Output ('GitHub: ' + $Repository + ' / ' + $Version)
    Write-Output 'Letoltes: hivatalos gh CLI, kiadott csomag es SHA256 ellenorzes.'
    Write-Output 'Ubuntu 26.04 x86-64: alapcsomagok, driver, LocalForge, minerek, API, Apache, automatikus indulas.'
    Write-Output 'Friss gepen nem indul banyaszat; walletet es profilt kesobb kell megadni.'
    exit 0
}
if (-not $Address) { $Address = Read-Host 'Az UJ Ubuntu gep IPv4-cime' }
$taskIp = $null
if (-not [Net.IPAddress]::TryParse($Address,[ref]$taskIp) -or $taskIp.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { throw 'Ervenyes IPv4-cim kell.' }
if (-not $UserName) { $UserName = Read-Host 'Ubuntu felhasznalonev' }
if ($UserName -notmatch '^[a-z_][a-z0-9_-]{0,31}$') { throw 'Hibas Ubuntu felhasznalonev.' }
Get-Command ssh.exe,scp.exe -ErrorAction Stop | Out-Null
$taskGh = Get-Command gh.exe -ErrorAction SilentlyContinue
if (-not $taskGh) {
    $taskGhPath = Join-Path $env:ProgramFiles 'GitHub CLI\gh.exe'
    if (-not (Test-Path -LiteralPath $taskGhPath)) {
        Get-Command winget.exe -ErrorAction Stop | Out-Null
        & winget.exe install --id GitHub.cli --exact --source winget
        if ($LASTEXITCODE -ne 0) { throw 'A GitHub CLI telepitese nem sikerult.' }
    }
    if (-not (Test-Path -LiteralPath $taskGhPath)) { throw 'A gh.exe nem talalhato. Nyiss uj terminalt, es probald ujra.' }
} else { $taskGhPath = $taskGh.Source }
$taskGhReady = $false
try { & $taskGhPath api user --jq .login 2>$null | Out-Null; $taskGhReady = $LASTEXITCODE -eq 0 } catch {}
if (-not $taskGhReady) {
    & $taskGhPath auth login --hostname github.com --git-protocol https --web
    if ($LASTEXITCODE -ne 0) { throw 'A GitHub-bejelentkezes nem sikerult.' }
}
if ($Version -eq 'latest') {
    $Version = (& $taskGhPath api ('repos/' + $Repository + '/releases/latest') --jq .tag_name | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $Version -notmatch '^v[0-9]+\.[0-9]+\.[0-9]+$') { throw 'Nem talalhato stabil GitHub kiadas.' }
}
$taskTempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$taskFolder = Join-Path $taskTempBase ('localforge-setup-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskFolder | Out-Null
try {
    $taskAsset = 'localforge-' + $Version + '.tar.gz'
    & $taskGhPath release download $Version --repo $Repository --pattern $taskAsset --pattern SHA256SUMS --dir $taskFolder
    if ($LASTEXITCODE -ne 0) { throw 'A GitHub kiadas letoltese nem sikerult. A privat tarolohoz jogosultsag kell.' }
    $taskLines = @(Get-Content -LiteralPath (Join-Path $taskFolder 'SHA256SUMS') | Where-Object { $_ -match ('^[a-fA-F0-9]{64}  ' + [regex]::Escape($taskAsset) + '$') })
    if ($taskLines.Count -ne 1) { throw 'Hianyzo vagy ketertelmu SHA256 a kiadashoz.' }
    $taskExpected = $taskLines[0].Substring(0,64).ToLowerInvariant()
    $taskArchive = Join-Path $taskFolder $taskAsset
    if ((Get-FileHash -LiteralPath $taskArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskExpected) { throw 'SHA256 elteres: a csomagot nem futtatjuk.' }
    Write-Host ('Ellenorzott kiadas: ' + $Version + '. Celgep: ' + $UserName + '@' + $Address)
    Write-Host 'Az SSH az Ubuntu jelszavat kerheti. Elso alkalommal ellenorizd a hostkulcs ujjlenyomatat.'
    $taskTarget = $UserName + '@' + $Address
    $taskRemote = (& ssh.exe -o StrictHostKeyChecking=ask $taskTarget 'umask 077; mktemp -d /tmp/localforge-setup.XXXXXXXX' | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $taskRemote -notmatch '^/tmp/localforge-setup\.[A-Za-z0-9]{8}$') { throw 'A tavoli ideiglenes konyvtar nem hozhato letre.' }
    & scp.exe $taskArchive ($taskTarget + ':' + $taskRemote + '/' + $taskAsset)
    if ($LASTEXITCODE -ne 0) { throw 'A csomag SSH masolasa nem sikerult.' }
    $taskOptions = '--address ' + $Address
    if ($SkipDrivers) { $taskOptions += ' --skip-drivers' }
    if ($TunnelOnly) { $taskOptions += ' --tunnel-only' }
    # Every interpolated value above has a strict allowlist. No password/token is in the command.
    $taskCommand = @"
set -e
cd '$taskRemote'
printf '%s  %s\n' '$taskExpected' '$taskAsset' | sha256sum -c -
tar -xzf '$taskAsset' --no-same-owner --no-same-permissions
sudo bash bootstrap-ubuntu.sh $taskOptions
"@
    & ssh.exe -t $taskTarget ($taskCommand.Replace("`r",''))
    if ($LASTEXITCODE -ne 0) { throw 'A tavoli telepites nem fejezodott be. A csomag a celgep ideiglenes konyvtaraban megmaradt az ujraprobalashoz.' }
    Write-Host 'KESZ. A webes cimet es a belepesi adatokat a fenti kimenet mutatja.'
} finally {
    $taskResolved = [IO.Path]::GetFullPath($taskFolder)
    $taskPrefix = $taskTempBase.TrimEnd('\') + '\'
    if ($taskResolved.StartsWith($taskPrefix,[StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($taskResolved) -match '^localforge-setup-[a-f0-9]{32}$') {
        Remove-Item -LiteralPath $taskResolved -Recurse -Force
    }
}
