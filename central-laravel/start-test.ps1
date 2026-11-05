param([int]$Port=8091,[string]$Xampp='C:/xampp')
$ErrorActionPreference='Stop'
$base=$PSScriptRoot.Replace('\','/')
$xamppPath=(Resolve-Path -LiteralPath $Xampp).Path.Replace('\','/')
$httpd="$xamppPath/apache/bin/httpd.exe"
if (!(Test-Path -LiteralPath $httpd)) { throw 'XAMPP Apache is required.' }
$env:APP_ENV='local'
$env:APP_DEBUG='false'
$env:APP_URL="http://127.0.0.1:$Port"
$env:LOCALFORGE_LOCAL_MAIL='true'
$env:SESSION_COOKIE='localforge_laravel_test'
$env:SESSION_SECURE_COOKIE='false'
$env:SESSION_SAME_SITE='strict'
$conf=@"
ServerRoot "$xamppPath/apache"
ServerName 127.0.0.1:$Port
Listen 127.0.0.1:$Port
LoadModule authz_core_module modules/mod_authz_core.so
LoadModule dir_module modules/mod_dir.so
LoadModule setenvif_module modules/mod_setenvif.so
LoadModule mime_module modules/mod_mime.so
LoadModule php_module "$xamppPath/php/php8apache2_4.dll"
PHPIniDir "$xamppPath/php"
DocumentRoot "$base/public"
ErrorLog "$base/storage/logs/apache-test.log"
PidFile "$base/storage/logs/apache-test.pid"
TypesConfig conf/mime.types
<Directory "$base/public">
    Require all granted
    AllowOverride None
    Options -Indexes
    DirectoryIndex index.php
    SetEnvIf Authorization "(.+)" HTTP_AUTHORIZATION=`$1
    FallbackResource /index.php
</Directory>
<FilesMatch "\.php$">
    SetHandler application/x-httpd-php
</FilesMatch>
"@
$config="$base/storage/logs/apache-test.conf"
[IO.File]::WriteAllText($config,$conf,[Text.UTF8Encoding]::new($false))
& $httpd -f $config -t
if($LASTEXITCODE -ne 0){throw 'Apache configuration check failed.'}
& $httpd -f $config
exit $LASTEXITCODE
