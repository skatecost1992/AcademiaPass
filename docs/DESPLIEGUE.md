# Despliegue y compilación

## 1. Base de datos y API en la nube (Render)

Requisito: cuenta en GitHub y en [render.com](https://render.com) (plan gratuito).

1. Crea un repositorio en GitHub y sube la carpeta `AcademiaPass/` (la raíz del repo debe contener
   `render.yaml`).
2. En Render: **New → Blueprint**, elige el repositorio y confirma. Se crean:
   - `academiapass-db`: PostgreSQL.
   - `academiapass`: la API y la versión web (`buildCommand` compila la web; `JWT_SECRET` se genera solo).
3. Espera el primer despliegue y abre `https://academiapass.onrender.com/api/health` (el nombre exacto lo da
   Render). Debe responder `{"ok":true,...}`.
4. Opcional: define `ADMIN_SIGNUP_CODE` en *Environment* para que solo quien tenga el código pueda crear
   organizaciones.

Notas:
- El plan gratuito de Render "duerme" el servicio tras 15 minutos sin uso (el primer acceso tarda ~1 minuto) y
  la base gratuita vence a los 30 días. Para uso real usa un plan pago o una base externa.
- **Base externa (Neon o Supabase, gratuitas y sin vencimiento)**: crea la base, copia su cadena de conexión
  (`postgresql://...?sslmode=require`), borra la sección `databases` de `render.yaml`, borra `PGSSL` y define
  `DATABASE_URL` con esa cadena en Render.
- El esquema se crea solo al arrancar. Para datos de prueba en la nube: `DATABASE_URL=... npm run seed` desde
  `backend/` en tu PC.

## 2. Apuntar las apps al servidor

- **Web**: la misma URL de Render (`https://academiapass.onrender.com`). En el celular se puede agregar a la
  pantalla de inicio.
- **Android / iOS**: en la pantalla de ingreso toca *Configurar servidor* y escribe la URL. Para que el APK
  venga ya configurado, pon la URL en `app-android/app.json` → `expo.extra.apiUrl` (y en `app-ios/app.json`)
  antes de compilar.

## 3. APK de Android (Windows)

Requisitos ya presentes en este equipo: JDK 17+ (`JAVA_HOME`), Android SDK (`ANDROID_HOME`), CMake 3.31.6 en el
SDK, rutas largas de Windows activas, Node 24.

```powershell
cd app-android
npm install --legacy-peer-deps
powershell -ExecutionPolicy Bypass -File build-apk.ps1           # arm64 (la mayoría de teléfonos)
powershell -ExecutionPolicy Bypass -File build-apk.ps1 -AllAbis  # universal
```

Resultado: `resources/androidapk/AcademiaPass-<versión>-arm64.apk`, firmado con la clave de depuración
(instalable directamente; para Google Play hay que firmar con una clave propia).

Instalación: copia el APK al teléfono, ábrelo y permite *instalar apps de origen desconocido*.

## 4. IPA de iOS

Sin Mac: GitHub → *Actions → iOS IPA → Run workflow*. Descarga el artefacto `AcademiaPass-unsigned-ipa` e
instálalo con [Sideloadly](https://sideloadly.io) usando tu Apple ID (la firma gratuita dura 7 días).

Con Mac y cuenta Apple Developer: `cd app-ios && ./build-ipa.sh TU_TEAM_ID` deja el IPA firmado en
`resources/iosapk/`. Para TestFlight: `METHOD=app-store-connect ./build-ipa.sh TU_TEAM_ID`.

## 5. Variables de entorno de la API

Ver `backend/.env.example`: `DATABASE_URL`, `PGSSL`, `JWT_SECRET` (obligatoria en producción),
`APP_TIMEZONE`, `ADMIN_SIGNUP_CODE`, `CORS_ORIGIN`, `PORT`.
