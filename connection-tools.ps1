$ErrorActionPreference = 'Stop'
function Get-LocalForgePython {
    $venv = Join-Path $PSScriptRoot '.local\python\Scripts\python.exe'
    if (Test-Path -LiteralPath $venv) {
        & $venv -c "import importlib.util,sys; sys.exit(0 if importlib.util.find_spec('paramiko') else 1)"
        if ($LASTEXITCODE -eq 0) { return $venv }
    }
    $candidates = @((Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'))
    $installed = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($installed -and $installed.Source -notlike '*WindowsApps*') { $candidates += $installed.Source }
    $runtime = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $runtime) { throw 'Python 3.10+ kell a titkositott kapcsolathoz. Telepitsd a python.org oldalrol.' }
    & $runtime -m venv (Join-Path $PSScriptRoot '.local\python') | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'A helyi Python kornyezet nem hozhato letre.' }
    & $venv -m pip install --disable-pip-version-check --only-binary=:all: --index-url https://pypi.org/simple 'paramiko==5.1.0' | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Az SSH-fuggoseg telepitese nem sikerult.' }
    return $venv
}
function Get-PlainLocalSecret([string]$Encrypted) {
    $secure = ConvertTo-SecureString $Encrypted
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secure.Dispose() }
}
function ConvertTo-LocalForgeTransportJson($Value) {
    # Windows PowerShell 5.1 csovezese ASCII is lehet. A JSON unicode escape-jei
    # megorzik az ekezeteket es a surrogate parokat az encodingtol fuggetlenul.
    $json = ConvertTo-Json -InputObject $Value -Compress -Depth 10
    $builder = New-Object System.Text.StringBuilder
    foreach ($character in $json.ToCharArray()) {
        if ([int][char]$character -gt 127) {
            [void]$builder.AppendFormat('\u{0:x4}', [int][char]$character)
        } else { [void]$builder.Append($character) }
    }
    return $builder.ToString()
}
function Invoke-SavedConnection([string]$Mode) {
    $configPath = Join-Path $PSScriptRoot '.local\connection.json'
    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if ($config.schema -ne 1) { throw 'Ismeretlen kapcsolatifajl-formatum.' }
    $python = Get-LocalForgePython
    $payload = @{host=$config.host; username=$config.username; password=(Get-PlainLocalSecret $config.sshPassword); sudoPassword=(Get-PlainLocalSecret $config.sudoPassword)}
    if ($Mode -in @('install-lan','verify-lan','verify-history')) {
        if (-not $config.webPassword) {
            if ($Mode -ne 'install-lan') { throw 'Nincs mentett webes jelszo.' }
            $taskBytes = New-Object byte[] 16
            $taskRng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
            try { $taskRng.GetBytes($taskBytes) } finally { $taskRng.Dispose() }
            $taskWebSecret = [BitConverter]::ToString($taskBytes).Replace('-','').ToLowerInvariant()
            $config | Add-Member -NotePropertyName webUsername -NotePropertyValue 'miner' -Force
            $config | Add-Member -NotePropertyName webPassword -NotePropertyValue (ConvertFrom-SecureString (ConvertTo-SecureString $taskWebSecret -AsPlainText -Force)) -Force
            ConvertTo-LocalForgeTransportJson $config | Set-Content -LiteralPath $configPath -Encoding UTF8
            $taskWebSecret = $null
        }
        $payload['webUsername'] = $config.webUsername
        $payload['webPassword'] = Get-PlainLocalSecret $config.webPassword
    }
    $previousEncoding = $OutputEncoding
    try {
        $OutputEncoding = New-Object System.Text.UTF8Encoding($false)
        # A jelszo csak a gyermekfolyamat stdin csatornajara kerul, nem argumentumba/fajlba.
        ConvertTo-LocalForgeTransportJson $payload | & $python -B -X utf8 (Join-Path $PSScriptRoot 'scripts\remote-connection.py') $Mode
        if ($LASTEXITCODE -ne 0) { throw 'A mentett kapcsolattal vegzett muvelet sikertelen.' }
    } finally { $OutputEncoding = $previousEncoding; $payload.password=$null; $payload.sudoPassword=$null; $payload['webPassword']=$null; $payload=$null }
}
