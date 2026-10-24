/**
 * Horarios de clase y reservas de espacios (RQ2, RQ3, RQ5, RQ18, RQ19).
 *
 * Ambos ocupan un espacio en un rango de horas y se guardan en `bookings`:
 *  - kind = class  : sesion de una clase con su profesor (interno o externo) y cupo.
 *  - kind = rental : el espacio reservado por un cliente o para la clase de un profesor externo.
 * Antes de guardar se valida el horario de atencion de la sede y el aforo/grupos del espacio.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { HttpError, assertOwnTeacher, isStaffish } from '../auth.ts';
import { compose, sendMail } from '../lib/mailer.ts';
import type { Db } from '../db.ts';
import { assertSpaceAvailable, assertWithinOpeningHours, type Space } from '../lib/capacity.ts';
import { assertWithinHorizon, freeSlots } from '../lib/scheduling.ts';
import { dateStr, dayBounds, id, idList, localParts, isoDateTime, lockRow, optId, optText, own, parse, range, todayLocal } from '../lib/util.ts';
import { assertCanCancel, assertClientPlan, assertNoOverlap, myReservationIds } from './reservations.ts';
import { visibleAcademyIds } from './setup.ts';

const DAY_MS = 24 * 3600_000;
const WEEK_MS = 7 * DAY_MS;

export const bookingBody = z.object({
  spaceId: id,
  kind: z.enum(['class', 'rental']),
  classId: optId.nullable(),
  teacherId: optId.nullable(),
  clientId: optId.nullable(),
  title: z.string().trim().max(120).optional().nullable(),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  groupSize: z.coerce.number().int().positive().optional(),
  notes: optText(),
  repeatWeeks: z.coerce.number().int().min(1).max(26).default(1), // crea la misma reserva N semanas seguidas
  // RQ65: periodica en varios dias de la semana (0 = domingo); vacio = solo el dia de la fecha inicial
  weekdays: z.array(z.coerce.number().int().min(0).max(6)).max(7).optional(),
});

export const BOOKING_SELECT = `
  SELECT b.id, b.kind, b.title, b.starts_at, b.ends_at, b.group_size, b.status, b.notes, b.site_id, b.space_id,
         b.class_id, b.teacher_id, b.client_id,
         sp.name AS space_name, s.name AS site_name, s.academy_id, a.name AS academy_name,
         t.full_name AS teacher_name, t.kind AS teacher_kind, cu.full_name AS client_name,
         (SELECT count(*)::int FROM attendances att WHERE att.booking_id = b.id) AS attendees,
         (SELECT count(*)::int FROM class_reservations cr WHERE cr.booking_id = b.id AND cr.status = 'confirmed') AS reserved,
         (SELECT coalesce(sum(amount), 0)::float8 FROM payments p WHERE p.booking_id = b.id) AS paid
    FROM bookings b
    JOIN spaces sp ON sp.id = b.space_id
    JOIN sites s ON s.id = b.site_id
    JOIN academies a ON a.id = s.academy_id
    LEFT JOIN teachers t ON t.id = b.teacher_id
    LEFT JOIN users cu ON cu.id = b.client_id`;

/** RQ62: un profesor solo puede estar en una sede (y una clase) a la vez */
export async function assertTeacherFree(db: Db, teacherId: number, start: Date, end: Date, excludeBookingId?: number) {
  const [clash] = await db.query(
    `SELECT b.title, b.starts_at, b.ends_at, s.name AS site_name, sp.name AS space_name, t.full_name
       FROM bookings b JOIN sites s ON s.id = b.site_id JOIN spaces sp ON sp.id = b.space_id JOIN teachers t ON t.id = b.teacher_id
      WHERE b.teacher_id = $1 AND b.status = 'confirmed' AND b.starts_at < $3 AND b.ends_at > $2 AND b.id <> $4
      ORDER BY b.starts_at`,
    [teacherId, start, end, excludeBookingId ?? 0],
  );
  if (clash) {
    const hm = (d: Date | string) => localParts(new Date(d)).time;
    throw new HttpError(409,
      `${clash.full_name} ya tiene "${clash.title}" en ${clash.site_name} · ${clash.space_name} de ${hm(clash.starts_at)} a ${hm(clash.ends_at)}: un profesor no puede estar en dos clases a la vez.`,
      'TEACHER_BUSY');
  }
}

