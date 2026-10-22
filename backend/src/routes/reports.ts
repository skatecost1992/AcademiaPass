/**
 * Reportes.
 *  - /reports/me                      cliente: su plan, clases restantes, dias asistidos, semanal y mensual (RQ8, RQ15)
 *  - /reports/clients/:id/unified     el mismo reporte unificado de cualquier cliente para el personal (RQ9, RQ15)
 *  - /reports/attendance              asistencia de todos los clientes por periodo, cliente, academia y sede (RQ9, RQ10)
 *  - /reports/capacity                aforo por espacio segun los QR escaneados, semanal y mensual (RQ21)
 *  - /reports/payments                pagos por periodo, medio y concepto
 *  - /reports/summary                 reporte que agrupa los anteriores (RQ22)
 * Todo filtra por la organizacion del usuario (RQ25).
 */
import { Router } from 'express';
import { z } from 'zod';
import { HttpError, requirePerm } from '../auth.ts';
import type { Db } from '../db.ts';
import { membershipsOf } from '../lib/memberships.ts';
import { TZ, addDays, dateStr, id, optId, own, parse, range, todayLocal } from '../lib/util.ts';

const filters = z.object({
  from: dateStr.optional(), to: dateStr.optional(), academyId: optId, siteId: optId,
  groupBy: z.enum(['week', 'month']).default('week'),
});
type Filters = z.infer<typeof filters> & { from: string; to: string };

