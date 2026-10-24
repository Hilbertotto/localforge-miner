param(
 [Parameter(Mandatory=$true)][string]$ImagePath,
 [Parameter(Mandatory=$true)][string]$ExpectedSha256,
 [Parameter(Mandatory=$true)][string]$ProgressPath,
 [Parameter(Mandatory=$true)][ValidateRange(0,1024)][int]$DiskNumber,
 [Parameter(Mandatory=$true)][ValidateNotNullOrEmpty()][string]$ExpectedSerial,
 [Parameter(Mandatory=$true)][long]$ExpectedSize,
 [ValidatePattern('^[A-Z]$')][string]$ExpectedDriveLetter,
 [Parameter(Mandatory=$true)][string]$ExpectedName
)
$ErrorActionPreference='Stop'
function Save-Progress([string]$Stage,[int]$Percent,[string]$Message){
 @{stage=$Stage;percent=$Percent;message=$Message;updated=(Get-Date).ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $ProgressPath -Encoding utf8
}
$taskHandles=@();$taskRaw=$null
try {
 if(-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Windows administrator privileges required.'}
 $taskImage=Get-Item -LiteralPath $ImagePath
 if($taskImage.Length -lt 1GB -or $taskImage.Length -ge $ExpectedSize){throw 'Unexpected ISO size.'}
 if((Get-FileHash -LiteralPath $ImagePath -Algorithm SHA256).Hash -ne $ExpectedSha256){throw 'ISO SHA256 mismatch.'}
 $taskDisk=Get-Disk -Number $DiskNumber
 if($taskDisk.BusType -ne 'USB' -or $taskDisk.IsBoot -or $taskDisk.IsSystem -or $taskDisk.Size -ne $ExpectedSize -or $taskDisk.SerialNumber.Trim() -ne $ExpectedSerial -or $taskDisk.FriendlyName -ne $ExpectedName){throw 'USB identity changed. No writes allowed.'}
 $taskPartitions=@(Get-Partition -DiskNumber $DiskNumber)
 if($taskDisk.IsReadOnly){throw 'Verified USB disk is read-only.'}
 if($ExpectedDriveLetter -and -not ($taskPartitions | Where-Object {$_.DriveLetter -eq $ExpectedDriveLetter})){throw 'Drive letter is no longer on the verified USB disk.'}
 Save-Progress 'verified' 0 'Verified USB identity. Beginning destructive write.'
 Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class LocalForgeRawUsb {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 public static extern SafeFileHandle CreateFile(string name,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)]
 public static extern bool DeviceIoControl(SafeFileHandle handle,uint code,IntPtr input,uint inputSize,IntPtr output,uint outputSize,out uint returned,IntPtr overlapped);
}
'@
 foreach($taskPart in $taskPartitions){
  $taskVolumePath=@($taskPart.AccessPaths | Where-Object {$_ -like '\\?\Volume{*'}) | Select-Object -First 1
  if(-not $taskVolumePath){
   if($taskPart.DriveLetter -match '^[A-Z]$'){$taskVolumePath='\\.\'+$taskPart.DriveLetter+':'}else{continue}
  }
  $taskVolume=[LocalForgeRawUsb]::CreateFile($taskVolumePath.TrimEnd('\'),[uint32]3221225472,3,[IntPtr]::Zero,3,0,[IntPtr]::Zero)
  if($taskVolume.IsInvalid){throw 'Cannot open USB volume.'}
  $taskHandles+=$taskVolume
  [uint32]$taskReturned=0
  if(-not [LocalForgeRawUsb]::DeviceIoControl($taskVolume,0x90018,[IntPtr]::Zero,0,[IntPtr]::Zero,0,[ref]$taskReturned,[IntPtr]::Zero)){throw 'Cannot lock USB volume. Close Explorer windows using F:.'}
  if(-not [LocalForgeRawUsb]::DeviceIoControl($taskVolume,0x90020,[IntPtr]::Zero,0,[IntPtr]::Zero,0,[ref]$taskReturned,[IntPtr]::Zero)){throw 'Cannot dismount USB volume.'}
 }
 $taskHandle=[LocalForgeRawUsb]::CreateFile(('\\.\PhysicalDrive'+$DiskNumber),[uint32]3221225472,3,[IntPtr]::Zero,3,0,[IntPtr]::Zero)
 if($taskHandle.IsInvalid){throw 'Cannot open verified USB physical disk.'}
 $taskRaw=[IO.FileStream]::new($taskHandle,[IO.FileAccess]::ReadWrite,4MB,$false)
 $taskInput=[IO.File]::OpenRead($taskImage.FullName)
 try {
  $taskBuffer=New-Object byte[] (4MB);[long]$taskWritten=0;$taskLast=-1
  while(($taskCount=$taskInput.Read($taskBuffer,0,$taskBuffer.Length)) -gt 0){
   $taskRaw.Write($taskBuffer,0,$taskCount);$taskWritten+=$taskCount
   $taskPercent=[int](100*$taskWritten/$taskImage.Length)
   if($taskPercent -ne $taskLast){Save-Progress 'writing' $taskPercent 'Writing LocalForge installer to verified USB disk.';$taskLast=$taskPercent}
  }
  $taskRaw.Flush($true)
 } finally {$taskInput.Dispose()}
 Save-Progress 'verifying' 0 'Reading USB contents back and checking SHA256.'
 $taskRaw.Position=0;$taskSha=[Security.Cryptography.SHA256]::Create()
 try {
  [long]$taskRemaining=$taskImage.Length
  while($taskRemaining -gt 0){
   $taskWant=[int][Math]::Min([long]$taskBuffer.Length,$taskRemaining)
   $taskRead=$taskRaw.Read($taskBuffer,0,$taskWant)
   if($taskRead -le 0){throw 'Unexpected end of USB readback.'}
   [void]$taskSha.TransformBlock($taskBuffer,0,$taskRead,$taskBuffer,0);$taskRemaining-=$taskRead
  }
  [void]$taskSha.TransformFinalBlock([byte[]]@(),0,0)
  if(([BitConverter]::ToString($taskSha.Hash)).Replace('-','') -ne $ExpectedSha256){throw 'USB readback SHA256 mismatch. Do not use this installer.'}
 } finally {$taskSha.Dispose()}
 Save-Progress 'complete' 100 'USB write and SHA256 readback verification successful.'
} catch {Save-Progress 'failed' 0 $_.Exception.Message;exit 1}
finally {if($taskRaw){$taskRaw.Dispose()};foreach($taskVolume in $taskHandles){$taskVolume.Dispose()}}
