$ErrorActionPreference='Stop'
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'connection-tools.ps1')
$dummy = ConvertTo-SecureString 'localforge-synthetic-test' -AsPlainText -Force
$encrypted = ConvertFrom-SecureString $dummy
if ((Get-PlainLocalSecret $encrypted) -ne 'localforge-synthetic-test') { throw 'DPAPI roundtrip failed' }
$dummy.Dispose(); $encrypted=$null
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=New-Object Security.AccessControl.DirectorySecurity
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true,$false)
$rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
$acl.AddAccessRule($rule)
'DPAPI and ACL constructor smoke check OK (synthetic data only)'
