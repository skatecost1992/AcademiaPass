/**
 * RQ66: negociacion de horarios entre profesores. Si la clase de un profesor se cruza con la de otro en el mismo
 * espacio, se le puede pedir al otro profesor que mueva una o varias de sus sesiones a otra hora:
 *  - La solicitud lleva, por cada fecha, la sesion del otro profesor, la hora que se quiere para la clase propia y
 *    la hora nueva que se le propone al otro profesor.
 *  - El otro profesor responde desde el enlace del correo (no tiene usuario en la app) o el personal responde por
 *    el desde la app.
 *  - Al aceptar: sus sesiones pasan a la hora propuesta (validando horario, aforo, espacio y que el profesor este
 *    libre) y se crean las sesiones de la clase que pidio el cambio. Si algo ya no cabe no se cambia nada.
 */
import { randomBytes } from 'node:crypto';
import express, { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { HttpError, requirePerm, type AuthUser } from '../auth.ts';
import type { Db } from '../db.ts';
import { compose, esc, sendMail } from '../lib/mailer.ts';
import { TZ, id, idList, isoDateTime, localParts, optText, own, parse } from '../lib/util.ts';
import { assertSlotAvailable, bookingBody, createBookingsDetailed, loadSpace } from './bookings.ts';

const fmt = (d: Date | string) =>
  new Intl.DateTimeFormat('es-CO', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d));
