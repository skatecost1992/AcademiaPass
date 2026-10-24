/**
 * Reglas de reserva y reservas de cupo en clases.
 *  - RQ30: solo se reserva lo que el admin definio: sesiones de clase programadas y espacios activos con aforo.
 *  - RQ31: el cliente necesita un plan vigente que incluya la academia y la sede (y el tipo: clases o reservas).
 *  - RQ32: el cliente solo cancela hasta `cancel_hours` horas antes del inicio (lo define el admin).
 *  - RQ35: ese limite se define por sede y por academia; si no, aplica el de la organizacion.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { HttpError, requirePerm } from '../auth.ts';
import type { Db } from '../db.ts';
import { KINDS_FOR_CONTEXT, membershipsOf, pickMembership } from '../lib/memberships.ts';
import { assertWithinHorizon } from '../lib/scheduling.ts';
import { dateStr, dayBounds, id, idList, localParts, lockRow, parse, range } from '../lib/util.ts';
import { visibleAcademyIds } from './setup.ts';

export async function cancelHours(db: Db, tenantId: number): Promise<number> {
  const [t] = await db.query(`SELECT cancel_hours FROM tenants WHERE id = $1`, [tenantId]);
  return t?.cancel_hours ?? 24;
}

/** Limite que aplica en una sede: el de la sede, si no el de su academia, si no el de la organizacion (RQ35) */
export async function siteCancelHours(db: Db, tenantId: number, siteId: number): Promise<number> {
  const [r] = await db.query(
    `SELECT coalesce(s.cancel_hours, a.cancel_hours, t.cancel_hours) AS hours
       FROM sites s JOIN academies a ON a.id = s.academy_id JOIN tenants t ON t.id = s.tenant_id
      WHERE s.id = $1 AND s.tenant_id = $2`,
    [siteId, tenantId],
  );
  return r?.hours ?? (await cancelHours(db, tenantId));
}

export const cancelRuleText = (hours: number) =>
  hours === 0 ? 'antes de que empiece' : hours % 24 === 0 ? `hasta ${hours / 24} día(s) antes` : `hasta ${hours} hora(s) antes`;

/** Lanza 409 si ya paso el limite de la sede para que el cliente cancele (RQ32, RQ35) */
export async function assertCanCancel(db: Db, tenantId: number, startsAt: Date | string, siteId: number) {
  const hours = await siteCancelHours(db, tenantId, siteId);
  const limit = new Date(startsAt).getTime() - hours * 3600_000;
  if (Date.now() > limit) {
    throw new HttpError(409, `En esta sede solo se puede cancelar ${cancelRuleText(hours)}. Comunícate con la academia.`, 'CANCEL_DEADLINE', { cancelHours: hours });
  }
}

/** Exige al cliente un plan vigente para ese lugar y tipo de uso (RQ31) */
export async function assertClientPlan(db: Db, req: Request, academyId: number, siteId: number, context: 'class' | 'rental') {
  const picked = pickMembership(await membershipsOf(db, [req.user.id]), KINDS_FOR_CONTEXT[context], academyId, siteId);
  if (!picked.membership) {
    const what = context === 'class' ? 'reservar esta clase' : 'reservar este espacio';
    throw new HttpError(409, `Necesitas un plan vigente que incluya esta academia y sede para ${what}.`, 'NO_PLAN', { reasons: picked.reasons });
  }
  return picked.membership;
}

/**
 * RQ38: una persona no puede estar en dos lugares a la vez. Revisa sus reservas de espacio y sus cupos en clases
 * confirmados que se crucen con [start, end).
 */
export async function assertNoOverlap(db: Db, clientId: number, start: Date, end: Date, ignoreBookingId?: number) {
  const [clash] = await db.query(
    `SELECT b.title, b.starts_at, b.ends_at, s.name AS site_name, sp.name AS space_name
       FROM bookings b JOIN sites s ON s.id = b.site_id JOIN spaces sp ON sp.id = b.space_id
      WHERE b.status = 'confirmed' AND b.starts_at < $3 AND b.ends_at > $2 AND b.id <> $4
        AND (b.client_id = $1 OR EXISTS (SELECT 1 FROM class_reservations cr WHERE cr.booking_id = b.id AND cr.client_id = $1 AND cr.status = 'confirmed'))
      ORDER BY b.starts_at`,
    [clientId, start, end, ignoreBookingId ?? 0],
  );
  if (clash) {
    const hm = (d: Date | string) => localParts(new Date(d)).time;
    throw new HttpError(409,
      `No puedes reservar dos espacios al mismo tiempo: ya tienes "${clash.title}" en ${clash.site_name} · ${clash.space_name} de ${hm(clash.starts_at)} a ${hm(clash.ends_at)}.`,
      'OVERLAP', { clash: { title: clash.title, startsAt: clash.starts_at, endsAt: clash.ends_at, site: clash.site_name, space: clash.space_name } });
  }
}

