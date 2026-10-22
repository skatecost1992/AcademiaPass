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
import { HttpError, isStaffish } from '../auth.ts';
import type { Db } from '../db.ts';
import { assertSpaceAvailable, assertWithinOpeningHours, type Space } from '../lib/capacity.ts';
import { TZ, dateStr, id, isoDateTime, optId, optText, own, parse, range, todayLocal } from '../lib/util.ts';
import { visibleAcademyIds } from './setup.ts';

const WEEK_MS = 7 * 24 * 3600_000;

const bookingBody = z.object({
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
});

export const BOOKING_SELECT = `
  SELECT b.id, b.kind, b.title, b.starts_at, b.ends_at, b.group_size, b.status, b.notes, b.site_id, b.space_id,
         b.class_id, b.teacher_id, b.client_id,
         sp.name AS space_name, s.name AS site_name, s.academy_id, a.name AS academy_name,
         t.full_name AS teacher_name, t.kind AS teacher_kind, cu.full_name AS client_name,
         (SELECT count(*)::int FROM attendances at WHERE at.booking_id = b.id) AS attendees,
         (SELECT coalesce(sum(amount), 0)::float8 FROM payments p WHERE p.booking_id = b.id) AS paid
    FROM bookings b
    JOIN spaces sp ON sp.id = b.space_id
    JOIN sites s ON s.id = b.site_id
    JOIN academies a ON a.id = s.academy_id
    LEFT JOIN teachers t ON t.id = b.teacher_id
    LEFT JOIN users cu ON cu.id = b.client_id`;

async function loadSpace(db: Db, spaceId: number, tenantId: number) {
  const [sp] = await db.query(
    `SELECT sp.*, s.name AS site_name, s.opening_hours, s.academy_id, s.active AS site_active
       FROM spaces sp JOIN sites s ON s.id = sp.site_id WHERE sp.id = $1 AND sp.tenant_id = $2`,
    [spaceId, tenantId],
  );
  if (!sp) throw new HttpError(404, 'Espacio no encontrado', 'NOT_FOUND');
  if (!sp.active || !sp.site_active) throw new HttpError(409, 'El espacio o la sede están inactivos', 'INACTIVE');
  return sp as Space & { site_name: string; opening_hours: any[]; academy_id: number };
}

