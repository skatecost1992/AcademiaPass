/**
 * Reglas de agenda:
 *  - RQ42: franjas libres de un espacio en un dia (para sugerirlas cuando el horario elegido esta ocupado).
 *  - RQ47: limite superior, en meses, hasta el que se puede reservar o agendar.
 *  - RQ52: un cupo reservado y no tomado se descuenta del plan cuando termina la clase.
 */
import { HttpError } from '../auth.ts';
import type { Db } from '../db.ts';
import { KINDS_FOR_CONTEXT, coversPlace, membershipsOf } from './memberships.ts';
import { dayBounds, localParts } from './util.ts';

interface Slot { day: number; open: string; close: string }

const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const toHm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const parseHours = (v: unknown): Slot[] => (typeof v === 'string' ? JSON.parse(v) : (v as Slot[] | null)) ?? [];

/**
 * Franjas libres ('HH:MM-HH:MM') de un espacio en una fecha local: dentro del horario del espacio (o de la sede)
 * y sin llegar al maximo de grupos simultaneos.
 */
export async function freeSlots(db: Db, spaceId: number, date: string, minMinutes = 30): Promise<string[]> {
  const [sp] = await db.query(
    `SELECT sp.opening_hours, sp.max_groups, sp.allow_multi_group, s.opening_hours AS site_hours
       FROM spaces sp JOIN sites s ON s.id = sp.site_id WHERE sp.id = $1`,
    [spaceId],
  );
  if (!sp) return [];
  const own = parseHours(sp.opening_hours);
  const hours = own.length ? own : parseHours(sp.site_hours);
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const open = hours.filter((h) => h.day === day).map((h) => [toMin(h.open), toMin(h.close)] as [number, number]);
  if (!open.length) return [];

  const [start, end] = dayBounds(date, date);
  const bookings = await db.query(
    `SELECT starts_at, ends_at FROM bookings WHERE space_id = $1 AND status = 'confirmed' AND starts_at < $3 AND ends_at > $2`,
    [spaceId, start, end],
  );
  const maxGroups = sp.allow_multi_group ? sp.max_groups : 1;
  const busy = bookings.map((b) => {
    const s = localParts(new Date(b.starts_at));
    const e = localParts(new Date(b.ends_at));
    return [s.date < date ? 0 : toMin(s.time), e.date > date ? 24 * 60 : toMin(e.time)] as [number, number];
  });
  // Minuto a minuto es simple y suficiente: un dia tiene 1440 minutos
  const used = new Array(24 * 60).fill(0);
  for (const [a, b] of busy) for (let m = a; m < b; m++) used[m]++;
  const free: string[] = [];
  for (const [a, b] of open) {
    let from = -1;
    for (let m = a; m <= b; m++) {
      const ok = m < b && used[m] < maxGroups;
      if (ok && from < 0) from = m;
      if (!ok && from >= 0) {
        if (m - from >= minMinutes) free.push(`${toHm(from)}-${toHm(m)}`);
        from = -1;
      }
    }
  }
  return free;
}

/**
 * RQ60: ocupacion del espacio en un dia, sin datos de quien reservo: cada franja reservada con los cupos que
 * quedan libres en ella (aforo menos las personas de todas las reservas que se cruzan).
 */
export async function dayOccupancy(db: Db, spaceId: number, date: string) {
  const [sp] = await db.query(`SELECT max_capacity, allow_multi_group, max_groups FROM spaces WHERE id = $1`, [spaceId]);
  const [start, end] = dayBounds(date, date);
  const rows = await db.query(
    `SELECT starts_at, ends_at, group_size FROM bookings WHERE space_id = $1 AND status = 'confirmed' AND starts_at < $3 AND ends_at > $2 ORDER BY starts_at`,
    [spaceId, start, end],
  );
  const capacity = sp?.max_capacity ?? 0;
  const busy = rows.map((r) => {
    const s = new Date(r.starts_at).getTime();
    const e = new Date(r.ends_at).getTime();
    const overlapping = rows.filter((o) => new Date(o.starts_at).getTime() < e && new Date(o.ends_at).getTime() > s);
    const people = overlapping.reduce((sum, o) => sum + o.group_size, 0);
    const groupsFull = !sp?.allow_multi_group || overlapping.length >= sp.max_groups;
    return {
      from: localParts(new Date(r.starts_at)).time,
      to: localParts(new Date(r.ends_at)).time,
      label: 'Reservado',
      spotsLeft: groupsFull ? 0 : Math.max(0, capacity - people),
    };
  });
  return { capacity, busy };
}

/** RQ47: no se reserva ni se agenda mas alla del limite de meses definido por la academia */
export async function assertWithinHorizon(db: Db, tenantId: number, startsAt: Date) {
  const [t] = await db.query(`SELECT booking_horizon_months FROM tenants WHERE id = $1`, [tenantId]);
  const months = t?.booking_horizon_months ?? 3;
  const limit = new Date();
  limit.setMonth(limit.getMonth() + months);
  if (startsAt > limit) {
    throw new HttpError(409, `Solo se puede reservar hasta ${months} mes(es) adelante (hasta el ${localParts(limit).date}).`, 'BEYOND_HORIZON', { horizonMonths: months, limit: localParts(limit).date });
  }
}

/**
 * RQ52: cupos confirmados de clases que ya terminaron sin asistencia. Se descuenta una clase del plan vigente en
 * la fecha de la clase que cubra esa academia y sede, y se marca como liquidado para no descontar dos veces.
 */
export async function settleMissedReservations(db: Db, tenantId?: number) {
  const pending = await db.query(
    `SELECT cr.id, cr.client_id, b.starts_at, b.site_id, s.academy_id
       FROM class_reservations cr JOIN bookings b ON b.id = cr.booking_id JOIN sites s ON s.id = b.site_id
      WHERE cr.status = 'confirmed' AND cr.settled_at IS NULL AND b.status = 'confirmed' AND b.ends_at < $1
        AND ($2::int IS NULL OR cr.tenant_id = $2)
        AND NOT EXISTS (SELECT 1 FROM attendances att WHERE att.booking_id = cr.booking_id AND att.client_id = cr.client_id)`,
    [new Date(), tenantId ?? null],
  );
  let charged = 0;
  for (const r of pending) {
    const day = localParts(new Date(r.starts_at)).date;
    const kinds: readonly string[] = KINDS_FOR_CONTEXT.class;
    const plan = (await membershipsOf(db, [r.client_id]))
      .filter((m) => m.status === 'active' && m.starts_on <= day && day <= m.ends_on && kinds.includes(m.kind) && coversPlace(m, r.academy_id, r.site_id))
      .sort((a, b) => a.ends_on.localeCompare(b.ends_on))[0];
    await db.tx(async (q) => {
      let penalty: number | null = null;
      if (plan && plan.units_total != null) {
        const upd = await q.query(`UPDATE memberships SET units_used = units_used + 1 WHERE id = $1 AND units_used < units_total RETURNING id`, [plan.id]);
        if (upd.length) penalty = plan.id;
      }
      const done = await q.query(
        `UPDATE class_reservations SET settled_at = $2, penalty_membership_id = $3 WHERE id = $1 AND settled_at IS NULL RETURNING id`,
        [r.id, new Date(), penalty],
      );
      if (!done.length && penalty) throw new Error('liquidada en paralelo'); // revierte el descuento
      if (penalty) charged++;
    }).catch(() => {});
  }
  return { reviewed: pending.length, charged };
}