// La zona va dentro del SQL (no como parametro) para que GROUP BY reconozca la misma expresion
const TZQ = TZ.replace(/'/g, '');
const period = (g: 'week' | 'month', col = 'at.scanned_at') => `date_trunc('${g === 'week' ? 'week' : 'month'}', ${col} AT TIME ZONE '${TZQ}')::date::text`;
const localDay = (col = 'at.scanned_at') => `(${col} AT TIME ZONE '${TZQ}')::date`;

/** Condicion comun de rango y filtros para attendances (parametros $1..$5) */
const AT_WHERE = `at.tenant_id = $1
  AND at.scanned_at >= ($2::date::timestamp AT TIME ZONE '${TZQ}') AND at.scanned_at < (($3::date + 1)::timestamp AT TIME ZONE '${TZQ}')
  AND ($4::int IS NULL OR at.academy_id = $4) AND ($5::int IS NULL OR at.site_id = $5)`;
const atParams = (tenantId: number, f: Filters) => [tenantId, f.from, f.to, f.academyId ?? null, f.siteId ?? null];

export async function unifiedReport(db: Db, tenantId: number, clientId: number, from: string, to: string) {
  const [client] = await db.query(
    `SELECT u.id, u.full_name, u.username, u.email, p.document, t.name AS tenant_name
       FROM users u JOIN persons p ON p.id = u.person_id JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1 AND u.tenant_id = $2 AND u.role = 'client'`,
    [clientId, tenantId],
  );
  if (!client) throw new HttpError(404, 'Cliente no encontrado', 'NOT_FOUND');
  const f: Filters = { from, to, groupBy: 'week' };
  const where = `${AT_WHERE} AND at.client_id = $6`;
  const params = [...atParams(tenantId, f), clientId];

  const attendances = await db.query(
    `SELECT at.id, at.scanned_at, ${localDay()}::text AS day, a.id AS academy_id, a.name AS academy_name, s.name AS site_name,
            b.title AS booking_title, pl.name AS plan_name
       FROM attendances at JOIN academies a ON a.id = at.academy_id JOIN sites s ON s.id = at.site_id
       LEFT JOIN bookings b ON b.id = at.booking_id LEFT JOIN memberships m ON m.id = at.membership_id LEFT JOIN plans pl ON pl.id = m.plan_id
      WHERE ${where} ORDER BY at.scanned_at DESC`,
    params,
  );
  const grouped = (g: 'week' | 'month') => db.query(
    `SELECT ${period(g)} AS period, a.name AS academy_name, count(*)::int AS visits, count(DISTINCT ${localDay()})::int AS days
       FROM attendances at JOIN academies a ON a.id = at.academy_id
      WHERE ${where} GROUP BY 1, 2 ORDER BY 1 DESC, 2`,
    params,
  );
  const totalsBy = (g: 'week' | 'month') => db.query(
    `SELECT ${period(g)} AS period, count(*)::int AS visits, count(DISTINCT ${localDay()})::int AS days
       FROM attendances at WHERE ${where} GROUP BY 1 ORDER BY 1 DESC`,
    params,
  );
  const byAcademy = await db.query(
    `SELECT a.id, a.name, count(*)::int AS visits, count(DISTINCT ${localDay()})::int AS days
       FROM attendances at JOIN academies a ON a.id = at.academy_id WHERE ${where} GROUP BY 1, 2 ORDER BY 2`,
    params,
  );
  const memberships = await membershipsOf(db, [clientId]);
  const current = memberships.filter((m) => m.is_current);
  return {
    generatedAt: new Date().toISOString(),
    from, to,
    client: { id: client.id, fullName: client.full_name, document: client.document, email: client.email, organization: client.tenant_name },
    memberships,
    totals: {
      visits: attendances.length,
      days: new Set(attendances.map((a) => a.day)).size,
      unitsUsed: current.reduce((s, m) => s + m.units_used, 0),
      unitsRemaining: current.some((m) => m.remaining == null) ? null : current.reduce((s, m) => s + (m.remaining ?? 0), 0),
    },
    byAcademy,
    weekly: { totals: await totalsBy('week'), byAcademy: await grouped('week') },
    monthly: { totals: await totalsBy('month'), byAcademy: await grouped('month') },
    days: [...new Set(attendances.map((a) => a.day))],
    attendances,
  };
}

async function attendanceReport(db: Db, tenantId: number, f: Filters) {
  const params = atParams(tenantId, f);
  const periods = await db.query(
    `SELECT ${period(f.groupBy)} AS period, count(*)::int AS visits, count(DISTINCT at.client_id)::int AS clients,
            count(*) FILTER (WHERE at.over_capacity)::int AS over_capacity
       FROM attendances at WHERE ${AT_WHERE} GROUP BY 1 ORDER BY 1 DESC`,
    params,
  );
  const byClient = await db.query(
    `SELECT u.id, u.full_name, count(*)::int AS visits, count(DISTINCT ${localDay()})::int AS days, max(at.scanned_at) AS last
       FROM attendances at JOIN users u ON u.id = at.client_id WHERE ${AT_WHERE} GROUP BY 1, 2 ORDER BY visits DESC, 2`,
    params,
  );
  const bySite = await db.query(
    `SELECT s.id, s.name, a.name AS academy_name, count(*)::int AS visits, count(DISTINCT at.client_id)::int AS clients
       FROM attendances at JOIN sites s ON s.id = at.site_id JOIN academies a ON a.id = s.academy_id WHERE ${AT_WHERE} GROUP BY 1, 2, 3 ORDER BY 3, 2`,
    params,
  );
  const byClass = await db.query(
    `SELECT coalesce(b.title, 'Ingreso general') AS name, count(*)::int AS visits
       FROM attendances at LEFT JOIN bookings b ON b.id = at.booking_id WHERE ${AT_WHERE} GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
    params,
  );
  return { from: f.from, to: f.to, groupBy: f.groupBy, periods, byClient, bySite, byClass, totals: { visits: periods.reduce((s, p) => s + p.visits, 0), clients: byClient.length } };
}

/** Aforo: cupos ofrecidos (reservas) frente a asistentes reales que escanearon su QR (RQ21) */
async function capacityReport(db: Db, tenantId: number, f: Filters) {
  const params = [tenantId, f.from, f.to, f.academyId ?? null, f.siteId ?? null];
  const bWhere = `b.tenant_id = $1 AND b.status = 'confirmed'
    AND b.starts_at >= ($2::date::timestamp AT TIME ZONE '${TZQ}') AND b.starts_at < (($3::date + 1)::timestamp AT TIME ZONE '${TZQ}')
    AND ($4::int IS NULL OR s.academy_id = $4) AND ($5::int IS NULL OR b.site_id = $5)`;
  const bySpace = await db.query(
    `SELECT sp.id, sp.name, s.name AS site_name, sp.max_capacity, sp.allow_multi_group, sp.max_groups, sp.capacity_per_group,
            count(b.id)::int AS bookings, coalesce(sum(b.group_size), 0)::int AS spots,
            coalesce(sum((SELECT count(*) FROM attendances at WHERE at.booking_id = b.id)), 0)::int AS attendees,
            coalesce(sum((SELECT count(*) FROM attendances at WHERE at.booking_id = b.id AND at.over_capacity)), 0)::int AS over_capacity
       FROM bookings b JOIN spaces sp ON sp.id = b.space_id JOIN sites s ON s.id = b.site_id
      WHERE ${bWhere} GROUP BY sp.id, sp.name, s.name ORDER BY s.name, sp.name`,
    params,
  );
  const periods = await db.query(
    `SELECT ${period(f.groupBy, 'b.starts_at')} AS period, sp.name AS space_name, s.name AS site_name,
            count(b.id)::int AS bookings, sum(b.group_size)::int AS spots,
            coalesce(sum((SELECT count(*) FROM attendances at WHERE at.booking_id = b.id)), 0)::int AS attendees
       FROM bookings b JOIN spaces sp ON sp.id = b.space_id JOIN sites s ON s.id = b.site_id
      WHERE ${bWhere} GROUP BY 1, 2, 3 ORDER BY 1 DESC, 3, 2`,
    params,
  );
  const sessions = await db.query(
    `SELECT b.id, b.title, b.kind, b.starts_at, b.ends_at, b.group_size, sp.name AS space_name, s.name AS site_name,
            (SELECT count(*)::int FROM attendances at WHERE at.booking_id = b.id) AS attendees
       FROM bookings b JOIN spaces sp ON sp.id = b.space_id JOIN sites s ON s.id = b.site_id
      WHERE ${bWhere} ORDER BY b.starts_at DESC LIMIT 200`,
    params,
  );
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
  return {
    from: f.from, to: f.to, groupBy: f.groupBy,
    bySpace: bySpace.map((r) => ({ ...r, occupancy: pct(r.attendees, r.spots) })),
    periods: periods.map((r) => ({ ...r, occupancy: pct(r.attendees, r.spots) })),
    sessions: sessions.map((r) => ({ ...r, occupancy: pct(r.attendees, r.group_size), full: r.attendees >= r.group_size })),
  };
}

async function paymentsReport(db: Db, tenantId: number, f: Filters) {
  const params = [tenantId, f.from, f.to, f.academyId ?? null, f.siteId ?? null];
  const base = `FROM payments pay
      LEFT JOIN memberships m ON m.id = pay.membership_id LEFT JOIN plans pl ON pl.id = m.plan_id
      LEFT JOIN bookings b ON b.id = pay.booking_id LEFT JOIN sites bs ON bs.id = b.site_id
     WHERE pay.tenant_id = $1
       AND pay.paid_at >= ($2::date::timestamp AT TIME ZONE '${TZQ}') AND pay.paid_at < (($3::date + 1)::timestamp AT TIME ZONE '${TZQ}')
       AND ($4::int IS NULL OR bs.academy_id = $4 OR EXISTS (SELECT 1 FROM plan_academies pa WHERE pa.plan_id = m.plan_id AND pa.academy_id = $4))
       AND ($5::int IS NULL OR b.site_id = $5 OR (m.id IS NOT NULL AND (pl.all_sites OR EXISTS (SELECT 1 FROM plan_sites ps WHERE ps.plan_id = m.plan_id AND ps.site_id = $5))))`;
  const periods = await db.query(`SELECT ${period(f.groupBy, 'pay.paid_at')} AS period, sum(pay.amount)::float8 AS total, count(*)::int AS payments ${base} GROUP BY 1 ORDER BY 1 DESC`, params);
  const byMethod = await db.query(`SELECT pay.method, sum(pay.amount)::float8 AS total, count(*)::int AS payments ${base} GROUP BY 1 ORDER BY 2 DESC`, params);
  const byConcept = await db.query(
    `SELECT CASE WHEN pay.membership_id IS NOT NULL THEN 'Plan: ' || pl.name ELSE 'Reservas de espacios' END AS concept,
            sum(pay.amount)::float8 AS total, count(*)::int AS payments ${base} GROUP BY 1 ORDER BY 2 DESC`,
    params,
  );
  return { from: f.from, to: f.to, groupBy: f.groupBy, periods, byMethod, byConcept, total: byMethod.reduce((s, m) => s + m.total, 0) };
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
    const [kpi] = await db.query(
      `SELECT
         (SELECT count(*)::int FROM users WHERE tenant_id = $1 AND role = 'client' AND active) AS clients,
         (SELECT count(*)::int FROM memberships WHERE tenant_id = $1 AND status = 'active' AND starts_on <= $2::date AND ends_on >= $2::date
             AND (units_total IS NULL OR units_used < units_total)) AS active_memberships,
         (SELECT count(*)::int FROM memberships WHERE tenant_id = $1 AND status = 'active' AND ends_on BETWEEN $2::date AND $3::date) AS expiring_soon,
         (SELECT count(*)::int FROM academies WHERE tenant_id = $1) AS academies,
         (SELECT count(*)::int FROM sites WHERE tenant_id = $1) AS sites`,
      [t, today, addDays(today, 7)],
    );
    const expiring = await db.query(
      `SELECT m.id, u.id AS client_id, u.full_name, pl.name AS plan_name, m.ends_on, m.units_total, m.units_used
         FROM memberships m JOIN users u ON u.id = m.client_id JOIN plans pl ON pl.id = m.plan_id
        WHERE m.tenant_id = $1 AND m.status = 'active' AND m.ends_on BETWEEN $2::date AND $3::date ORDER BY m.ends_on LIMIT 50`,
      [t, today, addDays(today, 7)],
    );
    const canCapacity = req.user.permissions.includes('capacity_reports');
    res.json({
      from: f.from, to: f.to, groupBy: f.groupBy,
      kpi,
      expiring,
      attendance: await attendanceReport(db, t, f),
      capacity: canCapacity ? await capacityReport(db, t, f) : null,
      payments: await paymentsReport(db, t, f),
    });
  });

  return r;
}
