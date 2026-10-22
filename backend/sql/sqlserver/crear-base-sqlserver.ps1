# Crea la base de datos AcademiaPass en SQL Server y prueba la conexion.
#
# Las credenciales NO van en este archivo: se leen de variables de entorno del equipo dueño de la base.
#   ACADEMIAPASS_SQL_USER      usuario administrador de SQL Server (p. ej. sa). Si no existe se usa la
#                              autenticacion de Windows del usuario actual.
#   ACADEMIAPASS_SQL_PASSWORD  clave de ese usuario
#   ACADEMIAPASS_APP_PASSWORD  clave del login que usara el backend (academiapass_app)
#   ACADEMIAPASS_SQL_SERVER    opcional, por defecto el nombre de este equipo (DESKTOP-FODDHQ6)
#
# Uso:  powershell -ExecutionPolicy Bypass -File crear-base-sqlserver.ps1 [-Database AcademiaPass] [-SoloProbar]
param(
    [string]$Database = 'AcademiaPass',
    [string]$AppLogin = 'academiapass_app',
    [switch]$SoloProbar   # solo prueba la conexion con el login de la aplicacion
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot

function Get-Var([string]$name) {
    # Busca en el proceso, luego en las del usuario y luego en las del equipo
    foreach ($scope in 'Process', 'User', 'Machine') {
        $v = [Environment]::GetEnvironmentVariable($name, $scope)
        if ($v) { return $v }
    }
    return $null
}

$server = Get-Var 'ACADEMIAPASS_SQL_SERVER'
if (-not $server) { $server = $env:COMPUTERNAME }
$adminUser = Get-Var 'ACADEMIAPASS_SQL_USER'
$adminPass = Get-Var 'ACADEMIAPASS_SQL_PASSWORD'
$appPass = Get-Var 'ACADEMIAPASS_APP_PASSWORD'

if (-not (Get-Command sqlcmd -ErrorAction SilentlyContinue)) { throw 'No se encontro sqlcmd. Instala las herramientas de linea de comandos de SQL Server.' }
if (-not $appPass) { throw 'Define la variable de entorno ACADEMIAPASS_APP_PASSWORD (clave del login de la aplicacion).' }

# -C confia en el certificado del servidor (equivale a TrustServerCertificate=True) y -N cifra (Encrypt=True)
$common = @('-S', $server, '-C', '-N', '-b', '-I')

function Invoke-Sql([string[]]$sqlArgs, [string]$user, [string]$pass) {
    if ($user) {
        # La clave va en SQLCMDPASSWORD para que no aparezca en la linea de comandos
        $env:SQLCMDPASSWORD = $pass
        try { & sqlcmd @common -U $user @sqlArgs } finally { Remove-Item Env:\SQLCMDPASSWORD -ErrorAction SilentlyContinue }
    } else {
        & sqlcmd @common -E @sqlArgs
    }
    if ($LASTEXITCODE -ne 0) { throw "sqlcmd termino con codigo $LASTEXITCODE" }
}

if (-not $SoloProbar) {
    $auth = if ($adminUser) { "usuario $adminUser" } else { 'autenticacion de Windows' }
    Write-Host "Servidor: $server  ($auth)" -ForegroundColor Cyan
    Write-Host '1/2 Creando base de datos y login de la aplicacion...' -ForegroundColor Cyan
    Invoke-Sql @('-i', (Join-Path $here '01_crear_base.sql'), '-v', "DB_NAME=$Database", "APP_LOGIN=$AppLogin", "APP_PASSWORD=$appPass") $adminUser $adminPass
    Write-Host '2/2 Creando tablas...' -ForegroundColor Cyan
    Invoke-Sql @('-d', $Database, '-i', (Join-Path $here '02_esquema.sql')) $adminUser $adminPass
}

Write-Host "Probando conexion con el login $AppLogin..." -ForegroundColor Cyan
Invoke-Sql @('-d', $Database, '-Q', "SET NOCOUNT ON; SELECT DB_NAME() AS base, SUSER_SNAME() AS login, COUNT(*) AS tablas FROM sys.tables;") $AppLogin $appPass

Write-Host ''
Write-Host 'Cadena de conexion para la aplicacion (la clave sale de ACADEMIAPASS_APP_PASSWORD):' -ForegroundColor Green
Write-Host "  Data Source=$server;Initial Catalog=$Database;User ID=$AppLogin;Password=<ACADEMIAPASS_APP_PASSWORD>;Encrypt=True;TrustServerCertificate=True"
