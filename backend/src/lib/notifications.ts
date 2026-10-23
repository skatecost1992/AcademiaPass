/**
 * Correos automaticos:
 *  - RQ63: recordatorio un dia antes y tres horas antes de cada reserva de espacio o cupo en clase.
 *  - RQ64: aviso de plan por vencer y de plan vencido, con los datos del plan, las clases tomadas y las pendientes.
 * La organizacion decide cuales se envian (y con cuantos dias de anticipacion avisa del vencimiento) y cada usuario
 * puede apagar los suyos. Cada aviso se envia una sola vez (indice unico en notifications).
 */
import type { Db } from '../db.ts';
import { compose, sendMail } from './mailer.ts';
import { TZ, addDays, localParts } from './util.ts';

const HOUR = 3600_000;
export const DAY_BEFORE_H = 24;
export const HOURS_BEFORE_H = 3;

type Kind = 'day_before' | 'hours_before' | 'plan_expiring' | 'plan_expired';

const fmtDateTime = (d: Date | string) =>
  new Intl.DateTimeFormat('es-CO', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d));
const fmtDate = (ymd: string) =>
  new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${ymd}T00:00:00Z`));
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000);

/** Registra el aviso (si ya existe, otro proceso lo envio) y lo envia. Devuelve false si ya se habia enviado. */
async function deliver(db: Db, n: { tenantId: number; userId: number; kind: Kind; refId: number; email: string; subject: string; text: string; html: string }) {
  const [exists] = await db.query(`SELECT id FROM notifications WHERE user_id = $1 AND kind = $2 AND ref_id = $3`, [n.userId, n.kind, n.refId]);
  if (exists) return false;
  let row: { id: number } | undefined;
  try {
    [row] = await db.query(
      `INSERT INTO notifications (tenant_id, user_id, kind, ref_id, email, subject) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [n.tenantId, n.userId, n.kind, n.refId, n.email, n.subject],
    );
  } catch {
    return false; // el indice unico lo rechazo: ya se envio
  }
  try {
    const status = await sendMail({ to: n.email, subject: n.subject, text: n.text, html: n.html });
    await db.query(`UPDATE notifications SET status = $2 WHERE id = $1`, [row!.id, status]);
    console.log(`[correo] ${n.kind} usuario=${n.userId} ref=${n.refId} -> ${status === 'sent' ? 'enviado' : 'sin SMTP, solo registrado'}`);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 900);
    await db.query(`UPDATE notifications SET status = 'failed', error = $2 WHERE id = $1`, [row!.id, msg]);
    console.error(`[correo] ${n.kind} usuario=${n.userId} ref=${n.refId} -> fallo: ${msg}`);
  }
  return true;
}

