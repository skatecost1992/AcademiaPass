# App iOS (.ipa)

Aquí queda `AcademiaPass-<versión>.ipa` cuando se compila la app iOS.

Apple solo permite compilar apps iOS **en macOS con Xcode**, y este proyecto se preparó en Windows. Hay dos
caminos:

1. **Sin Mac (GitHub Actions)**: sube `AcademiaPass/` a un repositorio de GitHub y ejecuta
   *Actions → iOS IPA → Run workflow*. Descarga el artefacto `AcademiaPass-unsigned-ipa`, guárdalo aquí e
   instálalo en el iPhone con Sideloadly o AltStore usando tu Apple ID (válido 7 días con cuenta gratuita).
2. **En un Mac**:

   ```bash
   cd app-ios
   chmod +x build-ipa.sh
   ./build-ipa.sh TU_TEAM_ID
   ```

   El script deja el `.ipa` firmado en esta carpeta.

Mientras tanto, en un iPhone se puede usar la **versión web** (Safari → compartir → *Agregar a inicio*), que usa
la misma cuenta y los mismos datos. Paso a paso en [`../../docs/DESPLIEGUE.md`](../../docs/DESPLIEGUE.md).