const span = (a: Date | string, b: Date | string) => `${fmt(a)} a ${localParts(new Date(b)).time}`;
const overlaps = (a1: Date, a2: Date, b1: Date, b2: Date) => a1 < b2 && a2 > b1;
const baseUrl = (req: Request) => (process.env.PUBLIC_URL ?? `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

const REQUEST_SELECT = `
  SELECT r.id, r.status, r.message, r.response_note, r.resolved_via, r.resolved_at, r.created_at, r.class_id,
         c.name AS class_name, c.teacher_id AS requester_teacher_id, rt.full_name AS requester_teacher_name,
         r.target_teacher_id, tt.full_name AS target_teacher_name, tt.email AS target_teacher_email,
         u.full_name AS requested_by_name, ru.full_name AS resolved_by_name
    FROM schedule_requests r JOIN classes c ON c.id = r.class_id LEFT JOIN teachers rt ON rt.id = c.teacher_id
    JOIN teachers tt ON tt.id = r.target_teacher_id LEFT JOIN users u ON u.id = r.requested_by LEFT JOIN users ru ON ru.id = r.resolved_by`;

async function withItems(db: Db, rows: any[]) {
  if (!rows.length) return [];
  const items = await db.query(
    `SELECT i.id, i.request_id, i.booking_id, i.wanted_starts_at, i.wanted_ends_at, i.proposed_starts_at, i.proposed_ends_at,
            i.new_booking_id, b.title, b.starts_at, b.ends_at, b.status AS booking_status, sp.name AS space_name, s.name AS site_name
       FROM schedule_request_items i JOIN bookings b ON b.id = i.booking_id JOIN spaces sp ON sp.id = b.space_id JOIN sites s ON s.id = b.site_id
      WHERE i.request_id IN ${idList(rows.map((r) => r.id))} ORDER BY i.wanted_starts_at`,
  );
  return rows.map(({ target_teacher_email, ...r }) => ({ ...r, target_teacher_has_email: !!target_teacher_email, items: items.filter((i) => i.request_id === r.id) }));
}

async function loadRequest(db: Db, where: string, value: unknown) {
  const [r] = await db.query(`${REQUEST_SELECT} WHERE ${where}`, [value]);
  if (!r) return null;
  const [t] = await db.query(`SELECT tenant_id, token, requested_by FROM schedule_requests WHERE id = $1`, [r.id]);
  return { ...(await withItems(db, [r]))[0], tenant_id: t.tenant_id as number, token: t.token as string, requested_by: t.requested_by as number | null };
}
type LoadedRequest = NonNullable<Awaited<ReturnType<typeof loadRequest>>>;

/** Correo al profesor al que se le pide el cambio, con el enlace para responder */
async function emailTarget(db: Db, r: LoadedRequest, link: string) {
  const [t] = await db.query(`SELECT email FROM teachers WHERE id = $1`, [r.target_teacher_id]);
  if (!t?.email) return false;
  const body = compose([
    { p: `Hola ${r.target_teacher_name},` },
    { p: `${r.requested_by_name ?? 'La academia'} te pide cambiar el horario de ${r.items.length === 1 ? 'una de tus sesiones' : `${r.items.length} de tus sesiones`} para que ${r.requester_teacher_name ?? 'otro profesor'} pueda dar la clase ${r.class_name} en ese espacio.` },
    ...(r.message ? [{ p: `Mensaje: ${r.message}` }] : []),
    { h: 'Cambios propuestos' },
    { list: r.items.map((i: any) => `${i.title} (${i.site_name} - ${i.space_name}): ${span(i.starts_at, i.ends_at)}  →  ${span(i.proposed_starts_at, i.proposed_ends_at)}`), empty: '' },
    { link, label: 'Ver y responder la solicitud' },
  ], { footer: false });
  await sendMail({ to: t.email, subject: `Solicitud de cambio de horario: ${r.class_name}`, ...body });
  return true;
}

/** Correo a quien pidio el cambio con la respuesta */
async function emailRequester(db: Db, r: LoadedRequest) {
  if (!r.requested_by) return;
  const [u] = await db.query(`SELECT email, full_name FROM users WHERE id = $1`, [r.requested_by]);
  if (!u?.email) return;
  const accepted = r.status === 'accepted';
  const body = compose([
    { p: `Hola ${u.full_name},` },
    { p: `${r.target_teacher_name} ${accepted ? 'aceptó' : 'rechazó'} el cambio de horario que pediste para la clase ${r.class_name}.` },
    ...(r.response_note ? [{ p: `Nota: ${r.response_note}` }] : []),
    ...(accepted ? [{ h: 'Sesiones programadas' }, { list: r.items.map((i: any) => span(i.wanted_starts_at, i.wanted_ends_at)), empty: '' }] : []),
  ], { footer: false });
  await sendMail({ to: u.email, subject: `Cambio de horario ${accepted ? 'aceptado' : 'rechazado'}: ${r.class_name}`, ...body }).catch((e) => console.error('[correo] respuesta de cambio de horario:', e));
}

/** Avisa a los clientes con cupo reservado que su sesion cambio de hora */
async function emailMovedClients(db: Db, bookingId: number, from: { s: Date; e: Date }) {
  const rows = await db.query(
    `SELECT u.email, u.full_name, b.title, b.starts_at, b.ends_at FROM class_reservations cr JOIN users u ON u.id = cr.client_id JOIN bookings b ON b.id = cr.booking_id
      WHERE cr.booking_id = $1 AND cr.status = 'confirmed' AND u.email IS NOT NULL`,
    [bookingId],
  );
  for (const c of rows) {
    const body = compose([
      { p: `Hola ${c.full_name},` },
      { p: `La clase ${c.title} que reservaste cambió de horario. Tu cupo se mantiene.` },
      { rows: [['Antes', span(from.s, from.e)], ['Ahora', span(c.starts_at, c.ends_at)]] },
      { p: 'Si no puedes asistir en el nuevo horario, cancela tu cupo desde la app.' },
    ]);
    await sendMail({ to: c.email, subject: `Cambio de horario: ${c.title}`, ...body }).catch((e) => console.error('[correo] cambio de horario a cliente:', e));
  }
}

/**
 * Acepta la solicitud: mueve las sesiones del otro profesor y crea las de la clase que pidio el cambio. Si algo
 * falla se deshace lo hecho y la solicitud sigue pendiente.
 */
async function accept(db: Db, r: LoadedRequest, by: { userId: number | null; via: 'app' | 'email'; note: string | null }) {
  if (r.status !== 'pending') throw new HttpError(409, 'Esta solicitud ya fue respondida', 'ALREADY_RESOLVED');
  const [c] = await db.query(`SELECT * FROM classes WHERE id = $1`, [r.class_id]);
  if (!c?.space_id || !c.teacher_id) throw new HttpError(409, 'La clase ya no tiene espacio o profesor asignado', 'CLASS_INCOMPLETE');
  const moved: { id: number; s: Date; e: Date }[] = [];
  const created: number[] = [];
  const actor = { id: by.userId ?? r.requested_by ?? 0, tenantId: r.tenant_id, role: 'staff', permissions: ['classes'] } as unknown as AuthUser;
  try {
    for (const i of r.items) {
      const [b] = await db.query(`SELECT * FROM bookings WHERE id = $1`, [i.booking_id]);
      if (!b || b.status !== 'confirmed') throw new HttpError(409, `La sesión "${i.title}" ya no está programada`, 'BOOKING_GONE');
      const space = await loadSpace(db, b.space_id, r.tenant_id);
      const ps = new Date(i.proposed_starts_at), pe = new Date(i.proposed_ends_at);
      try {
        await assertSlotAvailable(db, r.tenant_id, space, ps, pe, { groupSize: b.group_size, teacherId: b.teacher_id, excludeBookingId: b.id });
      } catch (err) {
        if (err instanceof HttpError) err.message = `No se puede mover "${b.title}" a ${span(ps, pe)}: ${err.message}`;
        throw err;
      }
      await db.query(`UPDATE bookings SET starts_at = $2, ends_at = $3 WHERE id = $1`, [b.id, ps, pe]);
      moved.push({ id: b.id, s: new Date(b.starts_at), e: new Date(b.ends_at) });
    }
    for (const i of r.items) {
      const { rows } = await createBookingsDetailed(db, { user: actor } as Request, parse(bookingBody, {
        kind: 'class', classId: c.id, spaceId: c.space_id, teacherId: c.teacher_id, groupSize: c.default_capacity,
        startsAt: new Date(i.wanted_starts_at).toISOString(), endsAt: new Date(i.wanted_ends_at).toISOString(),
      }));
      created.push(rows[0].id);
      await db.query(`UPDATE schedule_request_items SET new_booking_id = $2 WHERE id = $1`, [i.id, rows[0].id]);
    }
  } catch (err) {
    for (const m of moved) await db.query(`UPDATE bookings SET starts_at = $2, ends_at = $3 WHERE id = $1`, [m.id, m.s, m.e]);
    if (created.length) {
      await db.query(`UPDATE schedule_request_items SET new_booking_id = NULL WHERE request_id = $1`, [r.id]);
      await db.query(`DELETE FROM bookings WHERE id IN ${idList(created)}`);
    }
    throw err;
  }
  await db.query(
    `UPDATE schedule_requests SET status = 'accepted', response_note = $2, resolved_by = $3, resolved_via = $4, resolved_at = $5 WHERE id = $1`,
    [r.id, by.note, by.userId, by.via, new Date()],
  );
  for (const m of moved) await emailMovedClients(db, m.id, m);
}

async function reject(db: Db, r: LoadedRequest, by: { userId: number | null; via: 'app' | 'email'; note: string | null }) {
  if (r.status !== 'pending') throw new HttpError(409, 'Esta solicitud ya fue respondida', 'ALREADY_RESOLVED');
  await db.query(
    `UPDATE schedule_requests SET status = 'rejected', response_note = $2, resolved_by = $3, resolved_via = $4, resolved_at = $5 WHERE id = $1`,
    [r.id, by.note, by.userId, by.via, new Date()],
  );
}

const itemBody = z.object({
  bookingId: id,
  wantedStartsAt: isoDateTime, wantedEndsAt: isoDateTime,       // hora que se quiere para la clase propia
  proposedStartsAt: isoDateTime, proposedEndsAt: isoDateTime,   // hora nueva que se propone al otro profesor
});

export function scheduleRequestRoutes(db: Db) {
  const r = Router();
  const perm = requirePerm('classes');

  r.get('/schedule-requests', perm, async (req, res) => {
    const q = parse(z.object({ status: z.enum(['pending', 'accepted', 'rejected', 'cancelled']).optional() }), req.query);
    const rows = await db.query(
      `${REQUEST_SELECT} WHERE r.tenant_id = $1 AND ($2::text IS NULL OR r.status = $2) ORDER BY r.created_at DESC, r.id DESC LIMIT 100`,
      [req.user.tenantId, q.status ?? null],
    );
    res.json(await withItems(db, rows));
  });

  r.post('/schedule-requests', perm, async (req, res) => {
    const b = parse(z.object({ classId: id, message: optText(500), items: z.array(itemBody).min(1).max(26) }), req.body);
    const tenantId = req.user.tenantId;
    const c = await own(db, 'classes', b.classId, tenantId, 'Clase');
    if (!c.space_id || !c.teacher_id) throw new HttpError(400, 'La clase necesita espacio y profesor', 'CLASS_INCOMPLETE');
    let target: number | null = null;
    const now = new Date();
    for (const it of b.items) {
      const bk = await own(db, 'bookings', it.bookingId, tenantId, 'Sesión');
      const ws = new Date(it.wantedStartsAt), we = new Date(it.wantedEndsAt), ps = new Date(it.proposedStartsAt), pe = new Date(it.proposedEndsAt);
      if (bk.status !== 'confirmed' || new Date(bk.starts_at) <= now) throw new HttpError(409, `La sesión "${bk.title}" ya pasó o fue cancelada`, 'BOOKING_GONE');
      if (!bk.teacher_id || bk.teacher_id === c.teacher_id) throw new HttpError(400, 'Solo se le puede pedir el cambio a otro profesor', 'NOT_OTHER_TEACHER');
      if (target && bk.teacher_id !== target) throw new HttpError(400, 'Haz una solicitud por cada profesor', 'MIXED_TEACHERS');
      target = bk.teacher_id;
      if (bk.space_id !== c.space_id) throw new HttpError(400, `"${bk.title}" no es en el espacio de la clase`, 'OTHER_SPACE');
      if (we <= ws || pe <= ps) throw new HttpError(400, 'La hora final debe ser mayor que la inicial');
      if (we.getTime() - ws.getTime() > 24 * 3600_000 || pe.getTime() - ps.getTime() > 24 * 3600_000) throw new HttpError(400, 'Una sesión no puede durar más de 24 horas');
      if (!overlaps(ws, we, new Date(bk.starts_at), new Date(bk.ends_at))) throw new HttpError(400, `La hora pedida no se cruza con "${bk.title}"`, 'NO_CLASH');
      if (overlaps(ws, we, ps, pe)) throw new HttpError(400, 'La hora propuesta al otro profesor no puede cruzarse con la hora que pides', 'PROPOSAL_CLASH');
      if (ps <= now) throw new HttpError(400, 'La hora propuesta debe ser en el futuro');
      // La hora propuesta debe estar libre hoy para el otro profesor (se vuelve a validar al aceptar)
      const space = await loadSpace(db, bk.space_id, tenantId);
      try {
        await assertSlotAvailable(db, tenantId, space, ps, pe, { groupSize: bk.group_size, teacherId: bk.teacher_id, excludeBookingId: bk.id, staff: true });
      } catch (err) {
        if (err instanceof HttpError) err.message = `Hora propuesta para "${bk.title}" (${span(ps, pe)}): ${err.message}`;
        throw err;
      }
      const [dup] = await db.query(
        `SELECT 1 FROM schedule_request_items i JOIN schedule_requests r ON r.id = i.request_id WHERE i.booking_id = $1 AND r.status = 'pending'`,
        [bk.id],
      );
      if (dup) throw new HttpError(409, `Ya hay una solicitud pendiente para "${bk.title}"`, 'ALREADY_REQUESTED');
    }
    const token = randomBytes(24).toString('base64url');
    const reqId = await db.tx(async (q) => {
      const [row] = await q.query(
        `INSERT INTO schedule_requests (tenant_id, class_id, target_teacher_id, requested_by, message, token) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [tenantId, c.id, target, req.user.id, b.message, token],
      );
      for (const it of b.items) {
        await q.query(
          `INSERT INTO schedule_request_items (request_id, booking_id, wanted_starts_at, wanted_ends_at, proposed_starts_at, proposed_ends_at) VALUES ($1, $2, $3, $4, $5, $6)`,
          [row.id, it.bookingId, new Date(it.wantedStartsAt), new Date(it.wantedEndsAt), new Date(it.proposedStartsAt), new Date(it.proposedEndsAt)],
        );
      }
      return row.id as number;
    });
    const created = (await loadRequest(db, 'r.id = $1', reqId))!;
    let emailed = false;
    try {
      emailed = await emailTarget(db, created, `${baseUrl(req)}/api/schedule-requests/respond?token=${token}`);
    } catch (e) {
      console.error('[correo] solicitud de cambio de horario:', e);
    }
    const { token: _t, tenant_id: _x, requested_by: _y, ...out } = created;
    res.status(201).json({ ...out, emailed });
  });

  const resolveBody = z.object({ note: optText(500) });
  const mine = async (req: Request) => {
    const r = await loadRequest(db, 'r.id = $1', parse(id, req.params.id));
    if (!r || r.tenant_id !== req.user.tenantId) throw new HttpError(404, 'Solicitud no encontrada', 'NOT_FOUND');
    return r;
  };
  const reply = async (rid: number) => {
    const { token: _t, tenant_id: _x, requested_by: _y, ...out } = (await loadRequest(db, 'r.id = $1', rid))!;
    return out;
  };

  // El personal responde por el profesor (p. ej. si lo acordaron en persona o el profesor no tiene correo)
  r.post('/schedule-requests/:id/accept', perm, async (req, res) => {
    const r0 = await mine(req);
    await accept(db, r0, { userId: req.user.id, via: 'app', note: parse(resolveBody, req.body).note });
    await emailRequester(db, (await loadRequest(db, 'r.id = $1', r0.id))!);
    res.json(await reply(r0.id));
  });
  r.post('/schedule-requests/:id/reject', perm, async (req, res) => {
    const r0 = await mine(req);
    await reject(db, r0, { userId: req.user.id, via: 'app', note: parse(resolveBody, req.body).note });
    await emailRequester(db, (await loadRequest(db, 'r.id = $1', r0.id))!);
    res.json(await reply(r0.id));
  });
  r.post('/schedule-requests/:id/cancel', perm, async (req, res) => {
    const r0 = await mine(req);
    if (r0.status !== 'pending') throw new HttpError(409, 'Esta solicitud ya fue respondida', 'ALREADY_RESOLVED');
    await db.query(`UPDATE schedule_requests SET status = 'cancelled', resolved_by = $2, resolved_via = 'app', resolved_at = $3 WHERE id = $1`, [r0.id, req.user.id, new Date()]);
    res.json(await reply(r0.id));
  });

  return r;
}

