# Correos desde tu Gmail (RQ67)

Los recordatorios, avisos de vencimiento y solicitudes de cambio de horario salen **desde tu cuenta de Gmail**:
no hace falta un servidor ni un servicio de correos. Hay dos formas; elige según dónde corre la API.

| Dónde corre la API | Opción | Por qué |
|---|---|---|
| PC local (SQL Server) | **A. Contraseña de aplicación** | Lo más simple; tu PC sí puede usar SMTP |
| Render plan **free** | **B. API de Gmail** | Render free bloquea los puertos SMTP (25, 465, 587) desde sept. 2025; la API de Gmail va por HTTPS |
| Render pagado / Oracle | A o B | Ambas funcionan |

Las claves se guardan **solo** como variables de entorno (Render: *Environment*; PC: variables de usuario de
Windows). Nunca en el código, en git ni en el chat. Gmail personal permite unos 500 correos al día.

## Opción A: contraseña de aplicación (SMTP de Gmail)

1. En tu cuenta de Google activa la **verificación en 2 pasos** (myaccount.google.com > Seguridad).
2. Entra a **myaccount.google.com/apppasswords**, crea una con el nombre `AcademiaPass` y copia los 16 caracteres.
3. Variables de entorno:

   | Variable | Valor |
   |---|---|
   | `GMAIL_USER` | `tucorreo@gmail.com` |
   | `GMAIL_APP_PASSWORD` | Los 16 caracteres (con o sin espacios) |

   En el PC (PowerShell, una sola vez; luego reinicia el servidor local):
   ```
   [Environment]::SetEnvironmentVariable('GMAIL_USER', 'tucorreo@gmail.com', 'User')
   [Environment]::SetEnvironmentVariable('GMAIL_APP_PASSWORD', 'xxxx xxxx xxxx xxxx', 'User')
   ```

## Opción B: API de Gmail (HTTPS, sirve en Render free)

Se hace una vez y tarda unos 15 minutos.

1. **Proyecto en Google Cloud:** console.cloud.google.com > *Nuevo proyecto* `AcademiaPass`.
2. **Activar la API:** *APIs y servicios > Biblioteca* > **Gmail API** > *Habilitar*.
3. **Pantalla de consentimiento:** *APIs y servicios > Pantalla de consentimiento de OAuth* > tipo **Externo**,
   nombre `AcademiaPass`, tu correo como soporte y contacto. En *Usuarios de prueba* agrega tu Gmail. Luego pulsa
   **Publicar la app** (estado *En producción*): si queda en *Prueba*, el permiso vence a los 7 días. Como solo la
   usas tú, no necesitas la verificación de Google (verás un aviso de "app no verificada" al autorizar).
4. **Credenciales:** *Credenciales > Crear credenciales > ID de cliente de OAuth* > tipo **Aplicación web**, y en
   *URI de redireccionamiento autorizados* agrega `https://developers.google.com/oauthplayground`. Copia el
   **ID de cliente** y el **secreto**.
5. **Refresh token:** abre developers.google.com/oauthplayground:
   - Engranaje (arriba a la derecha) > marca *Use your own OAuth credentials* y pega el ID y el secreto.
   - En *Step 1* escribe el permiso `https://www.googleapis.com/auth/gmail.send` > *Authorize APIs* > entra con tu
     Gmail y acepta (aunque diga "app no verificada": *Avanzado > Ir a AcademiaPass*).
   - *Step 2* > **Exchange authorization code for tokens** > copia el **Refresh token** (empieza por `1//`).
6. Variables de entorno (en Render: servicio > *Environment*):

   | Variable | Valor |
   |---|---|
   | `GMAIL_USER` | `tucorreo@gmail.com` |
   | `GMAIL_CLIENT_ID` | ID de cliente (`….apps.googleusercontent.com`) |
   | `GMAIL_CLIENT_SECRET` | Secreto del cliente |
   | `GMAIL_REFRESH_TOKEN` | Refresh token (`1//…`) |

El permiso `gmail.send` solo deja **enviar** correos: la app no puede leer tu bandeja.

## Remitente y enlaces

- El remitente es `AcademiaPass <GMAIL_USER>`. Para otro nombre: `MAIL_FROM=Mi Academia <tucorreo@gmail.com>`
  (con Gmail la dirección debe ser la tuya).
- `PUBLIC_URL` (opcional): dirección pública para los enlaces de los correos, p. ej. el enlace con el que un
  profesor acepta un cambio de horario (RQ66). En Render es la del servicio; con el servidor local el enlace solo
  abre dentro de tu red Wi-Fi.

## Probar

En la app: **Correos automáticos** muestra desde qué cuenta salen los correos; **Enviarme un correo de prueba** lo
manda a tu correo de *Mi perfil*. Si falla, el mensaje dice por qué (p. ej. contraseña de aplicación inválida o
refresh token vencido).
