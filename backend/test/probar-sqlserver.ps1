# Corre la suite de la API contra una base temporal de SQL Server (autenticacion de Windows) y la elimina al final.
# Uso: npm run test:sqlserver
$ErrorActionPreference = 'Stop'
$backend = Split-Path $PSScriptRoot -Parent
$db = 'AcademiaPass_test'
$login = 'academiapass_test'
$pass = 'Tst!' + [guid]::NewGuid().ToString('N').Substring(0, 16) + 'a9'
$server = $env:COMPUTERNAME

function Drop-TestDb {
  sqlcmd -S $server -E -C -N -b -I -Q "IF DB_ID('$db') IS NOT NULL BEGIN ALTER DATABASE [$db] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [$db]; END; IF EXISTS (SELECT 1 FROM sys.server_principals WHERE name='$login') DROP LOGIN [$login];" | Out-Null
}

Drop-TestDb
sqlcmd -S $server -E -C -N -b -I -i "$backend\sql\sqlserver\01_crear_base.sql" -v "DB_NAME=$db" "APP_LOGIN=$login" "APP_PASSWORD=$pass"
if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear la base de prueba' }

$env:DB_CLIENT = 'mssql'
$env:ACADEMIAPASS_DB_NAME = $db
$env:ACADEMIAPASS_APP_USER = $login
$env:ACADEMIAPASS_APP_PASSWORD = $pass
try {
  Set-Location $backend
  node --test test/api.test.ts 2>&1 | Out-String -Width 300
} finally {
  Remove-Item Env:\DB_CLIENT, Env:\ACADEMIAPASS_DB_NAME, Env:\ACADEMIAPASS_APP_USER, Env:\ACADEMIAPASS_APP_PASSWORD -ErrorAction SilentlyContinue
  if (-not $env:KEEP_TEST_DB) { Drop-TestDb; 'Base de prueba eliminada' }
}
