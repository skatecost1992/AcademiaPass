# AcademiaPass

Gestión de academias: sedes, espacios con aforo, clases y profesores, reservas, planes, pagos, ingreso con
código QR y reportes. Funciona en **web, Android e iOS** con los mismos datos guardados en una base de datos
PostgreSQL en la nube.

```
AcademiaPass/
├── backend/        API Node.js (Express 5 + PostgreSQL). También sirve la versión web.
├── app-android/    App Expo (React Native) para Android y web. build-apk.ps1 genera el APK.
├── app-ios/        La misma app para iOS (mismo src/). build-ipa.sh o GitHub Actions generan el IPA.
├── resources/      androidapk/ (APK) e iosapk/ (IPA)
├── docs/           Manual técnico, despliegue y guía de uso
├── render.yaml     Despliegue en Render (API + web + PostgreSQL)
└── sync-src.ps1    Copia app-android/src a app-ios/src
```

## Empezar en local (sin instalar PostgreSQL)

```bash
cd backend
npm install
npm run seed      # organización demo
npm start         # http://localhost:8080
```

Sin `DATABASE_URL` la API usa PGlite (PostgreSQL embebido) en `backend/.data/`. Usuarios demo (contraseña
`Demo.2026`): `admin.demo`, `recepcion.demo`, `cliente.demo`, `cliente2.demo`.

Versión web: `cd app-android && npm install --legacy-peer-deps && npm run build:web` y abre http://localhost:8080.

## Nube y teléfonos

1. Sube la carpeta a GitHub y crea el Blueprint de `render.yaml` en Render (o usa Neon/Supabase para la base).
2. En la app, en *Configurar servidor* (pantalla de ingreso), escribe la URL pública, p. ej.
   `https://academiapass.onrender.com`. Todos los teléfonos y la web ven los mismos datos.

Paso a paso en [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md). Selector nube/local (usuario de configuración `admin`)
y base en SQL Server en [`docs/SERVIDORES_Y_BASE_LOCAL.md`](docs/SERVIDORES_Y_BASE_LOCAL.md). Arquitectura, modelo de datos y reglas en
[`docs/MANUAL_TECNICO.md`](docs/MANUAL_TECNICO.md). Uso por rol en [`docs/GUIA_DE_USO.md`](docs/GUIA_DE_USO.md).

## Pruebas

```bash
cd backend && npm test          # 12 escenarios de punta a punta sobre la API
cd app-android && npx tsc --noEmit
```