/** Crea una o varias reservas semanales validando cada una; si alguna choca no se guarda ninguna */
async function createBookings(db: Db, req: Request, b: z.infer<typeof bookingBody>) {
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
    title = title || c.name;
    teacherId = teacherId ?? c.teacher_id;
    groupSize = groupSize ?? Math.min(c.default_capacity, space.allow_multi_group && space.capacity_per_group ? space.capacity_per_group : space.max_capacity);
  }
  if (teacherId) await own(db, 'teachers', teacherId, tenantId, 'Profesor');
  if (b.clientId) {
    const cl = await own(db, 'users', b.clientId, tenantId, 'Cliente');
    if (cl.role !== 'client') throw new HttpError(400, 'clientId no es un cliente');
  }
  if (!title) throw new HttpError(400, 'title: Escribe un título para la reserva');
  groupSize = groupSize ?? 1;

  return db.tx(async (q) => {
    const created = [];
    for (let i = 0; i < b.repeatWeeks; i++) {
      const s = new Date(start.getTime() + i * WEEK_MS);
      const e = new Date(end.getTime() + i * WEEK_MS);
      try {
        assertWithinOpeningHours(space.site_name, space.opening_hours, s, e);
        await assertSpaceAvailable(q, space, s, e, groupSize!);
      } catch (err) {
        if (err instanceof HttpError && b.repeatWeeks > 1) err.message = `Semana ${i + 1} (${s.toISOString().slice(0, 10)}): ${err.message}`;
        throw err;
      }
      const [row] = await q.query(
        `INSERT INTO bookings (tenant_id, site_id, space_id, kind, class_id, teacher_id, client_id, title, starts_at, ends_at, group_size, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
        [tenantId, space.site_id, space.id, b.kind, b.kind === 'class' ? b.classId : null, teacherId, b.clientId ?? null, title, s, e, groupSize, b.notes, req.user.id],
      );
      created.push(row.id);
    }
    return q.query(`${BOOKING_SELECT} WHERE b.id = ANY($1::int[]) ORDER BY b.starts_at`, [created]);
  });
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
    const rows = await db.query(
      `${BOOKING_SELECT}
        WHERE b.tenant_id = $1 AND s.academy_id = ANY($2::int[])
          AND b.starts_at >= ($3::date::timestamp AT TIME ZONE $5) AND b.starts_at < (($4::date + 1)::timestamp AT TIME ZONE $5)
          AND ($6::int IS NULL OR b.site_id = $6) AND ($7::int IS NULL OR b.space_id = $7)
          AND ($8::int IS NULL OR s.academy_id = $8) AND ($9::text IS NULL OR b.kind = $9)
          AND ($10 OR b.status = 'confirmed')
        ORDER BY b.starts_at`,
      [req.user.tenantId, academies, from, to, TZ, q.siteId ?? null, q.spaceId ?? null, q.academyId ?? null, q.kind ?? null, !!q.includeCancelled],
    );
    if (isStaffish(req.user)) return res.json(rows);
    res.json(rows.map((b) => (b.kind === 'rental' && b.client_id !== req.user.id
      ? { ...b, title: 'Espacio reservado', client_id: null, client_name: null, notes: null, paid: 0 }
      : { ...b, paid: b.client_id === req.user.id ? b.paid : 0 })));
  });

  r.get('/bookings/:id', async (req, res) => {
    const bid = parse(id, req.params.id);
    const [b] = await db.query(`${BOOKING_SELECT} WHERE b.id = $1 AND b.tenant_id = $2`, [bid, req.user.tenantId]);
    if (!b || (!isStaffish(req.user) && b.client_id !== req.user.id)) throw new HttpError(404, 'Reserva no encontrada', 'NOT_FOUND');
    const attendees = isStaffish(req.user)
      ? await db.query(`SELECT at.id, at.scanned_at, at.over_capacity, u.id AS client_id, u.full_name FROM attendances at JOIN users u ON u.id = at.client_id WHERE at.booking_id = $1 ORDER BY at.scanned_at`, [bid])
      : [];
    const payments = await db.query(`SELECT id, amount::float8, method, reference, paid_at FROM payments WHERE booking_id = $1 ORDER BY paid_at`, [bid]);
    res.json({ ...b, attendeeList: attendees, payments });
  });

  r.post('/bookings', async (req, res) => {
    const b = parse(bookingBody, req.body);
    const needed = b.kind === 'class' ? 'classes' : 'bookings';
    if (!req.user.permissions.includes(needed)) throw new HttpError(403, 'No tienes permiso para esta acción', 'FORBIDDEN');
    res.status(201).json(await createBookings(db, req, b));
  });

  // El cliente reserva un espacio para el (RQ7); el pago lo registra el personal
  r.post('/me/bookings', async (req, res) => {
    if (req.user.role !== 'client') throw new HttpError(400, 'Solo para clientes');
    const b = parse(bookingBody.pick({ spaceId: true, startsAt: true, endsAt: true, groupSize: true, notes: true }), req.body);
    const space = await loadSpace(db, b.spaceId, req.user.tenantId);
    if (!(await visibleAcademyIds(db, req)).includes(space.academy_id)) throw new HttpError(404, 'Espacio no encontrado', 'NOT_FOUND');
    if (new Date(b.startsAt) < new Date()) throw new HttpError(400, 'La reserva debe ser en el futuro');
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
    if (isOwner && !canStaff && new Date(b.starts_at) < new Date()) throw new HttpError(409, 'La reserva ya empezó; pide al personal que la cancele');
    await db.query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [b.id]);
    res.json({ ok: true });
  });

  return r;
}
