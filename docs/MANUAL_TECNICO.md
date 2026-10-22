# Manual técnico — AcademiaPass

## 1. Arquitectura

```
 Android (APK)  ─┐
 iOS (IPA)      ─┼─ HTTPS/JSON ──►  API Node.js (Express 5)  ──►  PostgreSQL en la nube
 Web (navegador)─┘                  backend/src                    (Render, Neon, Supabase)
                                    + sirve la web (backend/public)
```

- **Un solo código de app** (Expo SDK 58 + Expo Router, TypeScript) en `app-android/src`, copiado a
  `app-ios/src` con `sync-src.ps1`. La web se exporta desde `app-android` (`npm run build:web`) a
  `backend/public`, así la web y la API comparten dominio.
- **Datos solo en la nube** (RQ24, RQ27): el teléfono guarda únicamente la URL del servidor y el token de sesión.
  Al instalar la app en otro teléfono e iniciar sesión se ve la misma información.
- **Backend** Node 24 ejecuta TypeScript directamente (sin compilar). Dependencias: `express`, `pg`, `zod`,
  `jsonwebtoken`, `bcryptjs`, `express-rate-limit`, `cors` y `@electric-sql/pglite` (PostgreSQL embebido para
  desarrollo y pruebas, cuando no hay `DATABASE_URL`).

## 2. Multi-organización y privacidad (RQ25, RQ26)

| Concepto | Tabla | Regla |
|---|---|---|
| Organización de un administrador | `tenants` | Todo dato de negocio lleva `tenant_id`; cada consulta filtra por el tenant del usuario. Un id de otra organización responde 404. |
| Persona real | `persons` (documento único) | Una persona puede tener una cuenta por organización. |
| Cuenta | `users` (usuario global único) | Si un cliente se registra en una academia de otro administrador crea usuario y contraseña nuevos; se liga a la misma persona, pero cada cuenta solo ve los datos de su organización. |

El QR de un cliente de otra organización se rechaza como "cliente no registrado".

## 3. Modelo de datos (`backend/src/schema.ts`)

- `academies` (RQ12) con `join_code` para que los clientes se inscriban.
- `sites` sedes por academia con `opening_hours` (RQ2, RQ10).
- `spaces` con `max_capacity`, `allow_multi_group`, `max_groups`, `capacity_per_group` (RQ19).
- `photos` fotos de sedes y espacios en Base64 (RQ29).
- `teachers` `internal` / `external` (RQ5). `classes` con profesor y cupo (RQ3).
- `bookings`: ocupación de espacios. `kind=class` (sesión de clase con hora desde/hasta) o `kind=rental`
  (reserva para un cliente o para la clase de un profesor externo/interno).
- `plans` con `kind` (clases, reservas, acceso/asesorías, mixto), `units` (NULL = ilimitado), vigencia, precio,
  `plan_academies` y `all_sites`/`plan_sites` (RQ7, RQ11, RQ12).
- `memberships`: plan adquirido por un cliente; copia unidades y vigencia.
- `client_academies`: academias a las que está asociado el cliente (RQ13).
- `payments`: siempre ligados a un `membership_id` o a un `booking_id`, nunca a ambos (CHECK, RQ4, RQ6).
- `attendances`: ingresos registrados con QR o manualmente, con `over_capacity` (RQ7, RQ20, RQ21).

## 4. Reglas principales

**Reservas y aforo** (`lib/capacity.ts`):
1. Debe caber en el horario de atención de la sede, si está configurado (zona `APP_TIMEZONE`).
2. Espacio de un grupo: si ya hay una reserva que se cruza, se rechaza "ya está reservado" (RQ18).
3. Espacio multigrupo: máximo `max_groups` reservas a la vez, `capacity_per_group` personas por grupo y
   `max_capacity` en total.
4. Repetición semanal (hasta 26 semanas): si una semana choca no se guarda ninguna.

**Ingreso con QR** (`routes/attendance.ts`, RQ7, RQ16, RQ20):
1. El personal elige academia, sede y opcionalmente la clase/reserva del momento.
2. El QR es un JWT firmado que vence a los 5 minutos y la app lo renueva sola.
3. Se busca el plan vigente con saldo que cubra esa academia y sede y ese tipo de ingreso:
   clase → planes de clases o mixtos; reserva → reservas o mixtos; ingreso general → acceso, clases o mixtos.
   Si hay varios, se usa el que vence primero. Así, con un plan en la academia A y otro en la B, cada ingreso
   descuenta del plan correspondiente (RQ16).
4. Una reserva propia ya pagada no descuenta del plan.
5. Si la clase llegó a su cupo o el espacio a su aforo responde `CAPACITY_FULL`; solo un usuario con el permiso
   `override_capacity` puede registrar el ingreso por fuera del aforo (queda marcado).
6. El descuento es atómico (`UPDATE ... WHERE units_used < units_total`), sin carreras entre dos lectores.

**Permisos** (RQ17, RQ23): `admin` tiene todos; `client` solo sus datos y su QR; `staff` los que el admin
marque: `attendance`, `schedules`, `classes`, `bookings`, `clients`, `plans`, `payments`, `reports`,
`capacity_reports`, `override_capacity`. Se leen de la base en cada petición: un cambio aplica de inmediato.