export async function loadSpace(db: Db, spaceId: number, tenantId: number) {
  const [sp] = await db.query(
    `SELECT sp.*, s.name AS site_name, s.opening_hours AS site_hours, s.academy_id, s.active AS site_active
       FROM spaces sp JOIN sites s ON s.id = sp.site_id WHERE sp.id = $1 AND sp.tenant_id = $2`,
    [spaceId, tenantId],
  );
  if (!sp) throw new HttpError(404, 'Espacio no encontrado', 'NOT_FOUND');
  if (!sp.active || !sp.site_active) throw new HttpError(409, 'El espacio o la sede están inactivos', 'INACTIVE');
  const parseHours = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);
  return { ...sp, site_hours: parseHours(sp.site_hours) ?? [], opening_hours: parseHours(sp.opening_hours) } as Space & {
    site_name: string; site_hours: any[]; opening_hours: any[] | null; academy_id: number;
  };
}
export type LoadedSpace = Awaited<ReturnType<typeof loadSpace>>;

/** Reservas confirmadas del espacio que se cruzan con [start, end), con su profesor (RQ66) */
export async function spaceClashes(db: Db, spaceId: number, start: Date, end: Date, excludeBookingId?: number) {
  const rows = await db.query(
    `SELECT b.id, b.kind, b.title, b.starts_at, b.ends_at, b.space_id, b.class_id, b.teacher_id, t.full_name AS teacher_name, t.email AS teacher_email
       FROM bookings b LEFT JOIN teachers t ON t.id = b.teacher_id
      WHERE b.space_id = $1 AND b.status = 'confirmed' AND b.starts_at < $3 AND b.ends_at > $2 AND b.id <> $4
      ORDER BY b.starts_at`,
    [spaceId, start, end, excludeBookingId ?? 0],
  );
  return rows.map((x) => ({
    bookingId: x.id as number, kind: x.kind as 'class' | 'rental', title: x.title as string, startsAt: x.starts_at, endsAt: x.ends_at,
    spaceId: x.space_id as number, classId: x.class_id as number | null, teacherId: x.teacher_id as number | null,
    teacherName: x.teacher_name as string | null, teacherHasEmail: !!x.teacher_email,
  }));
}
export type SpaceClash = Awaited<ReturnType<typeof spaceClashes>>[number];

/**
 * Valida que una reserva quepa en [s, e): horario de la sede y del espacio, horizonte, aforo y espacio libre,
 * cliente y profesor sin cruces. Si el espacio esta ocupado sugiere las franjas libres (RQ42) y, para el
 * personal, informa con que reservas y profesores se cruza (RQ66).
 */
export async function assertSlotAvailable(q: Db, tenantId: number, space: LoadedSpace, s: Date, e: Date, o: {
  groupSize: number; teacherId?: number | null; clientId?: number | null; excludeBookingId?: number; staff?: boolean;
}) {
  assertWithinOpeningHours(space.site_name, space.site_hours, s, e);
  // RQ40: si el espacio tiene su propio horario de disponibilidad, tambien debe caber en el
  if (space.opening_hours?.length) assertWithinOpeningHours(space.name, space.opening_hours, s, e, 'el espacio');
  await assertWithinHorizon(q, tenantId, s); // RQ47
  try {
    await assertSpaceAvailable(q, space, s, e, o.groupSize, o.excludeBookingId);
  } catch (err) {
    if (err instanceof HttpError && (err.code === 'SPACE_TAKEN' || err.code === 'CAPACITY_FULL')) {
      const day = localParts(s).date;
      const available = await freeSlots(q, space.id, day);
      err.message += available.length ? `. Horarios disponibles ese día: ${available.join(', ')}` : '. No quedan horarios disponibles ese día.';
      err.extra = { ...err.extra, available, date: day, ...(o.staff ? { clashes: await spaceClashes(q, space.id, s, e, o.excludeBookingId) } : {}) };
    }
    throw err;
  }
  if (o.clientId) await assertNoOverlap(q, o.clientId, s, e, o.excludeBookingId); // RQ38
  if (o.teacherId) await assertTeacherFree(q, o.teacherId, s, e, o.excludeBookingId); // RQ62
}

