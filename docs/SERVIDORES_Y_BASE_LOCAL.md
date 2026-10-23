# Servidores (nube / local) y base de datos local en SQL Server

## 1. Las dos conexiones de la app

Están en `app-android/app.json` y `app-ios/app.json`, en `expo.extra`:

```json
"extra": {
  "apiUrlCloud": "https://academiapass.onrender.com",
  "apiUrlLocal": "http://192.168.1.173:8080",
  "defaultServer": "cloud"
}
```

| Parámetro | Para qué |
|---|---|
| `apiUrlCloud` | Servidor en internet (Render). Todos los teléfonos y la web ven los mismos datos. |
| `apiUrlLocal` | Backend corriendo en el PC `DESKTOP-FODDHQ6` (IP de la red Wi-Fi + puerto 8080). |
| `defaultServer` | Con cuál arranca la app recién instalada: `cloud` o `local`. |

Si cambias estos valores debes **recompilar el APK** (`build-apk.ps1`). La app siempre lee la URL vigente de
`app.json`: si recompilas con otra URL, los teléfonos que estaban en "Nube" o "Local" la toman solos.

## 2. Cambiar de servidor en el teléfono (solo admin)

1. En la pantalla de ingreso toca el texto inferior (`Nube · https://...`) o, con sesión iniciada,
   *Mi perfil → Cambiar servidor*.
2. Elige **Nube (web)**, **Local (red Wi-Fi)** u **Otra dirección**.
3. Escribe un **usuario administrador de ese servidor** y su clave, y pulsa *Validar y usar este servidor*.
   La app comprueba `/api/health` y luego valida el usuario contra la **tabla `users` de la base de ese
   servidor** (PostgreSQL en la nube o SQL Server local). Solo se acepta un usuario con rol `admin`. En el
   teléfono no se guarda ninguna clave.
4. Si es correcto, la app **solo cambia de servidor** (y de base de datos): no abre sesión con el administrador.
   Vuelve a la pantalla de ingreso para que cada persona entre con su usuario de ese servidor (RQ59).

### Usuario `admin` en la base

Al arrancar, el backend revisa la tabla `users`; si no existe el usuario `admin`, lo crea con su organización
("Mi organización"), una academia y una sede, y con la clave inicial **`Bogota.2027`** guardada como hash
bcrypt, igual que cualquier otro usuario (`src/bootstrap.ts`). Así hay un `admin` en cada base: la de la nube y
la local de SQL Server.

- Cambia la clave en la app: *Mi perfil → Contraseña*. Queda guardada en la base de ese servidor y sirve desde
  cualquier teléfono.
- Los usuarios que se registran (clientes, administradores de otras organizaciones, personal) también se guardan
  en la tabla `users` de la base del servidor al que está conectada la app, con su clave cifrada, y se
  autentican contra esa misma base.
- Variables opcionales del backend: `ADMIN_USERNAME`, `ADMIN_INITIAL_PASSWORD` (solo al crearlo) y
  `ADMIN_ORG_NAME`.

La versión web no muestra el selector: siempre usa el servidor desde el que se abrió.

## 3. Usar el servidor local

En el PC:

```powershell
cd AcademiaPass\backend
npm start
```

- El teléfono debe estar en la **misma red Wi-Fi** que el PC.
- La primera vez Windows pregunta si permite a Node.js en la red: acepta para **redes privadas**.
- Si la IP del PC cambia (`ipconfig`), usa *Otra dirección* o actualiza `apiUrlLocal` y recompila.

Con `npm start` el backend local guarda los datos con **PGlite** (PostgreSQL embebido) en `backend/.data/`.
Para guardarlos en tu **SQL Server** arráncalo con `iniciar-local-sqlserver.ps1` (punto 5).

## 4. Crear la base de datos en SQL Server (DESKTOP-FODDHQ6)

Scripts en `backend/sql/sqlserver/`:

