/**
 * Reportes.
 *  - /reports/me                      cliente: su plan, clases restantes, dias asistidos, semanal y mensual (RQ8, RQ15)
 *  - /reports/clients/:id/unified     el mismo reporte unificado de cualquier cliente para el personal (RQ9, RQ15)
 *  - /reports/attendance              asistencia de todos los clientes por periodo, cliente, academia y sede (RQ9, RQ10)
 *  - /reports/capacity                aforo por espacio segun los QR escaneados, semanal y mensual (RQ21)
 *  - /reports/payments                pagos por periodo, medio y concepto
 *  - /reports/summary                 reporte que agrupa los anteriores (RQ22)
 * Todo filtra por la organizacion del usuario (RQ25).
 *
 * Las consultas solo filtran (iguales en PostgreSQL y SQL Server); la agrupacion por dia, semana y mes se hace
 * aqui con la zona horaria del negocio.
 */
import { Router } from 'express';
import { z } from 'zod';
import { HttpError, requirePerm } from '../auth.ts';
import type { Db } from '../db.ts';
import { membershipsOf } from '../lib/memberships.ts';
import { addDays, dateStr, dayBounds, id, localParts, optId, own, parse, periodStart, range, todayLocal } from '../lib/util.ts';

const filters = z.object({
  from: dateStr.optional(), to: dateStr.optional(), academyId: optId, siteId: optId,
  groupBy: z.enum(['week', 'month']).default('week'),
});
type Filters = z.infer<typeof filters> & { from: string; to: string };
type G = 'week' | 'month';

interface AttRow {
  id: number; scanned_at: Date; client_id: number; client_name: string; academy_id: number; academy_name: string;
  site_id: number; site_name: string; booking_title: string | null; plan_name: string | null; over_capacity: boolean;
}

/** Agrupa filas por clave conservando el orden de aparicion */
function groupBy<T>(rows: T[], key: (r: T) => string) {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return m;
}
const dayOf = (r: AttRow) => localParts(new Date(r.scanned_at)).date;
const distinct = <T>(rows: T[], f: (r: T) => unknown) => new Set(rows.map(f)).size;
const byPeriodDesc = (a: { period: string }, b: { period: string }) => b.period.localeCompare(a.period);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

/** Ingresos del periodo con filtros de academia, sede y cliente */
async function attendanceRows(db: Db, tenantId: number, f: Filters, clientId?: number): Promise<AttRow[]> {
  const [start, end] = dayBounds(f.from, f.to);
  return db.query(
    `SELECT att.id, att.scanned_at, att.client_id, u.full_name AS client_name, att.academy_id, a.name AS academy_name,
            att.site_id, s.name AS site_name, b.title AS booking_title, pl.name AS plan_name, att.over_capacity
       FROM attendances att
       JOIN users u ON u.id = att.client_id JOIN academies a ON a.id = att.academy_id JOIN sites s ON s.id = att.site_id
       LEFT JOIN bookings b ON b.id = att.booking_id LEFT JOIN memberships m ON m.id = att.membership_id LEFT JOIN plans pl ON pl.id = m.plan_id
      WHERE att.tenant_id = $1 AND att.scanned_at >= $2 AND att.scanned_at < $3
        AND ($4::int IS NULL OR att.academy_id = $4) AND ($5::int IS NULL OR att.site_id = $5) AND ($6::int IS NULL OR att.client_id = $6)
      ORDER BY att.scanned_at DESC`,
    [tenantId, start, end, f.academyId ?? null, f.siteId ?? null, clientId ?? null],
  );
}