/** RQ63: recordatorios de reservas y cupos en clases que empiezan en las proximas 24 horas */
export async function sendReminders(db: Db, now = new Date()) {
  const until = new Date(now.getTime() + DAY_BEFORE_H * HOUR);
  const select = `
    SELECT b.id AS booking_id, b.kind, b.title, b.starts_at, b.ends_at, s.name AS site_name, s.address, sp.name AS space_name,
           a.name AS academy_name, t.full_name AS teacher_name, u.id AS user_id, u.tenant_id, u.full_name, u.email,
           u.notify_day_before AS u_day, u.notify_hours_before AS u_hours, tn.notify_day_before AS t_day, tn.notify_hours_before AS t_hours`;
  const from = `
      JOIN sites s ON s.id = b.site_id JOIN spaces sp ON sp.id = b.space_id JOIN academies a ON a.id = s.academy_id
      LEFT JOIN teachers t ON t.id = b.teacher_id JOIN tenants tn ON tn.id = u.tenant_id
     WHERE b.status = 'confirmed' AND b.starts_at > $1 AND b.starts_at <= $2 AND u.active = true AND u.email IS NOT NULL AND tn.status = 'active'`;
  const items = [
    ...await db.query(`${select}, cr.created_at AS reserved_at FROM class_reservations cr JOIN bookings b ON b.id = cr.booking_id JOIN users u ON u.id = cr.client_id ${from} AND cr.status = 'confirmed'`, [now, until]),
    ...await db.query(`${select}, b.created_at AS reserved_at FROM bookings b JOIN users u ON u.id = b.client_id ${from} AND b.kind = 'rental'`, [now, until]),
  ];
  let sent = 0;
  for (const it of items) {
    if (!it.email?.trim()) continue;
    const start = new Date(it.starts_at).getTime();
    const lead = start - now.getTime();
    const ahead = start - new Date(it.reserved_at).getTime(); // con cuanta anticipacion reservo
    // Solo se recuerda lo que se reservo antes del momento del aviso: quien reserva para dentro de 2 horas no lo necesita
    let kind: Kind | null = null;
    if (lead <= HOURS_BEFORE_H * HOUR) {
      if (ahead > HOURS_BEFORE_H * HOUR && it.t_hours && it.u_hours) kind = 'hours_before';
    } else if (ahead > DAY_BEFORE_H * HOUR && it.t_day && it.u_day) kind = 'day_before';
    if (!kind) continue;

    const isClass = it.kind === 'class';
    const when = fmtDateTime(it.starts_at);
    const subject = kind === 'day_before'
      ? `Recordatorio: ${it.title} mañana, ${localParts(new Date(it.starts_at)).time}`
      : `Recordatorio: ${it.title} en ${HOURS_BEFORE_H} horas (${localParts(new Date(it.starts_at)).time})`;
    const rows: [string, string][] = [
      [isClass ? 'Clase' : 'Reserva', it.title],
      ['Fecha y hora', `${when} a ${localParts(new Date(it.ends_at)).time}`],
      ['Academia', it.academy_name],
      ['Sede', it.address ? `${it.site_name} (${it.address})` : it.site_name],
      ['Espacio', it.space_name],
    ];
    if (it.teacher_name) rows.push(['Profesor', it.teacher_name]);
    const body = compose([
      { p: `Hola ${it.full_name},` },
      { p: kind === 'day_before'
        ? `Te recordamos que mañana tienes ${isClass ? 'una clase reservada' : 'una reserva'}:`
        : `Tu ${isClass ? 'clase' : 'reserva'} empieza en ${HOURS_BEFORE_H} horas:` },
      { rows },
      { p: 'Presenta tu código QR al llegar. Si no puedes asistir, cancela desde la app dentro del plazo permitido.' },
    ]);
    if (await deliver(db, { tenantId: it.tenant_id, userId: it.user_id, kind, refId: it.booking_id, email: it.email.trim(), subject, ...body })) sent++;
  }
  return sent;
}

/** Datos del plan adquirido, clases tomadas con ese plan y clases reservadas pendientes hasta su vencimiento */
export async function planSummary(db: Db, membershipId: number, now = new Date()) {
  const [m] = await db.query(
    `SELECT m.id, m.client_id, m.starts_on, m.ends_on, m.units_total, m.units_used, p.name AS plan_name, p.all_sites
       FROM memberships m JOIN plans p ON p.id = m.plan_id WHERE m.id = $1`,
    [membershipId],
  );
  if (!m) return null;
  const academies = await db.query(`SELECT a.name FROM plan_academies pa JOIN academies a ON a.id = pa.academy_id JOIN memberships m ON m.plan_id = pa.plan_id WHERE m.id = $1 ORDER BY a.name`, [membershipId]);
  const sites = await db.query(`SELECT s.name FROM plan_sites ps JOIN sites s ON s.id = ps.site_id JOIN memberships m ON m.plan_id = ps.plan_id WHERE m.id = $1 ORDER BY s.name`, [membershipId]);
  const taken = await db.query(
    `SELECT att.scanned_at, a.name AS academy_name, s.name AS site_name, b.title
       FROM attendances att JOIN academies a ON a.id = att.academy_id JOIN sites s ON s.id = att.site_id
       LEFT JOIN bookings b ON b.id = att.booking_id
      WHERE att.membership_id = $1 ORDER BY att.scanned_at DESC`,
    [membershipId],
  );
  const pending = await db.query(
    `SELECT b.title, b.starts_at, s.name AS site_name, sp.name AS space_name
       FROM class_reservations cr JOIN bookings b ON b.id = cr.booking_id JOIN sites s ON s.id = b.site_id JOIN spaces sp ON sp.id = b.space_id
      WHERE cr.client_id = $1 AND cr.status = 'confirmed' AND b.status = 'confirmed' AND b.starts_at > $2
      ORDER BY b.starts_at`,
    [m.client_id, now],
  );
  const lastDay = m.ends_on as string;
  return {
    ...m,
    academies: academies.map((a) => a.name as string),
    sites: m.all_sites ? ['Todas las sedes'] : sites.map((s) => s.name as string),
    remaining: m.units_total == null ? null : Math.max(0, m.units_total - m.units_used),
    taken: taken.map((t) => ({ at: t.scanned_at, label: `${fmtDateTime(t.scanned_at)} · ${t.title ?? 'Ingreso general'} · ${t.academy_name} - ${t.site_name}` })),
    // Solo las que caen dentro de la vigencia del plan
    pending: pending.filter((p) => localParts(new Date(p.starts_at)).date <= lastDay)
      .map((p) => ({ at: p.starts_at, label: `${fmtDateTime(p.starts_at)} · ${p.title} · ${p.site_name} - ${p.space_name}` })),
  };
}

