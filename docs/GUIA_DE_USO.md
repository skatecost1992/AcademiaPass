# Guía de uso

## Administrador

1. **Registrar mi academia** (pantalla de ingreso): crea la organización, la primera academia y la primera sede.
2. **Academias**: crea más academias. Cada una tiene un *código de inscripción* para que los clientes se
   registren solos.
3. **Sedes y espacios**: por sede, el horario de atención por día, fotos (cámara, o hasta 15 a la vez desde la
   galería; máximo 30 por sede o espacio) y sus espacios.
   En cada espacio: aforo máximo y si admite varios grupos a la vez (cuántos y de cuántas personas).
4. **Clases y profesores**: profesores internos o externos y las clases con su profesor y cupo. Al crear una clase
   se programa su horario: fecha, hora desde y hasta (toca uno de los *horarios disponibles* del espacio para
   usarlo) y, si es **periódica**, los días de la semana y cuántas semanas se repite. El cupo no puede superar el
   aforo del espacio; si alguna sesión choca no se guarda nada y la app muestra los horarios libres.
   Si choca con la clase de **otro profesor**, la app ofrece crear la clase con las sesiones que caben y **pedirle
   el cambio de horario** en una o varias fechas (propones a qué hora pasaría su sesión). El profesor recibe un
   correo con un enlace para aceptar o rechazar; si no tiene correo, respondes por él en **Cambios de horario**.
   Al aceptar, su sesión se mueve (a sus clientes con cupo les llega un correo) y se programa tu clase.
5. **Agenda**: *Programar clase* (espacio, fecha, hora desde/hasta, repetir N semanas) o *Reservar espacio*
   (para un profesor externo/interno o un cliente). Si el espacio está ocupado o se pasa del aforo, la app lo
   indica.
6. **Planes**: tipo (clases, reservas, acceso/asesorías, mixto), número de clases o ilimitado, vigencia,
   precio, academias a las que da acceso y sedes permitidas.
7. **Clientes**: crear cliente, *Asignar plan* (con el pago), registrar pagos, ver su reporte unificado.
8. **Usuarios**: crea el personal y marca sus permisos (registrar asistencias, horarios, clases, reservas,
   reportes, permitir ingresos fuera del aforo…).
9. **Reportes**: Resumen (agrupa todo y se descarga en PDF), Asistencia, Aforo y Pagos; por semana o mes,
   academia y sede.

## Recepción: registrar ingresos

*Escanear QR* → elige **academia** y **sede** → elige la **clase de hoy** o *Ingreso general* → apunta al QR del
cliente (o busca por documento). Resultado:

- Verde: ingreso registrado y clases restantes del plan que se descontó.
- Rojo: sin plan vigente para esa academia/sede (muestra el motivo) o QR vencido.
- Aforo completo: si tienes el permiso de aforo, pulsa *Permitir ingreso fuera del aforo*. Si no, la app
  muestra a quién contactar (nombre, celular, correo) y el botón *Solicitar autorización*. La solicitud queda
  en **Autorizaciones**, donde quien tiene el permiso la aprueba (se registra el ingreso) o la rechaza.

El ingreso a una clase o reserva solo se valida **el mismo día, desde 1 hora antes del inicio hasta la hora
de finalización**. Cada espacio puede tener su propio **horario de disponibilidad** (dentro del de la sede):
solo se reserva en esas franjas. En **Reportes → Clases** el personal ve las clases reservadas, tomadas y sin
asistir de todos; cada cliente ve las suyas en *Mi reporte*.

Las clases y reservas solo se agendan dentro del **horario de atención** de la sede; una sede sin horario
configurado no admite agenda. Un cliente no puede tener dos reservas que se crucen en el tiempo.

## Cliente

1. **Crear cuenta de cliente** con el código de la academia y acepta el tratamiento de datos.
2. **Mostrar mi código QR** en la recepción (se renueva solo cada pocos minutos).
3. **Mi reporte**: planes, clases tomadas y restantes, días asistidos por semana o mes y PDF.
4. **Horario de clases**: toca una clase para **reservar o cancelar tu cupo**. Se necesita un plan vigente de
   clases que incluya esa academia y sede, y que la clase tenga cupo.
5. **Mis reservas**: tus clases con cupo y tus espacios reservados. Reservar un espacio exige un plan de reservas
   de esa sede; al elegir sede y espacio se ven su descripción, fotos, aforo y horario. Solo se puede cancelar
   hasta el límite que fija el administrador (por defecto 1 día antes).
6. **Unirme a otra academia** (de la misma organización). Para una academia de otra organización se crea una
   cuenta nueva con el mismo documento.

El administrador fija el límite de cancelación en **Reglas de reserva** (inicio): una regla general y, si
quiere, una distinta por academia y por sede (la de la sede manda). Cada clase en *Mis reservas* muestra hasta
cuándo se puede cancelar.

**Correos (RQ63, RQ64, RQ67):** salen desde el Gmail del administrador (ver `docs/CORREO_GMAIL.md`).  en **Mi perfil > Notificaciones por correo** cada usuario elige si recibe el
recordatorio 1 día antes y 3 horas antes de sus reservas y clases, y el aviso de vencimiento de su plan (con las
clases tomadas y las pendientes). Hay que tener el correo registrado en *Mis datos*.

El administrador (o quien tenga el permiso *Configurar los correos*) define en **Correos automáticos** cuáles se
envían en la organización y con cuántos días de anticipación se avisa el vencimiento; ahí también ve los últimos
correos enviados y puede mandarse uno de prueba.

**Pagos:** todo pago se registra a un **cliente** y a uno de **sus planes**. Si corresponde a una reserva de
espacio, se puede asociar también a esa reserva (debe ser del mismo cliente).
