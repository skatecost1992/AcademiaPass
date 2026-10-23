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
- **Motores de base de datos**: PostgreSQL en la nube (`DATABASE_URL`), SQL Server en local (`DB_CLIENT=mssql`,
  adaptador `src/db-mssql.ts`, esquema `sql/sqlserver/02_esquema.sql`) o PGlite para desarrollo. El SQL de las
  rutas es común a los dos motores; ver `docs/SERVIDORES_Y_BASE_LOCAL.md`.
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
- `notifications`: correos automáticos enviados (RQ63, RQ64); índice único `(user_id, kind, ref_id)` para no
  repetir un aviso. Parámetros en `tenants.notify_*`, `plan_notice_days` y preferencias en `users.notify_*`.

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
| Correos | `GET/PUT /notification-settings`, `GET/PUT /me/notifications`, `GET /notifications`, `POST /notifications/test`, `POST /notifications/run` |
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
| 30 Solo se reserva lo definido por el admin | `POST /me/class-reservations` solo acepta sesiones `kind=class` programadas, en espacios activos con aforo |
| 31 Reservar exige plan con la sede y el tipo | `assertClientPlan` (`routes/reservations.ts`): clases → plan de clases/mixto; espacios → plan de reservas/mixto |
| 32 Cancelar hasta el límite del admin | `tenants.cancel_hours`, `GET/PUT /settings`, pantalla *Reglas de reserva*; `assertCanCancel` |
| 33 Info e imágenes del espacio al elegir sede y salón | `SpaceInfo` en `BookingForm` (descripción, fotos, aforo, horario) |
| 34 Pagos asociados a un cliente y a un plan | `POST /payments` exige `membershipId` (de él salen cliente y plan); `bookingId` opcional y del mismo cliente |
| 36 Agendar solo en horarios habilitados | `assertWithinOpeningHours`: sede sin horario → `NO_OPENING_HOURS`; fuera de franja → `OUT_OF_HOURS` con el horario del día |
| 37 Aforo completo: comunicar a quien autoriza | `CAPACITY_FULL` trae `contacts`; `capacity_requests`, `POST /attendance/requests`, aprobar/rechazar (`override_capacity`), pantalla *Autorizaciones* |
| 39 Validar ingreso el mismo día desde 1 h antes hasta el final | `performScan`: `ENTRY_WINDOW_MS` = 1 h, mismo día local; si no → `OUT_OF_TIME` con la franja válida |
| 40 Reservar solo en la disponibilidad del espacio | `spaces.opening_hours` (NULL = el de la sede), debe caber en el de la sede (`SPACE_HOURS`); se valida al agendar |
| 41 Reporte de clases reservadas y tomadas | `GET /reports/classes`: personal con `reports` ve todo; el cliente solo lo suyo (pestaña *Clases* y *Mi reporte*) |
| 42 Espacio ocupado: indicar horarios disponibles | `freeSlots` (`lib/scheduling.ts`), `GET /spaces/:id/availability`; el error `SPACE_TAKEN` trae `available` |
| 43 Reserva de espacio con fecha/desde/hasta; clases con horario ya definido; sin cruces | Formulario de reserva; cupos solo sobre sesiones programadas; `assertSpaceAvailable` + `assertNoOverlap`; permisos `classes` y `bookings` |
| 44 Reglas de cancelación por menú con permiso asignable | Permiso `booking_rules`; `PUT /settings` lo exige; menú *Reglas de reserva* |
| 45 Reporte con clase, profesor, reserva y clases agendadas no tomadas | `/reports/classes`: `teacher_name`, `reserved`, estado `missed` |
| 46 Aforo consistente | Espacio multigrupo: grupos × integrantes = aforo (validación en `spaceBody`); grupo ≤ cupo por grupo y ≤ aforo |
| 47 Calendario y límite de meses para reservar | `tenants.booking_horizon_months`, `assertWithinHorizon` (`BEYOND_HORIZON`); componente `Calendar` |
| 48 Mis reservas ordenadas de la más reciente | `GET /me/reservations` ordena por `starts_at` descendente |
| 49 Estados y consulta por rango | Estados asistida/cancelada/eliminada/no asistió/pendiente; 20 más recientes; rango desde/hasta ≤ 1 año |
| 50 Reportes por mes y por año (máx. 1 año) | `range()` rechaza > 366 días (`RANGE_TOO_LONG`); `RangePicker` Mes/Año |
| 51 Clientes con más planes y asistencias | `GET /reports/top-clients`, pestaña *Top clientes* |
| 52 No cancelar tomadas/vencidas; inasistencia descuenta del plan | `ALREADY_TAKEN`/`EXPIRED`; `settleMissedReservations` cada 5 min (`class_reservations.settled_at`, `penalty_membership_id`) |
| 53 Plan con academias y sedes de acceso | `plan_academies`, `all_sites`/`plan_sites`; sección *Academias y sedes a las que da acceso* |
| 54 Ver el profesor al agendar | `BookingForm`: tarjeta con el profesor de la clase (se puede cambiar para la sesión) |
| 55 Vigencia en días (≤365) o meses (≤12) desde la fecha de ingreso | `plans.validity_months`; `ends_on` = ingreso + meses − 1 día o + días − 1 |
| 56 Fecha límite de venta del plan | `plans.sale_until`; `POST /memberships` → `PLAN_SALE_CLOSED`; los ya asignados siguen hasta su vencimiento |
| 58 Activación de nuevas organizaciones | `tenants.status` (pending/active/rejected), `users.is_superadmin` (usuario base `admin`), `/platform/tenants`, pantalla *Organizaciones*; `TENANT_APPROVAL=off` lo desactiva |
| 59 Cambiar de servidor sin abrir sesión | Pantalla *Servidor*: el admin solo autoriza; `setServer` + `signOut` |
| 60 Reservas del día sin datos del tomador | `GET /spaces/:id/availability` → `busy` (franja, "Reservado", cupos libres); el cliente no ve títulos ni nombres |
| 61 Clase con espacio y profesor | `classes.space_id`; `classBody` exige `teacherId` y `spaceId` de una sede de la academia; sesiones solo en ese espacio (`CLASS_SPACE`) |
| 62 Profesor por sede y sin cruces | `teacher_sites`; el profesor debe estar asignado a la sede (`TEACHER_SITE`) y no puede tener dos clases a la vez (`TEACHER_BUSY`) |
| 63 Recordatorio 1 día y 3 horas antes | `lib/notifications.ts` `sendReminders` (cada 5 min desde `server.ts`): cupos en clases y reservas de espacio que empiezan en ≤ 24 h; solo si se reservó antes de ese momento; una vez por aviso (`notifications`) |
| 65 Horario al crear la clase | `POST /classes` acepta `schedule` (`startsAt`, `endsAt`, `repeatWeeks`, `weekdays`): crea las sesiones con `createBookings` (aforo, horario, espacio y profesor libres); si una falla se borra la clase y se devuelven las franjas libres. `POST /bookings` también acepta `weekdays` |
| 66 Negociar cruces con otro profesor | `assertSlotAvailable` devuelve `clashes` (reservas y profesores con que choca); `POST /classes` con `schedule.skipConflicts` crea lo que cabe y devuelve `conflicts`. `schedule_requests` / `schedule_request_items` (`routes/scheduleRequests.ts`): `POST /schedule-requests`, respuesta del profesor por enlace con token (`GET/POST /schedule-requests/respond`, sin sesión) o del personal (`/:id/accept|reject|cancel`). Al aceptar mueve sus sesiones a la hora propuesta y crea las de la clase; si algo no cabe deshace todo |
| 67 Correos desde el Gmail del administrador | `lib/mailer.ts`: `GMAIL_USER` + `GMAIL_APP_PASSWORD` (SMTP de Gmail) o + `GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN` (API de Gmail por HTTPS, sirve en Render free que bloquea SMTP). Guía: `docs/CORREO_GMAIL.md` |
| 68 Hasta 15 fotos a la vez | `pickPhotos` (selección múltiple, máx. 15) y subida una por una con avance; máximo 30 fotos por sede o espacio (`MAX_PHOTOS_PER_OWNER`) |
| 69 Usuario del profesor | `users.teacher_id` (personal ligado al profesor; lo crea solo el admin desde `POST/PUT /teachers` con `account`, permisos entre `TEACHER_PERMISSIONS`, por defecto clases, reservas y asistencia). `assertOwnTeacher`: solo crea/edita sus clases, programa sus sesiones, separa espacios a su nombre, registra asistencia de sus clases y cancela sus sesiones hasta `tenants.teacher_cancel_hours` antes (`/settings`, permiso `booking_rules`, habilitable a cualquier usuario). `bookings.cancel_reason = 'teacher_absent'`. `GET /reports/teacher`: dictadas, aforo (asistentes/cupo), no asistidas, canceladas |
| 64 Aviso de vencimiento del plan | `sendPlanNotices`: plan por vencer (`plan_notice_days` antes, 0–30) y plan vencido (si no se renovó), con datos del plan, clases tomadas (`attendances.membership_id`) y reservadas pendientes; parámetros de la organización (permiso `notifications`) y de cada usuario (Mi perfil) |
| 38 No reservar en dos lugares a la vez | `assertNoOverlap`: cupos en clases y espacios del cliente que se crucen → `OVERLAP` |
| 35 Cancelación por academia y sede | `academies.cancel_hours`, `sites.cancel_hours` (NULL = hereda); `siteCancelHours`: sede → academia → organización |

## 7. Pruebas

`backend/test/api.test.ts` (node:test + PGlite en memoria) cubre registro, consentimiento, horarios, espacios
ocupados y multigrupo, fotos, planes por academia/sede, QR, descuento por academia, aforo con y sin permiso,
reportes, aislamiento entre organizaciones y correos automáticos (con un envío simulado). `npm test` en `backend/`.
La prueba elige una zona horaria en la que la hora local es cerca del mediodía, así el resultado no depende de
la hora a la que se ejecute. La CI (`.github/workflows/ci.yml`) las
corre en cada push junto con la verificación de tipos de las apps.

## 8. Mantenimiento

- Cambios de pantallas: editar `app-android/src` y ejecutar `sync-src.ps1` para copiarlos a `app-ios`.
- Cambios de esquema: agregar sentencias idempotentes (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) en
  `schema.ts`; se aplican al arrancar.
- Subir versión: `expo.version` y `android.versionCode` / `ios.buildNumber` en cada `app.json`.
