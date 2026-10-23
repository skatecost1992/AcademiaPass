# Despliegue en Railway (siempre en línea)

La API y la versión web corren en Railway con el plan **Hobby** (pago mensual pequeño; revisa railway.com/pricing).
El servicio no se apaga, así que los recordatorios por correo y el descuento de inasistencias corren cada
5 minutos. La base sigue en **Neon** y los correos salen por la API de **Resend** (Railway bloquea SMTP en el
plan Hobby, pero permite HTTPS). Railway publica solo cada push a GitHub.

```
Teléfonos / navegador ──HTTPS──> Railway (Dockerfile: API + web) ──> Neon (PostgreSQL)
                                                     └──────────────> Resend (correos)
```

El repositorio ya trae lo necesario: `Dockerfile` (compila la web y arranca la API) y `railway.json` (usa ese
Dockerfile, revisa `/api/health` y reinicia si falla).

## Lo que debes crear tú

| # | Qué | Dónde | Resultado |
|---|---|---|---|
| 1 | Cuenta de Railway (entra con GitHub) y plan **Hobby** | railway.com | — |
| 2 | Proyecto desde el repositorio `skatecost1992/AcademiaPass` | Railway | Servicio compilando |
| 3 | Variables del servicio | Railway > servicio > *Variables* | — |
| 4 | Dominio público | Railway > servicio > *Settings > Networking* | `https://….up.railway.app` (me lo pasas) |
| 5 | Cuenta Resend, API key y dominio verificado (o Brevo) | resend.com | `RESEND_API_KEY`, `MAIL_FROM` |

Las claves se pegan **solo** en Railway (*Variables*); no las subas a git ni las pegues en el chat.

## Paso a paso

1. **Cuenta:** railway.com > *Login with GitHub*. En *Account > Plans* activa **Hobby**.
2. **Proyecto:** *New Project > Deploy from GitHub repo* > autoriza la app de Railway en GitHub (puede ser solo
   para el repositorio AcademiaPass) > elige `AcademiaPass`. Railway detecta `railway.json` y el `Dockerfile`.
3. **Región:** servicio > *Settings > Deploy > Region*: **US East** (Neon está en `us-east-2`, Ohio; menos
   latencia).
4. **Variables** (servicio > *Variables > New Variable*, o *Raw Editor*):

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | Cadena de conexión de Neon (`postgresql://…?sslmode=require`) |
   | `JWT_SECRET` | `${{secret(64)}}` (Railway genera una clave aleatoria) |
   | `APP_TIMEZONE` | `America/Bogota` |
   | `NODE_ENV` | `production` |
   | `RESEND_API_KEY` | Clave de Resend (`re_…`) |
   | `MAIL_FROM` | `AcademiaPass <avisos@tu-dominio.com>` (dominio verificado en Resend) |
   | `ADMIN_SIGNUP_CODE` | Opcional: código para registrar organizaciones |

   Sin dominio propio para Resend, usa **Brevo**: `BREVO_API_KEY` en lugar de `RESEND_API_KEY` y en `MAIL_FROM`
   el correo que verificaste en Brevo (puede ser tu Gmail).
5. **Dominio:** servicio > *Settings > Networking > Generate Domain*. Si pide puerto, pon **8080**. Queda
   `https://academiapass-production-xxxx.up.railway.app` (luego puedes cambiar el nombre o usar un dominio propio).
6. **Siempre encendido:** en *Settings > Deploy*, deja **desactivado** *Serverless / App Sleeping*.
7. **Probar:** abre `https://TU_DOMINIO/api/health`: debe responder `"ok":true` con `"provider":"Neon"`. La primera
   compilación tarda 5–10 minutos (*Deployments > View logs*).
8. **Correo de prueba:** entra a `https://TU_DOMINIO` con `admin`, ve a **Correos automáticos > Enviarme un correo
   de prueba** (tu usuario debe tener correo en *Mi perfil*).

Pásame el dominio: cambio `apiUrlCloud` en las apps y genero la versión 1.0.15 (APK e IPA).

## Operación

| Tarea | Dónde |
|---|---|
| Publicar una versión nueva | Automático con cada push a GitHub |
| Ver el registro (`[ingreso]`, `[correo]`) | servicio > *Deployments* > *View logs* |
| Cambiar variables | servicio > *Variables* (redespliega solo) |
| Consumo y costo | *Usage* en el proyecto; pon un límite en *Account > Usage Limits* |

El servicio de Render (`render.yaml`) queda solo como alternativa; puedes eliminarlo en Render para no confundir.
