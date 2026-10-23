# Despliegue en Oracle Cloud Always Free (siempre en línea)

La API y la versión web corren en una máquina virtual gratuita de Oracle, encendida 24/7 (los recordatorios por
correo y el descuento de inasistencias corren cada 5 minutos). La base sigue en **Neon** y los correos salen por
**Resend** (o Brevo). La máquina no guarda datos: si se daña, se crea otra y se repite la instalación.

```
Teléfonos / navegador ──HTTPS──> Caddy (443) ──> API + web (Docker) ──> Neon (PostgreSQL)
                                                        └──> Resend (correos)
```

## Lo que debes crear tú

| # | Qué | Dónde | Resultado que necesito |
|---|---|---|---|
| 1 | Cuenta Oracle Cloud (pide tarjeta para verificar; no cobra si te quedas en *Always Free*) | cloud.oracle.com | — |
| 2 | Máquina virtual Ubuntu (pasos abajo) | Consola de Oracle | **IP pública** |
| 3 | Dominio gratis que apunte a la IP | duckdns.org (entra con Google/GitHub) | p. ej. `academiapass.duckdns.org` |
| 4 | Cuenta Resend + API key + dominio verificado para el remitente | resend.com | `RESEND_API_KEY` y `MAIL_FROM` |
| 5 | Cadena de conexión de Neon (la que ya tienes) | console.neon.tech | `DATABASE_URL` |

Las claves (Neon, Resend) **solo** se escriben en el archivo `.env` de la máquina virtual; no se suben a git ni
se pegan en el chat.

### Sobre Resend y el remitente

Resend solo envía a cualquier destinatario desde un **dominio verificado** (registros DNS que te da Resend).
Sin dominio propio, `onboarding@resend.dev` solo envía al correo dueño de la cuenta: sirve para probar, no para
los clientes. Si no tienes dominio, usa **Brevo** (permite verificar un remitente como tu Gmail): crea la API key
en Brevo y ponla en `BREVO_API_KEY` en lugar de `RESEND_API_KEY`.

## 1. Cuenta Oracle

- Elige bien la **región de origen** (no se cambia después). La capacidad ARM gratuita a veces se agota en
  algunas regiones; si al crear la máquina sale *Out of capacity*, reintenta más tarde o con otra zona de
  disponibilidad (AD).
- Recomendado: **actualizar la cuenta a Pay As You Go** (Billing > Upgrade). Sigue sin costo mientras uses solo
  recursos *Always Free*, y Oracle no reclama las máquinas por estar poco usadas (en cuentas solo-gratis puede
  reclamar una máquina con CPU, red y memoria por debajo del 20 % durante 7 días, que es el caso de una app
  pequeña). Pon un presupuesto con alerta (Billing > Budgets) en 1 USD para enterarte de cualquier cobro.

## 2. Crear la máquina virtual

Compute > Instances > **Create instance**:

1. Imagen: **Canonical Ubuntu 24.04**.
2. Shape: **Ampere > VM.Standard.A1.Flex**, 1–2 OCPU y 6–12 GB de memoria (dentro del límite Always Free de tu
   cuenta). Si no hay capacidad ARM, **VM.Standard.E2.1.Micro** (1 GB) también funciona: el script agrega memoria
   de intercambio para compilar.
3. Red: deja la VCN que crea por defecto con **IP pública asignada**.
4. SSH: **Generate a key pair** y descarga la clave privada (`.key`). Guárdala bien.
5. Create. Copia la **Public IP address**.

Abrir los puertos web: en la instancia > *Subnet* > *Security List* > **Add Ingress Rules**:
- Source `0.0.0.0/0`, TCP, puerto destino **80**
- Source `0.0.0.0/0`, TCP, puerto destino **443**

## 3. Dominio con DuckDNS

En duckdns.org crea un subdominio (p. ej. `academiapass`) y en *current ip* pon la IP pública de la máquina.
Quedará `academiapass.duckdns.org`. (Si tienes dominio propio, crea un registro **A** hacia la IP.)

## 4. Instalar (en la máquina, por SSH)

Desde tu PC (PowerShell), con la clave descargada:

```
ssh -i C:\ruta\a\tu-clave.key ubuntu@IP_PUBLICA
```

En la máquina:

```
git clone https://github.com/skatecost1992/AcademiaPass.git
cd AcademiaPass/deploy/oracle
cp .env.example .env
nano .env        # DOMAIN, DATABASE_URL, RESEND_API_KEY (o BREVO_API_KEY), MAIL_FROM
bash instalar.sh
```

Si el repositorio es privado, `git clone` pide usuario y un *token* de GitHub (Settings > Developer settings >
Personal access tokens, con permiso de solo lectura del repositorio).

`instalar.sh` instala Docker, abre 80/443 en el firewall interno de Ubuntu, genera `JWT_SECRET`, compila la
imagen (la primera vez tarda 5–15 min) y deja todo corriendo; se reinicia solo si la máquina se reinicia.
Prueba: `https://TU_DOMINIO/api/health` debe responder `"ok":true` con la base de Neon.

## 5. Apuntar las apps

Con la URL `https://TU_DOMINIO`, se cambia `apiUrlCloud` en `app-android/app.json` y `app-ios/app.json` y se
genera una versión nueva (APK e IPA). La versión web queda en `https://TU_DOMINIO`.

## 6. Operación

| Tarea | Comando (en `AcademiaPass/deploy/oracle`) |
|---|---|
| Publicar la última versión de GitHub | `bash actualizar.sh` |
| Ver el registro (ingresos, correos) | `sudo docker compose logs -f api` |
| Estado | `sudo docker compose ps` |
| Reiniciar | `sudo docker compose restart api` |
| Cambiar variables | `nano .env` y luego `sudo docker compose up -d` |

En la app, **Correos automáticos > Enviarme un correo de prueba** confirma que Resend/Brevo está bien configurado.
