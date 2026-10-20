$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'connection-tools.ps1')
$rigAddress = Read-Host 'Ubuntu IP-cime'
$rigUser = Read-Host 'Ubuntu felhasznalonev (pelda: hilbi1)'
$parsedAddress = $null
if (-not [Net.IPAddress]::TryParse($rigAddress,[ref]$parsedAddress) -or $parsedAddress.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { throw 'Ervenyes IPv4-cim kell.' }
if ($rigUser -notmatch '^[a-z_][a-z0-9_-]{0,31}$') { throw 'Hibas felhasznalonev.' }
$sshSecret = Read-Host 'SSH jelszo (nem latszik)' -AsSecureString
$sudoSecret = Read-Host 'Sudo jelszo (Enter: ugyanaz, mint az SSH jelszo)' -AsSecureString
if ($sshSecret.Length -eq 0) { throw 'Az SSH jelszo nem lehet ures.' }
if ($sudoSecret.Length -eq 0) { $sudoSecret = $sshSecret.Copy() }
$privateDir = Join-Path $PSScriptRoot '.local'
New-Item -ItemType Directory -Force -Path $privateDir | Out-Null
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true,$false)
$rule = New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $privateDir -AclObject $acl
$config = @{schema=1;host=$rigAddress;username=$rigUser;sshPassword=(ConvertFrom-SecureString $sshSecret);sudoPassword=(ConvertFrom-SecureString $sudoSecret)}
$config | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $privateDir 'connection.json') -Encoding UTF8
$sshSecret.Dispose(); $sudoSecret.Dispose(); $config=$null
Get-LocalForgePython | Out-Null
Write-Host 'Mentve: .local\connection.json. A jelszavak a Windows fiokhoz kotott DPAPI-val titkositottak.'
Write-Host 'Ezutan install-web.bat es open-web.bat automatikusan ezt olvassa.'