export async function unifiedReport(db: Db, tenantId: number, clientId: number, from: string, to: string) {
  const [client] = await db.query(
    `SELECT u.id, u.full_name, u.username, u.email, p.document, t.name AS tenant_name
       FROM users u JOIN persons p ON p.id = u.person_id JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1 AND u.tenant_id = $2 AND u.role = 'client'`,
    [clientId, tenantId],
  );
  if (!client) throw new HttpError(404, 'Cliente no encontrado', 'NOT_FOUND');
  const rows = await attendanceRows(db, tenantId, { from, to, groupBy: 'week' }, clientId);

  const grouped = (g: G) => {
    const totals = [...groupBy(rows, (r) => periodStart(new Date(r.scanned_at), g))].map(([period, list]) => ({ period, visits: list.length, days: distinct(list, dayOf) }));
    const byAcademy = [...groupBy(rows, (r) => `${periodStart(new Date(r.scanned_at), g)}|${r.academy_name}`)].map(([k, list]) => {
      const [period, academy_name] = k.split('|');
      return { period, academy_name, visits: list.length, days: distinct(list, dayOf) };
    });
    return { totals: totals.sort(byPeriodDesc), byAcademy: byAcademy.sort((a, b) => byPeriodDesc(a, b) || a.academy_name.localeCompare(b.academy_name)) };
  };

  const memberships = await membershipsOf(db, [clientId]);
  const current = memberships.filter((m) => m.is_current);
  const days = [...new Set(rows.map(dayOf))];
  return {
    generatedAt: new Date().toISOString(),
    from, to,
    client: { id: client.id, fullName: client.full_name, document: client.document, email: client.email, organization: client.tenant_name },
    memberships,
    totals: {
      visits: rows.length,
      days: days.length,
      unitsUsed: current.reduce((s, m) => s + m.units_used, 0),
      unitsRemaining: current.some((m) => m.remaining == null) ? null : current.reduce((s, m) => s + (m.remaining ?? 0), 0),
    },
    byAcademy: [...groupBy(rows, (r) => String(r.academy_id))]
      .map(([aid, list]) => ({ id: Number(aid), name: list[0].academy_name, visits: list.length, days: distinct(list, dayOf) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    weekly: grouped('week'),
    monthly: grouped('month'),
    days,
    attendances: rows.map((r) => ({
      id: r.id, scanned_at: r.scanned_at, day: dayOf(r), academy_id: r.academy_id, academy_name: r.academy_name,
      site_name: r.site_name, booking_title: r.booking_title, plan_name: r.plan_name,
    })),
  };
}

async function attendanceReport(db: Db, tenantId: number, f: Filters) {
  const rows = await attendanceRows(db, tenantId, f);
  const periods = [...groupBy(rows, (r) => periodStart(new Date(r.scanned_at), f.groupBy))]
    .map(([period, list]) => ({ period, visits: list.length, clients: distinct(list, (r) => r.client_id), over_capacity: list.filter((r) => r.over_capacity).length }))
    .sort(byPeriodDesc);
  const byClient = [...groupBy(rows, (r) => String(r.client_id))]
    .map(([cid, list]) => ({ id: Number(cid), full_name: list[0].client_name, visits: list.length, days: distinct(list, dayOf), last: list[0].scanned_at }))
    .sort((a, b) => b.visits - a.visits || a.full_name.localeCompare(b.full_name));
  const bySite = [...groupBy(rows, (r) => String(r.site_id))]
    .map(([sid, list]) => ({ id: Number(sid), name: list[0].site_name, academy_name: list[0].academy_name, visits: list.length, clients: distinct(list, (r) => r.client_id) }))
    .sort((a, b) => a.academy_name.localeCompare(b.academy_name) || a.name.localeCompare(b.name));
  const byClass = [...groupBy(rows, (r) => r.booking_title ?? 'Ingreso general')]
    .map(([name, list]) => ({ name, visits: list.length }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 20);
  return { from: f.from, to: f.to, groupBy: f.groupBy, periods, byClient, bySite, byClass, totals: { visits: rows.length, clients: byClient.length } };
}

/** Aforo: cupos ofrecidos (reservas) frente a asistentes reales que escanearon su QR (RQ21) */
async function capacityReport(db: Db, tenantId: number, f: Filters) {
  const [start, end] = dayBounds(f.from, f.to);
  const sessions: any[] = await db.query(
    `SELECT b.id, b.title, b.kind, b.starts_at, b.ends_at, b.group_size, b.space_id,
            sp.name AS space_name, sp.max_capacity, sp.allow_multi_group, sp.max_groups, sp.capacity_per_group, s.name AS site_name,
            (SELECT count(*) FROM attendances att WHERE att.booking_id = b.id) AS attendees,
            (SELECT count(*) FROM attendances att WHERE att.booking_id = b.id AND att.over_capacity = true) AS over_capacity
       FROM bookings b JOIN spaces sp ON sp.id = b.space_id JOIN sites s ON s.id = b.site_id
      WHERE b.tenant_id = $1 AND b.status = 'confirmed' AND b.starts_at >= $2 AND b.starts_at < $3
        AND ($4::int IS NULL OR s.academy_id = $4) AND ($5::int IS NULL OR b.site_id = $5)
      ORDER BY b.starts_at DESC`,
    [tenantId, start, end, f.academyId ?? null, f.siteId ?? null],
  );
  for (const r of sessions) {
    r.attendees = Number(r.attendees);
    r.over_capacity = Number(r.over_capacity);
  }
  const sum = (list: any[], k: string) => list.reduce((s, r) => s + r[k], 0);
  const bySpace = [...groupBy(sessions, (r) => String(r.space_id))]
    .map(([sid, list]) => {
      const x = list[0];
      const spots = sum(list, 'group_size');
      const attendees = sum(list, 'attendees');
      return {
        id: Number(sid), name: x.space_name, site_name: x.site_name, max_capacity: x.max_capacity, allow_multi_group: x.allow_multi_group,
        max_groups: x.max_groups, capacity_per_group: x.capacity_per_group, bookings: list.length, spots, attendees,
        over_capacity: sum(list, 'over_capacity'), occupancy: pct(attendees, spots),
      };
    })
    .sort((a, b) => a.site_name.localeCompare(b.site_name) || a.name.localeCompare(b.name));
  const periods = [...groupBy(sessions, (r) => `${periodStart(new Date(r.starts_at), f.groupBy)}|${r.space_id}`)]
    .map(([k, list]) => {
      const spots = sum(list, 'group_size');
      const attendees = sum(list, 'attendees');
      return { period: k.split('|')[0], space_name: list[0].space_name, site_name: list[0].site_name, bookings: list.length, spots, attendees, occupancy: pct(attendees, spots) };
    })
    .sort((a, b) => byPeriodDesc(a, b) || a.site_name.localeCompare(b.site_name) || a.space_name.localeCompare(b.space_name));
  return {
    from: f.from, to: f.to, groupBy: f.groupBy,
    bySpace,
    periods,
    sessions: sessions.slice(0, 200).map((r) => ({
      id: r.id, title: r.title, kind: r.kind, starts_at: r.starts_at, ends_at: r.ends_at, group_size: r.group_size,
      space_name: r.space_name, site_name: r.site_name, attendees: r.attendees,
      occupancy: pct(r.attendees, r.group_size), full: r.attendees >= r.group_size,
    })),
  };
}

async function paymentsReport(db: Db, tenantId: number, f: Filters) {
  const [start, end] = dayBounds(f.from, f.to);
  const rows: any[] = await db.query(
    `SELECT pay.amount, pay.method, pay.paid_at, pay.membership_id, pl.name AS plan_name
       FROM payments pay
       LEFT JOIN memberships m ON m.id = pay.membership_id LEFT JOIN plans pl ON pl.id = m.plan_id
       LEFT JOIN bookings b ON b.id = pay.booking_id LEFT JOIN sites bs ON bs.id = b.site_id
      WHERE pay.tenant_id = $1 AND pay.paid_at >= $2 AND pay.paid_at < $3
        AND ($4::int IS NULL OR bs.academy_id = $4 OR EXISTS (SELECT 1 FROM plan_academies pa WHERE pa.plan_id = m.plan_id AND pa.academy_id = $4))
        AND ($5::int IS NULL OR b.site_id = $5 OR (m.id IS NOT NULL AND (pl.all_sites = true OR EXISTS (SELECT 1 FROM plan_sites ps WHERE ps.plan_id = m.plan_id AND ps.site_id = $5))))`,
    [tenantId, start, end, f.academyId ?? null, f.siteId ?? null],
  );
  for (const r of rows) r.amount = Number(r.amount);
  const totals = (key: (r: any) => string) =>
    [...groupBy(rows, key)].map(([k, list]) => ({ k, total: list.reduce((s, r) => s + r.amount, 0), payments: list.length })).sort((a, b) => b.total - a.total);
  return {
    from: f.from, to: f.to, groupBy: f.groupBy,
    periods: totals((r) => periodStart(new Date(r.paid_at), f.groupBy)).map(({ k, ...x }) => ({ period: k, ...x })).sort(byPeriodDesc),
    byMethod: totals((r) => r.method).map(({ k, ...x }) => ({ method: k, ...x })),
    byConcept: totals((r) => (r.membership_id ? `Plan: ${r.plan_name}` : 'Reservas de espacios')).map(({ k, ...x }) => ({ concept: k, ...x })),
    total: rows.reduce((s, r) => s + r.amount, 0),
  };
}

/**
 * RQ41: clases reservadas y clases tomadas. Por cada cupo reservado indica si el cliente asistio, si no asistio
 * (la clase ya termino) o si sigue pendiente; ademas incluye las clases tomadas sin reserva previa.
 */
async function classesReport(db: Db, tenantId: number, f: Filters, clientId?: number) {
  const [start, end] = dayBounds(f.from, f.to);
  const params = [tenantId, start, end, f.academyId ?? null, f.siteId ?? null, clientId ?? null];
  const where = `b.tenant_id = $1 AND b.kind = 'class' AND b.starts_at >= $2 AND b.starts_at < $3
    AND ($4::int IS NULL OR s.academy_id = $4) AND ($5::int IS NULL OR b.site_id = $5)`;
  const reserved: any[] = await db.query(
    `SELECT cr.id AS reservation_id, cr.client_id, u.full_name AS client_name, cr.created_at AS reserved_at,
            b.id AS booking_id, b.title, b.starts_at, b.ends_at, b.status AS booking_status, s.name AS site_name, a.name AS academy_name,
            (SELECT max(att.scanned_at) FROM attendances att WHERE att.booking_id = b.id AND att.client_id = cr.client_id) AS attended_at
       FROM class_reservations cr JOIN bookings b ON b.id = cr.booking_id JOIN users u ON u.id = cr.client_id
       JOIN sites s ON s.id = b.site_id JOIN academies a ON a.id = s.academy_id
      WHERE ${where} AND cr.status = 'confirmed' AND ($6::int IS NULL OR cr.client_id = $6)`,
    params,
  );
  const walkIns: any[] = await db.query(
    `SELECT att.client_id, u.full_name AS client_name, att.scanned_at AS attended_at,
            b.id AS booking_id, b.title, b.starts_at, b.ends_at, b.status AS booking_status, s.name AS site_name, a.name AS academy_name
       FROM attendances att JOIN bookings b ON b.id = att.booking_id JOIN users u ON u.id = att.client_id
       JOIN sites s ON s.id = b.site_id JOIN academies a ON a.id = s.academy_id
      WHERE ${where} AND ($6::int IS NULL OR att.client_id = $6)
        AND NOT EXISTS (SELECT 1 FROM class_reservations cr WHERE cr.booking_id = b.id AND cr.client_id = att.client_id AND cr.status = 'confirmed')`,
    params,
  );
  const now = Date.now();
  const rows = [
    ...reserved.map((r) => ({
      ...r, reserved: true,
      state: r.attended_at ? 'taken' : r.booking_status === 'cancelled' ? 'cancelled' : new Date(r.ends_at).getTime() < now ? 'missed' : 'reserved',
    })),
    ...walkIns.map((r) => ({ ...r, reservation_id: null, reserved_at: null, reserved: false, state: 'taken' })),
  ].sort((x, y) => new Date(y.starts_at).getTime() - new Date(x.starts_at).getTime());
  const count = (st: string) => rows.filter((r) => r.state === st).length;
  return {
    from: f.from, to: f.to,
    totals: {
      reserved: reserved.length,
      taken: count('taken'),
      takenWithReservation: rows.filter((r) => r.reserved && r.state === 'taken').length,
      missed: count('missed'),
      upcoming: count('reserved'),
    },
    byClass: [...groupBy(rows, (r) => r.title)].map(([title, list]) => ({
      title, reserved: list.filter((r) => r.reserved).length, taken: list.filter((r) => r.state === 'taken').length, missed: list.filter((r) => r.state === 'missed').length,
    })).sort((a, b) => b.reserved + b.taken - (a.reserved + a.taken)),
    rows: rows.slice(0, 500),
  };
}

export function reportRoutes(db: Db) {
  const r = Router();
  const readFilters = (q: unknown): Filters => {
    const f = parse(filters, q);
    return { ...f, ...range(f) };
  };

  r.get('/reports/me', async (req, res) => {
    if (req.user.role !== 'client') throw new HttpError(400, 'Este reporte es para clientes');
    const { from, to } = range(parse(filters, req.query));
    res.json(await unifiedReport(db, req.user.tenantId, req.user.id, from, to));
  });

  r.get('/reports/clients/:id/unified', requirePerm('reports'), async (req, res) => {
    const c = await own(db, 'users', parse(id, req.params.id), req.user.tenantId, 'Cliente');
    const { from, to } = range(parse(filters, req.query));
    res.json(await unifiedReport(db, req.user.tenantId, c.id, from, to));
  });

  // RQ41: el personal con acceso a reportes ve a todos (o a un cliente); el cliente solo su propia informacion
  r.get('/reports/classes', async (req, res) => {
    const f = readFilters(req.query);
    if (req.user.role === 'client') return res.json(await classesReport(db, req.user.tenantId, f, req.user.id));
    if (!req.user.permissions.includes('reports')) throw new HttpError(403, 'No tienes permiso para esta acción', 'FORBIDDEN');
    const clientId = parse(optId, req.query.clientId);
    res.json(await classesReport(db, req.user.tenantId, f, clientId));
  });

  r.get('/reports/attendance', requirePerm('reports'), async (req, res) => {
    res.json(await attendanceReport(db, req.user.tenantId, readFilters(req.query)));
  });

  r.get('/reports/capacity', requirePerm('capacity_reports'), async (req, res) => {
    res.json(await capacityReport(db, req.user.tenantId, readFilters(req.query)));
  });

  r.get('/reports/payments', requirePerm('reports', 'payments'), async (req, res) => {
    res.json(await paymentsReport(db, req.user.tenantId, readFilters(req.query)));
  });

  // Reporte agrupado (RQ22): indicadores + los reportes de asistencia, aforo y pagos en una sola respuesta
  r.get('/reports/summary', requirePerm('reports'), async (req, res) => {
    const f = readFilters(req.query);
    const t = req.user.tenantId;
    const today = todayLocal();
    const in7 = addDays(today, 7);
    const [kpi] = await db.query(
      `SELECT
         (SELECT count(*) FROM users WHERE tenant_id = $1 AND role = 'client' AND active = true) AS clients,
         (SELECT count(*) FROM memberships WHERE tenant_id = $1 AND status = 'active' AND starts_on <= $2::date AND ends_on >= $2::date
             AND (units_total IS NULL OR units_used < units_total)) AS active_memberships,
         (SELECT count(*) FROM memberships WHERE tenant_id = $1 AND status = 'active' AND ends_on >= $2::date AND ends_on <= $3::date) AS expiring_soon,
         (SELECT count(*) FROM academies WHERE tenant_id = $1) AS academies,
         (SELECT count(*) FROM sites WHERE tenant_id = $1) AS sites`,
      [t, today, in7],
    );
    const expiring = await db.query(
      `SELECT m.id, u.id AS client_id, u.full_name, pl.name AS plan_name, m.ends_on, m.units_total, m.units_used
         FROM memberships m JOIN users u ON u.id = m.client_id JOIN plans pl ON pl.id = m.plan_id
        WHERE m.tenant_id = $1 AND m.status = 'active' AND m.ends_on >= $2::date AND m.ends_on <= $3::date ORDER BY m.ends_on LIMIT 50`,
      [t, today, in7],
    );
    const canCapacity = req.user.permissions.includes('capacity_reports');
    res.json({
      from: f.from, to: f.to, groupBy: f.groupBy,
      kpi: Object.fromEntries(Object.entries(kpi).map(([k, v]) => [k, Number(v)])),
      expiring,
      attendance: await attendanceReport(db, t, f),
      capacity: canCapacity ? await capacityReport(db, t, f) : null,
      payments: await paymentsReport(db, t, f),
    });
  });

  return r;
}
