# Arranca la API de AcademiaPass en este PC usando la base de SQL Server local.
# Los telefonos (Android/iOS) en la misma red Wi-Fi se conectan eligiendo "Local (red Wi-Fi)" en la app.
#
# Requisitos (una sola vez):
#   1. Variables de entorno del usuario de Windows:
#        ACADEMIAPASS_APP_PASSWORD   clave del login academiapass_app (obligatoria)
#        ACADEMIAPASS_SQL_SERVER     opcional (por defecto este equipo)
#        ACADEMIAPASS_DB_NAME        opcional (por defecto AcademiaPass)
#        SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM  opcionales: envio de correos (ver docs\DESPLIEGUE.md)
#   2. Base creada con sql\sqlserver\crear-base-sqlserver.ps1
#
# Uso:  powershell -ExecutionPolicy Bypass -File iniciar-local-sqlserver.ps1 [-Seed]
param(
    [switch]$Seed   # carga la organizacion demo (admin.demo / Demo.2026) antes de arrancar
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

foreach ($name in 'ACADEMIAPASS_APP_PASSWORD', 'ACADEMIAPASS_SQL_SERVER', 'ACADEMIAPASS_DB_NAME', 'ACADEMIAPASS_APP_USER', 'JWT_SECRET',
                 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM') {
    if (-not [Environment]::GetEnvironmentVariable($name, 'Process')) {
        $v = [Environment]::GetEnvironmentVariable($name, 'User')
        if (-not $v) { $v = [Environment]::GetEnvironmentVariable($name, 'Machine') }
        if ($v) { [Environment]::SetEnvironmentVariable($name, $v, 'Process') }
    }
}
if (-not $env:ACADEMIAPASS_APP_PASSWORD) { throw 'Falta la variable de entorno ACADEMIAPASS_APP_PASSWORD. Ver docs\SERVIDORES_Y_BASE_LOCAL.md' }
$env:DB_CLIENT = 'mssql'
if (-not (Test-Path node_modules)) { npm install }

if ($Seed) { node src/seed.ts }

$ips = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.PrefixOrigin -in 'Dhcp', 'Manual' -and $_.IPAddress -notlike '169.*' }).IPAddress
Write-Host "En el telefono: Servidor > Local (red Wi-Fi) > http://<IP>:8080   IPs de este PC: $($ips -join ', ')" -ForegroundColor Cyan
node src/server.ts
