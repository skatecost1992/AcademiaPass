# Copia el codigo compartido de app-android a app-ios (src y assets son iguales en las dos apps).
# Uso: powershell -ExecutionPolicy Bypass -File sync-src.ps1
$root = $PSScriptRoot
robocopy (Join-Path $root 'app-android\src') (Join-Path $root 'app-ios\src') /MIR /NJH /NJS /NP | Out-Null
robocopy (Join-Path $root 'app-android\assets') (Join-Path $root 'app-ios\assets') /MIR /NJH /NJS /NP | Out-Null
Write-Host 'app-ios/src y app-ios/assets sincronizados con app-android' -ForegroundColor Green