const RESERVATION_SELECT = `
  SELECT cr.id, cr.status, cr.created_at, cr.booking_id, b.site_id, b.title, b.starts_at, b.ends_at, b.group_size, b.status AS booking_status,
         s.name AS site_name, sp.name AS space_name, a.name AS academy_name, t.full_name AS teacher_name,
         (SELECT count(*) FROM class_reservations x WHERE x.booking_id = b.id AND x.status = 'confirmed') AS reserved
    FROM class_reservations cr
    JOIN bookings b ON b.id = cr.booking_id JOIN sites s ON s.id = b.site_id JOIN spaces sp ON sp.id = b.space_id
    JOIN academies a ON a.id = s.academy_id LEFT JOIN teachers t ON t.id = b.teacher_id`;

type ReservationState = 'attended' | 'cancelled' | 'deleted' | 'missed' | 'pending';

export function reservationRoutes(db: Db) {
  const r = Router();

  // RQ48, RQ49: todas las reservas del cliente (cupos en clases y espacios) con su estado, de la mas reciente a la
  // mas antigua; sin rango solo las 20 mas recientes, con rango desde/hasta (maximo un ano) todas las del rango
  r.get('/me/reservations', async (req, res) => {
    if (req.user.role !== 'client') throw new HttpError(400, 'Solo para clientes');
    const q = parse(z.object({ from: dateStr.optional(), to: dateStr.optional() }), req.query);
    const hasRange = !!(q.from || q.to);
    const { from, to } = hasRange ? range(q) : { from: '1900-01-01', to: '2999-12-31' };
    const [start, end] = dayBounds(from, to);
    const me = req.user.id;
    const classes = await db.query(
      `SELECT cr.id, 'class' AS type, cr.status AS my_status, cr.created_at, cr.cancelled_at, cr.penalty_membership_id,
              b.id AS booking_id, b.title, b.starts_at, b.ends_at, b.status AS booking_status,
              s.name AS site_name, sp.name AS space_name, a.name AS academy_name, t.full_name AS teacher_name,
              (SELECT count(*) FROM attendances att WHERE att.booking_id = b.id AND att.client_id = $1) AS attended
         FROM class_reservations cr JOIN bookings b ON b.id = cr.booking_id JOIN sites s ON s.id = b.site_id
         JOIN spaces sp ON sp.id = b.space_id JOIN academies a ON a.id = s.academy_id LEFT JOIN teachers t ON t.id = b.teacher_id
        WHERE cr.client_id = $1 AND b.starts_at >= $2 AND b.starts_at < $3`,
      [me, start, end],
    );
    const rentals = await db.query(
      `SELECT b.id, 'rental' AS type, b.status AS booking_status, b.created_at, b.cancelled_at, b.cancelled_by,
              b.id AS booking_id, b.title, b.starts_at, b.ends_at, s.name AS site_name, sp.name AS space_name, a.name AS academy_name,
              (SELECT count(*) FROM attendances att WHERE att.booking_id = b.id AND att.client_id = $1) AS attended,
              (SELECT coalesce(sum(amount), 0) FROM payments p WHERE p.booking_id = b.id) AS paid
         FROM bookings b JOIN sites s ON s.id = b.site_id JOIN spaces sp ON sp.id = b.space_id JOIN academies a ON a.id = s.academy_id
        WHERE b.client_id = $1 AND b.kind = 'rental' AND b.starts_at >= $2 AND b.starts_at < $3`,
      [me, start, end],
    );
    const now = Date.now();
    const stateOf = (x: any): ReservationState => {
      if (Number(x.attended) > 0) return 'attended';
      if (x.type === 'class') {
        if (x.my_status === 'cancelled') return 'cancelled';
        if (x.booking_status === 'cancelled') return 'deleted';
      } else if (x.booking_status === 'cancelled') {
        return x.cancelled_by === me ? 'cancelled' : 'deleted';
      }
      return new Date(x.ends_at).getTime() < now ? 'missed' : 'pending';
    };
    const rows = [...classes, ...rentals]
      .map((x) => ({ ...x, attended: Number(x.attended) > 0, paid: x.paid == null ? undefined : Number(x.paid), state: stateOf(x) }))
      .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());
    const limited = hasRange ? rows.slice(0, 1000) : rows.slice(0, 20);
    res.json({ total: rows.length, truncated: limited.length < rows.length, from: hasRange ? from : null, to: hasRange ? to : null, rows: limited });
  });

  // ------------------------------------------------------------------ Reglas de la organizacion (RQ32)
  const loadSettings = async (tenantId: number) => ({
    cancelHours: await cancelHours(db, tenantId),
    bookingHorizonMonths: (await db.query(`SELECT booking_horizon_months FROM tenants WHERE id = $1`, [tenantId]))[0]?.booking_horizon_months ?? 3,
    // RQ69: horas antes del inicio hasta las que un profesor puede cancelar su sesion
    teacherCancelHours: (await db.query(`SELECT teacher_cancel_hours FROM tenants WHERE id = $1`, [tenantId]))[0]?.teacher_cancel_hours ?? 24,
    academies: (await db.query(`SELECT id, name, cancel_hours FROM academies WHERE tenant_id = $1 ORDER BY name`, [tenantId]))
      .map((a) => ({ id: a.id, name: a.name, cancelHours: a.cancel_hours })),
    sites: (await db.query(
      `SELECT s.id, s.name, s.academy_id, a.name AS academy_name, s.cancel_hours
         FROM sites s JOIN academies a ON a.id = s.academy_id WHERE s.tenant_id = $1 ORDER BY a.name, s.name`,
      [tenantId],
    )).map((s) => ({ id: s.id, name: s.name, academyId: s.academy_id, academyName: s.academy_name, cancelHours: s.cancel_hours })),
  });

  r.get('/settings', async (req, res) => {
    res.json(await loadSettings(req.user.tenantId));
  });

  // Limite general y, opcionalmente, por academia y por sede (null = hereda)
  const hours = z.coerce.number().int().min(0).max(720);
  // RQ44: lo configura el admin o cualquier usuario con el permiso de reglas de reserva
  r.put('/settings', requirePerm('booking_rules'), async (req, res) => {
    const b = parse(z.object({
      cancelHours: hours.optional(),
      bookingHorizonMonths: z.coerce.number().int().min(1).max(24).optional(), // RQ47
      teacherCancelHours: hours.optional(), // RQ69
      academies: z.array(z.object({ id, cancelHours: hours.nullable() })).default([]),
      sites: z.array(z.object({ id, cancelHours: hours.nullable() })).default([]),
    }), req.body);
    const t = req.user.tenantId;
    await db.tx(async (q) => {
      if (b.cancelHours != null) await q.query(`UPDATE tenants SET cancel_hours = $2 WHERE id = $1`, [t, b.cancelHours]);
      if (b.bookingHorizonMonths != null) await q.query(`UPDATE tenants SET booking_horizon_months = $2 WHERE id = $1`, [t, b.bookingHorizonMonths]);
      if (b.teacherCancelHours != null) await q.query(`UPDATE tenants SET teacher_cancel_hours = $2 WHERE id = $1`, [t, b.teacherCancelHours]);
      for (const a of b.academies) {
        const n = await q.query(`UPDATE academies SET cancel_hours = $3 WHERE id = $1 AND tenant_id = $2 RETURNING id`, [a.id, t, a.cancelHours]);
        if (!n.length) throw new HttpError(404, 'Academia no encontrada', 'NOT_FOUND');
      }
      for (const s of b.sites) {
        const n = await q.query(`UPDATE sites SET cancel_hours = $3 WHERE id = $1 AND tenant_id = $2 RETURNING id`, [s.id, t, s.cancelHours]);
        if (!n.length) throw new HttpError(404, 'Sede no encontrada', 'NOT_FOUND');
      }
    });
    res.json(await loadSettings(t));
  });

  // ------------------------------------------------------------------ Cupos en clases del cliente
  r.get('/me/class-reservations', async (req, res) => {
    if (req.user.role !== 'client') throw new HttpError(400, 'Solo para clientes');
    const rows = await db.query(`${RESERVATION_SELECT} WHERE cr.client_id = $1 AND cr.status = 'confirmed' ORDER BY b.starts_at`, [req.user.id]);
    const limits = new Map<number, number>();
    for (const x of rows) if (!limits.has(x.site_id)) limits.set(x.site_id, await siteCancelHours(db, req.user.tenantId, x.site_id));
    res.json(rows.map((x) => {
      const h = limits.get(x.site_id)!;
      return { ...x, reserved: Number(x.reserved), cancel_hours: h, cancel_until: new Date(new Date(x.starts_at).getTime() - h * 3600_000).toISOString() };
    }));
  });

  r.post('/me/class-reservations', async (req, res) => {
    if (req.user.role !== 'client') throw new HttpError(400, 'Solo para clientes');
    const { bookingId } = parse(z.object({ bookingId: id }), req.body);
    const [b] = await db.query(
      `SELECT b.*, s.academy_id, sp.active AS space_active, sp.max_capacity
         FROM bookings b JOIN sites s ON s.id = b.site_id JOIN spaces sp ON sp.id = b.space_id
        WHERE b.id = $1 AND b.tenant_id = $2`,
      [bookingId, req.user.tenantId],
    );
    // RQ30: solo sesiones de clase programadas por la academia, en espacios activos con aforo definido
    if (!b || b.kind !== 'class' || !(await visibleAcademyIds(db, req)).includes(b.academy_id)) throw new HttpError(404, 'Clase no encontrada', 'NOT_FOUND');
    if (b.status !== 'confirmed' || !b.space_active || !(b.max_capacity > 0)) throw new HttpError(409, 'Esta clase no está disponible para reservas', 'NOT_AVAILABLE');
    if (new Date(b.starts_at) <= new Date()) throw new HttpError(409, 'La clase ya empezó', 'NOT_AVAILABLE');
    await assertWithinHorizon(db, req.user.tenantId, new Date(b.starts_at)); // RQ47
    await assertClientPlan(db, req, b.academy_id, b.site_id, 'class');

    const reservationId = await db.tx(async (q) => {
      // Serializa las reservas de la misma clase y del mismo cliente: dos peticiones simultaneas no pueden tomar el
      // ultimo cupo a la vez (RQ20) ni reservar dos clases que se cruzan (RQ38)
      await lockRow(q, 'bookings', b.id);
      await lockRow(q, 'users', req.user.id);
      await assertNoOverlap(q, req.user.id, new Date(b.starts_at), new Date(b.ends_at), b.id);
      const [dup] = await q.query(`SELECT id FROM class_reservations WHERE booking_id = $1 AND client_id = $2 AND status = 'confirmed'`, [b.id, req.user.id]);
      if (dup) throw new HttpError(409, 'Ya tienes un cupo en esta clase', 'ALREADY_RESERVED');
      const [{ n }] = await q.query(`SELECT count(*) AS n FROM class_reservations WHERE booking_id = $1 AND status = 'confirmed'`, [b.id]);
      if (Number(n) >= b.group_size) throw new HttpError(409, `La clase está llena (${n}/${b.group_size})`, 'CAPACITY_FULL');
      const [row] = await q.query(
        `INSERT INTO class_reservations (tenant_id, booking_id, client_id) VALUES ($1, $2, $3) RETURNING id`,
        [req.user.tenantId, b.id, req.user.id],
      );
      return row.id as number;
    });
    const [row] = await db.query(`${RESERVATION_SELECT} WHERE cr.id = $1`, [reservationId]);
    res.status(201).json({ ...row, reserved: Number(row.reserved) });
  });

  r.post('/me/class-reservations/:id/cancel', async (req, res) => {
    const [cr] = await db.query(
      `SELECT cr.id, cr.status, cr.booking_id, b.starts_at, b.ends_at, b.site_id FROM class_reservations cr JOIN bookings b ON b.id = cr.booking_id
        WHERE cr.id = $1 AND cr.client_id = $2`,
      [parse(id, req.params.id), req.user.id],
    );
    if (!cr) throw new HttpError(404, 'Reserva no encontrada', 'NOT_FOUND');
    if (cr.status !== 'confirmed') throw new HttpError(409, 'La reserva ya está cancelada');
    // RQ52: no se cancela una clase ya tomada ni una vencida por inasistencia
    const [att] = await db.query(`SELECT 1 FROM attendances WHERE booking_id = $1 AND client_id = $2`, [cr.booking_id, req.user.id]);
    if (att) throw new HttpError(409, 'Esta clase ya fue tomada: no se puede cancelar', 'ALREADY_TAKEN');
    if (new Date(cr.ends_at) < new Date()) throw new HttpError(409, 'Esta clase ya venció por inasistencia: no se puede cancelar', 'EXPIRED');
    await assertCanCancel(db, req.user.tenantId, cr.starts_at, cr.site_id);
    await db.query(`UPDATE class_reservations SET status = 'cancelled', cancelled_at = $2 WHERE id = $1`, [cr.id, new Date()]);
    res.json({ ok: true });
  });

  return r;
}

/** Ids de las reservas de cupo del cliente en esas sesiones: { bookingId: reservationId } */
export async function myReservationIds(db: Db, clientId: number, bookingIds: number[]) {
  if (!bookingIds.length) return new Map<number, number>();
  const rows = await db.query(
    `SELECT id, booking_id FROM class_reservations WHERE client_id = $1 AND status = 'confirmed' AND booking_id IN ${idList(bookingIds)}`,
    [clientId],
  );
  return new Map(rows.map((x) => [x.booking_id as number, x.id as number]));
}