/** Pagina publica para que el profesor responda desde el enlace del correo (sin iniciar sesion) */
export function scheduleRequestPublicRoutes(db: Db) {
  const r = Router();
  const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });
  const page = (title: string, body: string) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>body{font-family:Arial,sans-serif;max-width:640px;margin:24px auto;padding:0 16px;color:#111}
h1{font-size:20px}li{margin:6px 0}textarea{width:100%;min-height:70px;box-sizing:border-box}button{padding:10px 18px;border:0;border-radius:6px;color:#fff;font-size:15px;margin:8px 8px 0 0;cursor:pointer}
.ok{background:#15803d}.no{background:#b91c1c}.muted{color:#555}</style></head><body><h1>${esc(title)}</h1>${body}</body></html>`;
  const tokenOf = (v: unknown) => parse(z.string().min(20).max(64), v);

  r.get('/schedule-requests/respond', limiter, async (req, res) => {
    const rq = await loadRequest(db, 'r.token = $1', tokenOf(req.query.token)).catch(() => null);
    if (!rq) return res.status(404).type('html').send(page('Solicitud no encontrada', '<p>El enlace no es válido.</p>'));
    const list = rq.items.map((i: any) => `<li><b>${esc(i.title)}</b> (${esc(i.site_name)} - ${esc(i.space_name)})<br>${esc(span(i.starts_at, i.ends_at))} → <b>${esc(span(i.proposed_starts_at, i.proposed_ends_at))}</b></li>`).join('');
    const status = { accepted: 'Ya aceptaste esta solicitud.', rejected: 'Ya rechazaste esta solicitud.', cancelled: 'La academia canceló esta solicitud.' }[rq.status as string];
    res.type('html').send(page(`Cambio de horario: ${rq.class_name}`, `
<p>${esc(rq.requested_by_name ?? 'La academia')} te pide cambiar el horario de tus sesiones para que ${esc(rq.requester_teacher_name ?? 'otro profesor')} dé la clase <b>${esc(rq.class_name)}</b>.</p>
${rq.message ? `<p class="muted">Mensaje: ${esc(rq.message)}</p>` : ''}<ul>${list}</ul>
${status ? `<p><b>${status}</b></p>` : `<form method="post" action="respond"><input type="hidden" name="token" value="${esc(rq.token)}">
<label>Nota (opcional)<br><textarea name="note" maxlength="500"></textarea></label><br>
<button class="ok" name="action" value="accept">Aceptar el cambio</button><button class="no" name="action" value="reject">Rechazar</button></form>`}`));
  });

  r.post('/schedule-requests/respond', limiter, express.urlencoded({ extended: false, limit: '10kb' }), async (req, res) => {
    const b = parse(z.object({ token: z.string().min(20).max(64), action: z.enum(['accept', 'reject']), note: optText(500) }), req.body);
    const rq = await loadRequest(db, 'r.token = $1', b.token);
    if (!rq) return res.status(404).type('html').send(page('Solicitud no encontrada', '<p>El enlace no es válido.</p>'));
    try {
      if (b.action === 'accept') await accept(db, rq, { userId: null, via: 'email', note: b.note });
      else await reject(db, rq, { userId: null, via: 'email', note: b.note });
    } catch (err) {
      const msg = err instanceof HttpError ? err.message : 'Error interno';
      if (!(err instanceof HttpError)) console.error(err);
      return res.status(409).type('html').send(page('No se pudo aplicar el cambio', `<p>${esc(msg)}</p><p class="muted">Comunícate con la academia.</p>`));
    }
    await emailRequester(db, (await loadRequest(db, 'r.id = $1', rq.id))!);
    res.type('html').send(page(b.action === 'accept' ? 'Cambio aceptado' : 'Solicitud rechazada',
      b.action === 'accept' ? '<p>Tus sesiones quedaron en el nuevo horario. ¡Gracias!</p>' : '<p>Le avisaremos a la academia.</p>'));
  });
  return r;
}