| Archivo | Qué hace |
|---|---|
| `01_crear_base.sql` | Crea la base `AcademiaPass`, el login `academiapass_app` y le da permisos de lectura, escritura y creación de tablas. |
| `02_esquema.sql` | Crea las 17 tablas, índices y restricciones (equivalente T-SQL del esquema PostgreSQL). Es idempotente. |
| `crear-base-sqlserver.ps1` | Ejecuta los dos scripts con `sqlcmd` y prueba la conexión. |

**Credenciales en variables de entorno** del equipo dueño de la base (nunca en archivos). En PowerShell como
ese usuario de Windows:

```powershell
[Environment]::SetEnvironmentVariable('ACADEMIAPASS_SQL_USER', 'sa', 'User')
[Environment]::SetEnvironmentVariable('ACADEMIAPASS_SQL_PASSWORD', '<clave de sa>', 'User')
[Environment]::SetEnvironmentVariable('ACADEMIAPASS_APP_PASSWORD', '<clave nueva para academiapass_app>', 'User')
```

- `ACADEMIAPASS_SQL_USER` / `ACADEMIAPASS_SQL_PASSWORD`: administrador que crea la base. Si no las defines, el
  script usa la autenticación de Windows del usuario actual.
- `ACADEMIAPASS_APP_PASSWORD`: clave del login `academiapass_app` (debe cumplir la política de claves de SQL
  Server). Es el usuario con el que se conectará la aplicación, no `sa`.
- Opcional `ACADEMIAPASS_SQL_SERVER` (por defecto el nombre del equipo).

Cierra y abre la terminal para que tome las variables y ejecuta:

```powershell
powershell -ExecutionPolicy Bypass -File AcademiaPass\backend\sql\sqlserver\crear-base-sqlserver.ps1
```

Solo probar la conexión: agrega `-SoloProbar`. Al final imprime la cadena de conexión (sin la clave):

```
Data Source=DESKTOP-FODDHQ6;Initial Catalog=AcademiaPass;User ID=academiapass_app;Password=<ACADEMIAPASS_APP_PASSWORD>;Encrypt=True;TrustServerCertificate=True
```

## 5. Arrancar el servidor local con SQL Server

El backend soporta los dos motores con el mismo código: **PostgreSQL** en la nube y **SQL Server** en local.
El motor se elige con la variable `DB_CLIENT=mssql`; el script la pone por ti:

```powershell
cd AcademiaPass\backend
powershell -ExecutionPolicy Bypass -File iniciar-local-sqlserver.ps1          # o: npm run start:sqlserver
powershell -ExecutionPolicy Bypass -File iniciar-local-sqlserver.ps1 -Seed    # primera vez, con datos demo
```

Lee de las variables de entorno `ACADEMIAPASS_APP_PASSWORD` (obligatoria), `ACADEMIAPASS_SQL_SERVER`,
`ACADEMIAPASS_DB_NAME` y `ACADEMIAPASS_APP_USER`, y muestra la IP que debes usar en el teléfono.

Luego, en el teléfono (Android o iOS): *Servidor* → usuario `admin` → **Local (red Wi-Fi)** → *Probar y usar*.
Desde ese momento todo lo que se registre en el teléfono (academias, clientes, pagos, asistencias, fotos…) queda
en la base `AcademiaPass` de SQL Server.

Cómo funciona por dentro (`src/db-mssql.ts`): las consultas están escritas en SQL común a los dos motores y el
adaptador traduce lo poco que cambia (`$1`→`@p1`, `RETURNING`→`OUTPUT INSERTED`, `LIMIT`→`OFFSET/FETCH`,
`true/false`→`1/0`). Las agrupaciones por semana/mes de los reportes se calculan en Node con la zona
`APP_TIMEZONE`, y los borrados de sede/espacio/academia se hacen en orden (`src/lib/cleanup.ts`) porque SQL
Server no admite varias rutas de cascada.

**Pruebas**: `npm run test:sqlserver` crea una base temporal `AcademiaPass_test` con autenticación de Windows,
corre las 13 pruebas de la API y la elimina. `npm test` corre las mismas pruebas con PGlite.
