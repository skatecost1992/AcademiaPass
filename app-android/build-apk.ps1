# Compila el APK de AcademiaPass en Windows y lo deja en ..\resources\androidapk\
#
# Todo ocurre dentro de esta carpeta (no se crean carpetas en otras ubicaciones). Requisitos:
#   - JAVA_HOME (JDK 17+), ANDROID_HOME (SDK de Android Studio), Node.js 20+ y `npm install` hecho.
#   - Rutas largas de Windows activadas (LongPathsEnabled=1). El plugin plugins/withCmakeVersion.js usa un
#     CMake reciente que las soporta; Gradle lo descarga solo la primera vez.
#
# Uso:  powershell -ExecutionPolicy Bypass -File build-apk.ps1 [-AllAbis]
param(
    [switch]$AllAbis   # incluye armeabi-v7a, x86 y x86_64 ademas de arm64-v8a (APK mas grande)
)
$ErrorActionPreference = "Stop"
$Project = $PSScriptRoot
$OutDir = Join-Path (Split-Path $Project -Parent) "resources\androidapk"
$Version = (Get-Content (Join-Path $Project "app.json") -Raw | ConvertFrom-Json).expo.version

if (-not $env:JAVA_HOME) { throw "Define JAVA_HOME apuntando a un JDK 17 o superior." }
if (-not $env:ANDROID_HOME) { throw "Define ANDROID_HOME (normalmente %LOCALAPPDATA%\Android\Sdk)." }
$longPaths = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name LongPathsEnabled -ErrorAction SilentlyContinue).LongPathsEnabled
if ($longPaths -ne 1) { Write-Warning "LongPathsEnabled no esta activo: la compilacion nativa puede fallar por la longitud de la ruta." }

# 1) Regenera android/ con la configuracion de app.json (incluye el plugin de CMake)
Push-Location $Project
npx expo prebuild --platform android --no-install
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Fallo expo prebuild" }
Pop-Location

# 2) En algunas maquinas Java no puede abrir su socket local en %TEMP%; se usa una carpeta del proyecto
$javaTmp = Join-Path $Project "android\.javatmp"
New-Item -ItemType Directory -Force $javaTmp | Out-Null
$env:JAVA_TOOL_OPTIONS = "-Djdk.net.unixdomain.tmpdir=$javaTmp -Djava.io.tmpdir=$javaTmp"

# 3) Compila
$abis = if ($AllAbis) { "armeabi-v7a,arm64-v8a,x86,x86_64" } else { "arm64-v8a" }
Push-Location (Join-Path $Project "android")
try {
    # Kotlin en proceso: con el daemon de Kotlin, expo-modules-core fallo una vez con NoSuchMethodError en el
    # plugin pika (compilado para Kotlin 2.2.10); en proceso no ocurre
    .\gradlew.bat assembleRelease "-PreactNativeArchitectures=$abis" "-Pkotlin.compiler.execution.strategy=in-process" --no-daemon
    if ($LASTEXITCODE -ne 0) { throw "Gradle fallo (codigo $LASTEXITCODE)" }
} finally {
    Pop-Location
    Remove-Item Env:\JAVA_TOOL_OPTIONS -ErrorAction SilentlyContinue
}

# 4) Copia el APK a la carpeta de salida
New-Item -ItemType Directory -Force $OutDir | Out-Null
$suffix = if ($AllAbis) { "universal" } else { "arm64" }
$target = Join-Path $OutDir "AcademiaPass-$Version-$suffix.apk"
Copy-Item (Join-Path $Project "android\app\build\outputs\apk\release\app-release.apk") $target -Force
Write-Host "APK listo: $target" -ForegroundColor Green