/**
 * Inicios de cada repeticion: N semanas desde la fecha inicial y, si se indican dias de la semana (RQ65), en cada
 * uno de esos dias a la misma hora. Desplazamientos en milisegundos desde el inicio, ordenados.
 */
function occurrenceOffsets(start: Date, repeatWeeks: number, weekdays?: number[]) {
  const first = localParts(start).day;
  const days = weekdays?.length ? [...new Set(weekdays)].map((d) => (d - first + 7) % 7).sort((a, b) => a - b) : [0];
  const out: number[] = [];
  for (let w = 0; w < repeatWeeks; w++) for (const d of days) out.push(w * WEEK_MS + d * DAY_MS);
  return out;
}

/** Sesion que no se pudo crear (con `skipConflicts`): fecha, motivo y reservas con las que choca (RQ66) */
export interface BookingConflict {
  startsAt: string; endsAt: string; code?: string; message: string; available?: string[]; clashes?: SpaceClash[];
}

/**
 * Crea una o varias reservas semanales validando cada una. Por defecto, si alguna choca no se guarda ninguna; con
 * `skipConflicts` se guardan las que caben y se devuelven las que chocaron (para negociar el horario, RQ66).
 */
export async function createBookingsDetailed(db: Db, req: Request, b: z.infer<typeof bookingBody>, opts: { skipConflicts?: boolean } = {}) {
  const tenantId = req.user.tenantId;
  const start = new Date(b.startsAt);
  const end = new Date(b.endsAt);
  if (end <= start) throw new HttpError(400, 'La hora final debe ser mayor que la inicial');
  if (end.getTime() - start.getTime() > 24 * 3600_000) throw new HttpError(400, 'Una reserva no puede durar más de 24 horas');

  const space = await loadSpace(db, b.spaceId, tenantId);
  let title = b.title ?? null;
  let teacherId = b.teacherId ?? null;
  let groupSize = b.groupSize;

  if (b.kind === 'class') {
    if (!b.classId) throw new HttpError(400, 'classId: Selecciona la clase');
    const c = await own(db, 'classes', b.classId, tenantId, 'Clase');
    if (c.academy_id !== space.academy_id) throw new HttpError(400, 'La clase y el espacio pertenecen a academias distintas');
    // RQ61: la clase tiene asignado su espacio; sus sesiones se programan alli
    if (c.space_id && c.space_id !== space.id) {
      const [own2] = await db.query(`SELECT name FROM spaces WHERE id = $1`, [c.space_id]);
      throw new HttpError(400, `La clase ${c.name} se da en ${own2?.name ?? 'otro espacio'}: programa la sesión en ese espacio`, 'CLASS_SPACE');
    }
    title = title || c.name;
    teacherId = teacherId ?? c.teacher_id;
    groupSize = groupSize ?? Math.min(c.default_capacity, space.allow_multi_group && space.capacity_per_group ? space.capacity_per_group : space.max_capacity);
  }
  if (teacherId) {
    await own(db, 'teachers', teacherId, tenantId, 'Profesor');
    // RQ62: el profesor debe estar asignado a la sede del espacio
    const [assigned] = await db.query(`SELECT 1 FROM teacher_sites WHERE teacher_id = $1 AND site_id = $2`, [teacherId, space.site_id]);
    if (!assigned) throw new HttpError(400, `El profesor no está asignado a la sede ${space.site_name}. Asígnalo en Profesores.`, 'TEACHER_SITE');
  }
  if (b.clientId) {
    const cl = await own(db, 'users', b.clientId, tenantId, 'Cliente');
    if (cl.role !== 'client') throw new HttpError(400, 'clientId no es un cliente');
  }
  if (!title) throw new HttpError(400, 'title: Escribe un título para la reserva');
  groupSize = groupSize ?? 1;
  const staff = isStaffish(req.user);

  return db.tx(async (q) => {
    // Serializa las reservas del mismo espacio, profesor y cliente: sin esto dos peticiones simultaneas podrian
    // validar el mismo horario libre y guardarse las dos (RQ18, RQ38, RQ62)
    await lockRow(q, 'spaces', space.id);
    if (teacherId) await lockRow(q, 'teachers', teacherId);
    if (b.clientId) await lockRow(q, 'users', b.clientId);
    const created: number[] = [];
    const conflicts: BookingConflict[] = [];
    const offsets = occurrenceOffsets(start, b.repeatWeeks, b.weekdays);
    for (const offset of offsets) {
      const s = new Date(start.getTime() + offset);
      const e = new Date(end.getTime() + offset);
      try {
        await assertSlotAvailable(q, tenantId, space, s, e, { groupSize: groupSize!, teacherId, clientId: b.clientId, staff });
      } catch (err) {
        if (opts.skipConflicts && err instanceof HttpError && err.status === 409) {
          conflicts.push({ startsAt: s.toISOString(), endsAt: e.toISOString(), code: err.code, message: err.message, ...(err.extra as object) });
          continue;
        }
        if (err instanceof HttpError && offsets.length > 1) err.message = `Sesión del ${localParts(s).date}: ${err.message}`;
        throw err;
      }
      const [row] = await q.query(
        `INSERT INTO bookings (tenant_id, site_id, space_id, kind, class_id, teacher_id, client_id, title, starts_at, ends_at, group_size, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
        [tenantId, space.site_id, space.id, b.kind, b.kind === 'class' ? b.classId : null, teacherId, b.clientId ?? null, title, s, e, groupSize, b.notes, req.user.id],
      );
      created.push(row.id);
    }
    const rows = created.length ? await q.query(`${BOOKING_SELECT} WHERE b.id IN ${idList(created)} ORDER BY b.starts_at`) : [];
    return { rows, conflicts };
  });
}

/** Crea una o varias reservas semanales validando cada una; si alguna choca no se guarda ninguna */
export async function createBookings(db: Db, req: Request, b: z.infer<typeof bookingBody>) {
  return (await createBookingsDetailed(db, req, b)).rows;
}

/** RQ69: horas antes del inicio hasta las que un profesor puede cancelar su sesion */
export async function teacherCancelHours(db: Db, tenantId: number): Promise<number> {
  const [t] = await db.query(`SELECT teacher_cancel_hours FROM tenants WHERE id = $1`, [tenantId]);
  return t?.teacher_cancel_hours ?? 24;
}

/** Avisa por correo a los clientes con cupo reservado que la clase se cancelo */
async function notifyCancelledClass(db: Db, bookingId: number) {
  const rows = await db.query(
    `SELECT u.email, u.full_name, b.title, b.starts_at, s.name AS site_name FROM class_reservations cr JOIN users u ON u.id = cr.client_id
       JOIN bookings b ON b.id = cr.booking_id JOIN sites s ON s.id = b.site_id
      WHERE cr.booking_id = $1 AND cr.status = 'confirmed' AND u.email IS NOT NULL`,
    [bookingId],
  );
  for (const c of rows) {
    const when = `${localParts(new Date(c.starts_at)).date} ${localParts(new Date(c.starts_at)).time}`;
    const body = compose([{ p: `Hola ${c.full_name},` }, { p: `La clase ${c.title} del ${when} en ${c.site_name} fue cancelada. No se descuenta de tu plan.` }]);
    await sendMail({ to: c.email, subject: `Clase cancelada: ${c.title}`, ...body }).catch((e) => console.error('[correo] clase cancelada:', e));
  }
}

export function bookingRoutes(db: Db) {
  const r = Router();

  const listQuery = z.object({
    from: dateStr.optional(), to: dateStr.optional(), siteId: optId, spaceId: optId, academyId: optId,
    kind: z.enum(['class', 'rental']).optional(), includeCancelled: z.coerce.boolean().optional(),
  });

  /**
   * Agenda. Personal: todo lo de la organizacion. Cliente: las clases de sus academias y sus propias reservas
   * (de las reservas de otros solo ve que el espacio esta ocupado, sin datos personales).
   */
  r.get('/bookings', async (req, res) => {
    const q = parse(listQuery, req.query);
    const today = todayLocal();
    const { from, to } = range({ from: q.from ?? today, to: q.to ?? q.from ?? today });
    const academies = await visibleAcademyIds(db, req);
    const [start, end] = dayBounds(from, to);
    const rows = await db.query(
      `${BOOKING_SELECT}
        WHERE b.tenant_id = $1 AND s.academy_id IN ${idList(academies)}
          AND b.starts_at >= $2 AND b.starts_at < $3
          AND ($4::int IS NULL OR b.site_id = $4) AND ($5::int IS NULL OR b.space_id = $5)
          AND ($6::int IS NULL OR s.academy_id = $6) AND ($7::text IS NULL OR b.kind = $7)
          AND ($8 = true OR b.status = 'confirmed')
        ORDER BY b.starts_at`,
      [req.user.tenantId, start, end, q.siteId ?? null, q.spaceId ?? null, q.academyId ?? null, q.kind ?? null, !!q.includeCancelled],
    );
    if (isStaffish(req.user)) return res.json(rows);
    const mine = await myReservationIds(db, req.user.id, rows.filter((b) => b.kind === 'class').map((b) => b.id));
    res.json(rows.map((b) => ({ ...b, my_reservation_id: mine.get(b.id) ?? null })).map((b) => (b.kind === 'rental' && b.client_id !== req.user.id
      ? { ...b, title: 'Espacio reservado', client_id: null, client_name: null, notes: null, paid: 0 }
      : { ...b, paid: b.client_id === req.user.id ? b.paid : 0 })));
  });

  r.get('/bookings/:id', async (req, res) => {
    const bid = parse(id, req.params.id);
    const [b] = await db.query(`${BOOKING_SELECT} WHERE b.id = $1 AND b.tenant_id = $2`, [bid, req.user.tenantId]);
    if (!b || (!isStaffish(req.user) && b.client_id !== req.user.id)) throw new HttpError(404, 'Reserva no encontrada', 'NOT_FOUND');
    const attendees = isStaffish(req.user)
      ? await db.query(`SELECT att.id, att.scanned_at, att.over_capacity, u.id AS client_id, u.full_name FROM attendances att JOIN users u ON u.id = att.client_id WHERE att.booking_id = $1 ORDER BY att.scanned_at`, [bid])
      : [];
    const payments = await db.query(`SELECT id, amount::float8, method, reference, paid_at FROM payments WHERE booking_id = $1 ORDER BY paid_at`, [bid]);
    const reservations = isStaffish(req.user)
      ? await db.query(`SELECT cr.id, cr.created_at, u.id AS client_id, u.full_name FROM class_reservations cr JOIN users u ON u.id = cr.client_id WHERE cr.booking_id = $1 AND cr.status = 'confirmed' ORDER BY cr.created_at`, [bid])
      : [];
    res.json({ ...b, attendeeList: attendees, reservationList: reservations, payments });
  });

  r.post('/bookings', async (req, res) => {
    const b = parse(bookingBody, req.body);
    const needed = b.kind === 'class' ? 'classes' : 'bookings';
    if (!req.user.permissions.includes(needed)) throw new HttpError(403, 'No tienes permiso para esta acción', 'FORBIDDEN');
    // RQ69: el profesor programa sus clases y separa espacios a su nombre
    if (req.user.teacherId != null) {
      if (b.kind === 'class') assertOwnTeacher(req.user, (await own(db, 'classes', b.classId ?? 0, req.user.tenantId, 'Clase')).teacher_id);
      if (b.clientId) throw new HttpError(403, 'Como profesor solo separas espacios para tus clases', 'FORBIDDEN');
      b.teacherId = req.user.teacherId;
    }
    res.status(201).json(await createBookings(db, req, b));
  });

  // El cliente reserva un espacio para el (RQ7); el pago lo registra el personal
  r.post('/me/bookings', async (req, res) => {
    if (req.user.role !== 'client') throw new HttpError(400, 'Solo para clientes');
    const b = parse(bookingBody.pick({ spaceId: true, startsAt: true, endsAt: true, groupSize: true, notes: true }), req.body);
    const space = await loadSpace(db, b.spaceId, req.user.tenantId);
    if (!(await visibleAcademyIds(db, req)).includes(space.academy_id)) throw new HttpError(404, 'Espacio no encontrado', 'NOT_FOUND');
    if (new Date(b.startsAt) < new Date()) throw new HttpError(400, 'La reserva debe ser en el futuro');
    await assertClientPlan(db, req, space.academy_id, space.site_id, 'rental');
    await assertNoOverlap(db, req.user.id, new Date(b.startsAt), new Date(b.endsAt));
    const rows = await createBookings(db, req, {
      ...b, kind: 'rental', clientId: req.user.id, title: `Reserva de ${req.user.fullName}`, repeatWeeks: 1, classId: null, teacherId: null,
    });
    res.status(201).json(rows[0]);
  });

  r.post('/bookings/:id/cancel', async (req, res) => {
    const b = await own(db, 'bookings', parse(id, req.params.id), req.user.tenantId, 'Reserva');
    const canStaff = req.user.permissions.includes(b.kind === 'class' ? 'classes' : 'bookings');
    const isOwner = req.user.role === 'client' && b.client_id === req.user.id;
    if (!canStaff && !isOwner) throw new HttpError(403, 'No tienes permiso para esta acción', 'FORBIDDEN');
    if (isOwner && !canStaff) {
      // RQ52: no se cancela lo ya tomado ni lo vencido
      const [att] = await db.query(`SELECT 1 FROM attendances WHERE booking_id = $1 AND client_id = $2`, [b.id, req.user.id]);
      if (att) throw new HttpError(409, 'Esta reserva ya fue tomada: no se puede cancelar', 'ALREADY_TAKEN');
      if (new Date(b.ends_at) < new Date()) throw new HttpError(409, 'Esta reserva ya venció: no se puede cancelar', 'EXPIRED');
      await assertCanCancel(db, req.user.tenantId, b.starts_at, b.site_id);
    }
    // RQ69: el profesor cancela sus sesiones con la anticipacion que define la organizacion; cuentan como clases a
    // las que no pudo asistir. El personal puede marcar el mismo motivo al cancelar por el.
    const body = parse(z.object({ reason: z.enum(['teacher_absent', 'other']).optional() }), req.body ?? {});
    let reason: string | null = body.reason ?? null;
    if (req.user.teacherId != null && !isOwner) {
      assertOwnTeacher(req.user, b.teacher_id, 'la sesión');
      if (b.status !== 'confirmed') throw new HttpError(409, 'La sesión ya está cancelada', 'ALREADY_CANCELLED');
      const hours = await teacherCancelHours(db, req.user.tenantId);
      if (Date.now() > new Date(b.starts_at).getTime() - hours * 3600_000) {
        throw new HttpError(409, `Los profesores solo pueden cancelar ${hours === 0 ? 'antes de que empiece la clase' : hours % 24 === 0 ? `hasta ${hours / 24} día(s) antes` : `hasta ${hours} hora(s) antes`}. Comunícate con la academia.`, 'CANCEL_DEADLINE', { cancelHours: hours });
      }
      reason = 'teacher_absent';
    }
    await db.query(`UPDATE bookings SET status = 'cancelled', cancelled_by = $2, cancelled_at = $3, cancel_reason = $4 WHERE id = $1`, [b.id, req.user.id, new Date(), reason]);
    if (b.kind === 'class' && new Date(b.starts_at) > new Date()) void notifyCancelledClass(db, b.id);
    res.json({ ok: true });
  });

  return r;
}
