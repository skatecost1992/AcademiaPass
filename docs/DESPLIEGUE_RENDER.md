# Despliegue en Render (API + web) con Neon

Render construye la imagen del `Dockerfile` de la raíz (la API y la versión web, probada en modo producción) y la
publica en `https://<servicio>.onrender.com`. La base sigue en **Neon** y los correos salen por la API de **Resend**
o **Brevo** (Render bloquea SMTP en el plan free). Cada push a GitHub se publica solo.

```
Teléfonos / navegador ──HTTPS──> Render (Docker: API + web) ──> Neon (PostgreSQL)
UptimeRobot (cada 5 min) ──────────┘          └──────────────> Resend / Brevo (correos)
```

La versión web llega ya compilada en `backend/public` (el código de las apps solo está en el repositorio local). Si
cambias pantallas de la app: en el PC `cd app-android && npm run build:web`, commit de `backend/public` y push.

Si mantienes un servicio con entorno *Node* en vez de Docker, su *Build Command* debe ser solo
`cd backend && npm ci` (ya no existe `app-android` en GitHub) y su *Start Command* `cd backend && npm start`.

## Por qué el servicio anterior no respondía

El servicio `academiapass` se creó con el entorno *Node* y no quedó en estado **Live** (las peticiones no
responden). Render no permite cambiar un servicio existente de Node a Docker, así que se crea uno nuevo.

## Lo que debes hacer tú

1. **Eliminar el servicio anterior:** dashboard.render.com > `academiapass` > *Settings* > *Delete Web Service*.
   Así el nombre `academiapass` queda libre y, si Render lo vuelve a asignar, la URL
   `https://academiapass.onrender.com` (la que ya usan las apps) sigue igual.
2. **Crear el Blueprint:** *New > Blueprint* > repositorio `skatecost1992/AcademiaPass` (rama `main`). Render lee
   `render.yaml` y pide las variables marcadas como secretas:

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | Cadena de conexión de Neon (`postgresql://…?sslmode=require`) |
   | `RESEND_API_KEY` | Clave de Resend (`re_…`), o vacía si usas Brevo |
   | `BREVO_API_KEY` | Clave de Brevo, o vacía si usas Resend |
   | `MAIL_FROM` | `AcademiaPass <avisos@tu-dominio.com>` (dominio verificado en Resend, o el correo verificado en Brevo) |
   | `ADMIN_SIGNUP_CODE` | Opcional |
   | `ADMIN_INITIAL_PASSWORD` | Clave del usuario base `admin` (mín. 8 caracteres); vacía = se genera y sale una vez en *Logs* |

   Sin `DATABASE_URL` el servicio se detiene al arrancar con un mensaje en *Logs*: en producción no usa la base
   embebida (PGlite), que perdería los datos en cada despliegue y supera los 512 MB del plan gratuito.

   `JWT_SECRET` la genera Render. Las claves se pegan **solo** en Render; no las subas a git ni al chat.
3. **Esperar el despliegue** (*Events / Logs*, la primera vez 5–10 min) hasta ver **Live** y abrir
   `https://TU_SERVICIO.onrender.com/api/health`: debe responder `"ok":true` con `"provider":"Neon"`.
4. **Mantenerlo despierto** (plan free): en **uptimerobot.com** (gratis) crea un monitor *HTTP(s)* con la URL
   `https://TU_SERVICIO.onrender.com/api/health` cada **5 minutos**. Así no se duerme y corren los recordatorios
   por correo y el descuento de inasistencias.
5. **Pásame la URL** si no quedó `https://academiapass.onrender.com`: cambio la dirección de la opción "Nube" en
   las apps y genero la versión 1.0.15.

### Horas gratis de Render

El plan free da 750 horas al mes **por cuenta**, compartidas entre todos los servicios free. Un servicio despierto
todo el mes usa ~744 h. Si tienes otro servicio free en la misma cuenta (por ejemplo la API de la hoja de vida),
no alcanzan para tener los dos despiertos siempre: en ese caso pasa AcademiaPass al plan **Starter** (pago; en
*Settings > Instance Type*) y no necesitas UptimeRobot.

## Operación

| Tarea | Dónde |
|---|---|
| Publicar una versión nueva | Automático con cada push a GitHub (*autoDeploy*) |
| Ver el registro (`[ingreso]`, `[correo]`) | servicio > *Logs* |
| Cambiar variables | servicio > *Environment* (redespliega) |
| Probar correos | En la app: **Correos automáticos > Enviarme un correo de prueba** |
