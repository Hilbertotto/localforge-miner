param([Parameter(Mandatory=$true)][string]$Python)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
. (Join-Path $projectRoot 'connection-tools.ps1')
$synthetic='test-'+[char]0xE1+[char]0xE9+[char]0x151+[char]0x171+'-'+[char]0xD83D+[char]0xDD12
$payload=@{password=$synthetic;sudoPassword=$synthetic;root=$projectRoot}
$savedEncoding=$OutputEncoding
try {
    # Az eredeti hibahoz hasonloan a legszigorubb ASCII-csovet teszteljuk.
    $OutputEncoding=[Text.Encoding]::ASCII
    $transport=ConvertTo-LocalForgeTransportJson $payload
    if ($transport -match '[^\x00-\x7f]') { throw 'Non-ASCII transport data' }
    $transport | & $Python -B -X utf8 (Join-Path $PSScriptRoot 'transport-smoke.py')
    if ($LASTEXITCODE -ne 0) { throw 'Unicode transport regression' }
} finally { $OutputEncoding=$savedEncoding; $payload=$null; $synthetic=$null; $transport=$null }