**Fotos** (RQ29): la app reduce la foto a máximo 1600 px y la comprime en JPEG 0.8 (`lib/photos.ts`), con buena
calidad y ~200–500 KB. Se guarda en Base64 en `photos.data`. Las listas solo traen metadatos; cada imagen se
descarga al mostrarse (`GET /api/photos/:id`) y queda en caché en memoria. Límite 2,5 MB y 10 fotos por sede o
espacio.

**Tratamiento de datos** (RQ14): casilla obligatoria en el registro (`consent: true`); la API guarda fecha y
versión. Un cliente creado por el personal la acepta en su primer ingreso (pantalla `consent`).

## 5. API (prefijo `/api`)

| Grupo | Rutas |
|---|---|
| Sesión | `POST /auth/login`, `/auth/register-admin`, `/auth/register-client`; `GET/PUT /me`; `POST /me/consent`, `/me/password`, `/me/academies`; `GET /me/qr` |
| Parametrización | `/academies`, `/sites`, `/spaces`, `/photos`, `/teachers`, `/classes` (GET/POST/PUT, DELETE donde aplica) |
| Agenda | `GET /bookings`, `GET /bookings/:id`, `POST /bookings`, `POST /me/bookings`, `POST /bookings/:id/cancel` |
| Comercial | `/plans`, `/clients`, `POST /memberships`, `POST /memberships/:id/cancel`, `GET/POST /payments`, `/users` |
| Ingresos | `POST /attendance/scan`, `GET /attendance`, `DELETE /attendance/:id` |
| Reportes | `GET /reports/me`, `/reports/clients/:id/unified`, `/reports/attendance`, `/reports/capacity`, `/reports/payments`, `/reports/summary` |

Todos los reportes aceptan `from`, `to` (AAAA-MM-DD), `academyId`, `siteId` y `groupBy=week|month`.

## 6. Trazabilidad de requisitos

| RQ | Dónde |
|---|---|
| 1 Web, Android, iOS | Expo (`app-android`, `app-ios`), web servida por el backend |
| 2 Horarios de atención, clases, espacios y reservas | `sites.opening_hours`, `bookings`; pantallas Sedes, Agenda |
| 3 Clase, profesor, hora desde/hasta | `classes`, `bookings.starts_at/ends_at` |
| 4 Pagos | `payments`; pantallas Pagos, ficha del cliente, reserva |
| 5 Profesor interno o externo | `teachers.kind`; reserva para profesor |
| 6 Pago asociado a plan o reserva | CHECK en `payments` |
| 7 Planes con número de clases; registro de clientes; QR que descuenta | `plans`, `memberships`, `register-client`, `my-qr`, `scan` |
| 8 Cliente ve solo su plan, faltantes, días y semanal/mensual | `/reports/me`, pantalla Mi reporte |
| 9 Admin ve reportes de todos | `/reports/*`, pantalla Reportes |
| 10 Sedes: horarios, clases, clientes y reportes por sede | filtro `siteId` en agenda, clientes y reportes; `users.home_site_id` |
| 11 Sedes permitidas por plan | `plans.all_sites`, `plan_sites` |
| 12 Varias academias; plan con acceso entre academias | `academies`, `plan_academies` |
| 13 Un registro, varias academias | `client_academies` (al adquirir plan o con código) |
| 14 Tratamiento de datos | `ConsentText`, `consent_at` |
| 15 Reporte unificado en PDF | `unifiedReport`, `lib/report.ts`, `lib/pdf.ts` |
| 16 Descuento según la academia que se escanea | Selección previa de academia/sede + regla de cobertura |
| 17 Usuarios con permisos | `/users`, `permissions` |
| 18 Espacio ya reservado | `assertSpaceAvailable` → `SPACE_TAKEN` |
| 19 Aforo y varios grupos | `spaces.*` |
| 20 Aforo completo y excepción con permiso | `CAPACITY_FULL`, `override_capacity` |
| 21 Reporte de aforo semanal/mensual por QR | `/reports/capacity` |
| 22 Reporte que agrupa | `/reports/summary` + PDF general |
| 23 Roles base admin y cliente | `users.role` |
| 24, 27 Datos en la nube | PostgreSQL con `DATABASE_URL`, `render.yaml` |
| 25 Aislamiento entre administradores | `tenant_id` en todo |
| 26 Nueva cuenta por organización ligada a la persona | `persons` + `users` |
| 28 APK e iOS | `build-apk.ps1`, `.github/workflows/ios-ipa.yml`, `build-ipa.sh` |
| 29 Fotos en Base64 | `photos`, `PhotoGallery` |

## 7. Pruebas

`backend/test/api.test.ts` (node:test + PGlite en memoria) cubre registro, consentimiento, horarios, espacios
ocupados y multigrupo, fotos, planes por academia/sede, QR, descuento por academia, aforo con y sin permiso,
reportes y aislamiento entre organizaciones. `npm test` en `backend/`. La CI (`.github/workflows/ci.yml`) las
corre en cada push junto con la verificación de tipos de las apps.

## 8. Mantenimiento

- Cambios de pantallas: editar `app-android/src` y ejecutar `sync-src.ps1` para copiarlos a `app-ios`.
- Cambios de esquema: agregar sentencias idempotentes (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) en
  `schema.ts`; se aplican al arrancar.
- Subir versión: `expo.version` y `android.versionCode` / `ios.buildNumber` en cada `app.json`.