/** RQ64: aviso de plan por vencer (dentro de los dias que define la organizacion) y de plan vencido */
export async function sendPlanNotices(db: Db, now = new Date()) {
  const today = localParts(now).date;
  const rows = await db.query(
    `SELECT m.id, m.client_id, m.plan_id, m.ends_on, u.tenant_id, u.full_name, u.email, u.notify_plan AS u_plan,
            tn.notify_plan AS t_plan, tn.plan_notice_days
       FROM memberships m JOIN users u ON u.id = m.client_id JOIN tenants tn ON tn.id = u.tenant_id
      WHERE m.status = 'active' AND m.ends_on >= $1 AND m.ends_on <= $2 AND u.active = true AND u.email IS NOT NULL
        AND tn.status = 'active' AND tn.notify_plan = true AND u.notify_plan = true`,
    [addDays(today, -7), addDays(today, 60)],
  );
  let sent = 0;
  for (const r of rows) {
    if (!r.email?.trim()) continue;
    const left = daysBetween(today, r.ends_on);
    let kind: Kind | null = null;
    if (left >= 0 && left <= r.plan_notice_days) kind = 'plan_expiring';
    if (left < 0) {
      // Si ya lo renovo (el mismo plan sigue vigente despues), no se avisa que vencio
      const [renewed] = await db.query(
        `SELECT id FROM memberships WHERE client_id = $1 AND plan_id = $2 AND status = 'active' AND ends_on > $3`,
        [r.client_id, r.plan_id, r.ends_on],
      );
      if (!renewed) kind = 'plan_expired';
    }
    if (!kind) continue;
    const p = (await planSummary(db, r.id, now))!;
    const subject = kind === 'plan_expired'
      ? `Tu plan ${p.plan_name} venció el ${fmtDate(p.ends_on)}`
      : left === 0 ? `Tu plan ${p.plan_name} vence hoy` : `Tu plan ${p.plan_name} vence en ${left} día(s)`;
    const body = compose([
      { p: `Hola ${r.full_name},` },
      { p: kind === 'plan_expired'
        ? `Tu plan venció. Para seguir reservando e ingresando, renuévalo con la academia.`
        : `Tu plan está por vencer${left === 0 ? ' hoy' : ` el ${fmtDate(p.ends_on)}`}. Aprovecha las clases que te quedan o renuévalo con la academia.` },
      { h: 'Datos del plan' },
      { rows: [
        ['Plan', p.plan_name],
        ['Vigencia', `${fmtDate(p.starts_on)} al ${fmtDate(p.ends_on)}`],
        ['Academias', p.academies.join(', ') || '—'],
        ['Sedes', p.sites.join(', ') || '—'],
        ['Clases del plan', p.units_total == null ? 'Ilimitadas' : String(p.units_total)],
        ['Clases tomadas', String(p.units_used)],
        ['Clases pendientes por tomar', p.remaining == null ? 'Ilimitadas' : String(p.remaining)],
      ] },
      { h: `Clases tomadas (${p.taken.length})` },
      { list: p.taken.slice(0, 30).map((t: { label: string }) => t.label), empty: 'Aún no has tomado clases con este plan.' },
      ...(kind === 'plan_expiring' ? [
        { h: `Clases reservadas pendientes (${p.pending.length})` },
        { list: p.pending.map((x: { label: string }) => x.label), empty: 'No tienes clases reservadas antes del vencimiento.' },
      ] : []),
    ]);
    if (await deliver(db, { tenantId: r.tenant_id, userId: r.client_id, kind, refId: r.id, email: r.email.trim(), subject, ...body })) sent++;
  }
  return sent;
}

/** Tarea programada: corre cada 5 minutos desde server.ts */
export async function dispatchNotifications(db: Db, now = new Date()) {
  return { reminders: await sendReminders(db, now), plans: await sendPlanNotices(db, now) };
}
