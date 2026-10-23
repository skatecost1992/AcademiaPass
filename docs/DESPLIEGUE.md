# Despliegue y compilación

> **Servidor siempre en línea:** [DESPLIEGUE_RAILWAY.md](DESPLIEGUE_RAILWAY.md) (Railway Hobby, recomendado) o
> [DESPLIEGUE_ORACLE.md](DESPLIEGUE_ORACLE.md) (máquina virtual gratuita de Oracle con Docker y HTTPS). El plan
> gratis de Render se apaga sin uso y no sirve para los correos automáticos.

## 1. Base de datos (Neon) y API + web en la nube (Render)

La cuenta gratuita de Render solo permite **una** base de datos activa (ya usada por otro proyecto), así que
AcademiaPass usa **PostgreSQL en Neon** (gratis y sin vencimiento) y Render solo aloja el servicio web.

**Una sola base para todo:** la web (`https://<servicio>.onrender.com`) y las apps Android/iOS en la opción
**Nube** llaman a la misma API de Render, que usa una única `DATABASE_URL`. Lo que se registra desde cualquiera
de ellas se ve en las demás.

1. **Neon**: entra a https://neon.tech con tu cuenta de GitHub → *Create project* (nombre `academiapass`,
   región *AWS US East* o la más cercana) → copia la **Connection string** (empieza por `postgresql://` y
   termina en `?sslmode=require`). No la guardes en el repositorio.
2. **Render**: **New → Blueprint** → repositorio `AcademiaPass`. Render lee `render.yaml` y crea solo el
   servicio web `academiapass`. Te pedirá:
   - `DATABASE_URL`: pega la cadena de Neon.
   - `ADMIN_SIGNUP_CODE`: opcional (vacío = cualquiera puede registrar una organización).
3. Pulsa **Apply** y espera el estado **Live**. Abre `https://<servicio>.onrender.com/api/health`: debe
   responder `{"ok":true,...}`. Al arrancar se crean las tablas y el usuario `admin` (clave inicial
   `Bogota.2027`) en la base de Neon.
4. Si ya habías creado el Blueprint y falló, ábrelo y pulsa **Manual sync** después de subir este cambio.

Notas:
- El plan gratuito de Render "duerme" el servicio tras 15 minutos sin uso (el primer acceso tarda ~1 minuto).
- Para datos de prueba en la nube: con `DATABASE_URL` de Neon en tu terminal, `npm run seed` desde `backend/`.

## 2. Apuntar las apps al servidor

- **Web**: la misma URL de Render (`https://academiapass.onrender.com`). En el celular se puede agregar a la
  pantalla de inicio.
- **Android / iOS**: `expo.extra.apiUrlCloud` (nube) y `apiUrlLocal` (PC local) en cada `app.json`. En el
  teléfono, el usuario de configuración `admin` elige entre ellas. Detalle en
  [`SERVIDORES_Y_BASE_LOCAL.md`](SERVIDORES_Y_BASE_LOCAL.md).

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

### Correos (RQ63, RQ64)

Los recordatorios y avisos de vencimiento salen por la API de **Resend** (`RESEND_API_KEY`), la de **Brevo**
(`BREVO_API_KEY`) o por SMTP, en ese orden de prioridad, con el remitente `MAIL_FROM`. Las APIs funcionan aunque
el servidor bloquee los puertos SMTP. Se configuran solo como variables de entorno (en Oracle: `deploy/oracle/.env`;
en el PC local: variables de usuario de Windows), nunca en el código. Para SMTP:

| Variable | Ejemplo | Nota |
|---|---|---|
| `SMTP_HOST` | `smtp.gmail.com` | Sin esta variable los correos solo quedan registrados (estado "Sin SMTP") |
| `SMTP_PORT` | `587` | 465 usa SSL directo |
| `SMTP_SECURE` | `false` | Opcional; por defecto `true` solo con el puerto 465 |
| `SMTP_USER` | `academia@tudominio.com` | Usuario de la cuenta de envío |
| `SMTP_PASS` | (secreto) | Con Gmail, una *contraseña de aplicación* (requiere verificación en 2 pasos) |
| `MAIL_FROM` | `AcademiaPass <academia@tudominio.com>` | Remitente; por defecto `SMTP_USER` |

Después de configurarlas, en la app: **Correos automáticos > Enviarme un correo de prueba**.
