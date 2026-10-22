/**
 * Planes (RQ7, RQ11, RQ12), clientes (RQ10, RQ13), planes adquiridos, pagos (RQ4, RQ6) y usuarios del
 * personal con permisos (RQ17).
 */
import { Router } from 'express';
import { z } from 'zod';
import { ALL_PERMISSIONS, HttpError, hashPassword, requireAdmin, requirePerm } from '../auth.ts';
import type { Db } from '../db.ts';
import { membershipsOf } from '../lib/memberships.ts';
import { TZ, addDays, dateStr, id, isoDateTime, optId, optText, own, ownAll, parse, range, text, todayLocal } from '../lib/util.ts';
import { assertNoAccountInTenant, assertUsernameFree, upsertPerson } from './auth.ts';

const username = z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{4,40}$/, 'Usa 4 a 40 letras, números, punto, guion o guion bajo');
const password = z.string().min(8, 'Mínimo 8 caracteres').max(100);
const document = z.string().trim().regex(/^[A-Za-z0-9-]{4,20}$/, 'Documento inválido');
const email = z.string().trim().email('Correo inválido').optional().nullable().or(z.literal('').transform(() => null));
const money = z.coerce.number().positive('El valor debe ser mayor que cero').max(1_000_000_000);
const method = z.enum(['efectivo', 'transferencia', 'tarjeta', 'nequi', 'daviplata', 'otro']);

const paymentFields = { amount: money, method, reference: optText(120), notes: optText(), paidAt: isoDateTime.optional() };

export function commerceRoutes(db: Db) {
  const r = Router();

  // ------------------------------------------------------------------ Planes
  const planBody = z.object({
    name: text(120),
    description: optText(),
    kind: z.enum(['classes', 'reservations', 'access', 'mixed']),
    units: z.coerce.number().int().positive().optional().nullable(),
    validityDays: z.coerce.number().int().positive().max(3660),
    price: z.coerce.number().min(0),
    academyIds: z.array(id).min(1, 'Selecciona al menos una academia'),
    allSites: z.boolean().default(true),
    siteIds: z.array(id).default([]),
    active: z.boolean().default(true),
  }).refine((p) => p.allSites || p.siteIds.length > 0, { message: 'Selecciona las sedes o marca "todas las sedes"', path: ['siteIds'] });

  const planSelect = `
    SELECT p.*, p.price::float8 AS price,
           coalesce((SELECT json_agg(json_build_object('id', a.id, 'name', a.name) ORDER BY a.name) FROM plan_academies pa JOIN academies a ON a.id = pa.academy_id WHERE pa.plan_id = p.id), '[]') AS academies,
           coalesce((SELECT json_agg(json_build_object('id', s.id, 'name', s.name) ORDER BY s.name) FROM plan_sites ps JOIN sites s ON s.id = ps.site_id WHERE ps.plan_id = p.id), '[]') AS sites
      FROM plans p`;

  r.get('/plans', async (req, res) => {
    const rows = await db.query(`${planSelect} WHERE p.tenant_id = $1 AND ($2 OR p.active) ORDER BY p.active DESC, p.name`, [req.user.tenantId, req.user.role !== 'client']);
    res.json(rows);
  });

  const savePlan = async (tenantId: number, b: z.infer<typeof planBody>, planId?: number) => {
    await ownAll(db, 'academies', b.academyIds, tenantId);
    const siteIds = b.allSites ? [] : b.siteIds;
    if (siteIds.length) {
      await ownAll(db, 'sites', siteIds, tenantId);
      const bad = await db.query(`SELECT name FROM sites WHERE id = ANY($1::int[]) AND NOT (academy_id = ANY($2::int[]))`, [siteIds, b.academyIds]);
      if (bad.length) throw new HttpError(400, `La sede ${bad[0].name} no pertenece a las academias del plan`);
    }
    return db.tx(async (q) => {
      const params = [b.name, b.description, b.kind, b.units ?? null, b.validityDays, b.price, b.allSites, b.active];
      const [p] = planId
        ? await q.query(`UPDATE plans SET name = $2, description = $3, kind = $4, units = $5, validity_days = $6, price = $7, all_sites = $8, active = $9 WHERE id = $1 RETURNING id`, [planId, ...params])
        : await q.query(`INSERT INTO plans (tenant_id, name, description, kind, units, validity_days, price, all_sites, active) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`, [tenantId, ...params]);
      await q.query(`DELETE FROM plan_academies WHERE plan_id = $1`, [p.id]);
      await q.query(`DELETE FROM plan_sites WHERE plan_id = $1`, [p.id]);
      await q.query(`INSERT INTO plan_academies (plan_id, academy_id) SELECT $1, unnest($2::int[])`, [p.id, b.academyIds]);
      if (siteIds.length) await q.query(`INSERT INTO plan_sites (plan_id, site_id) SELECT $1, unnest($2::int[])`, [p.id, siteIds]);
      const [row] = await q.query(`${planSelect} WHERE p.id = $1`, [p.id]);
      return row;
    });
  };

  r.post('/plans', requirePerm('plans'), async (req, res) => {
    res.status(201).json(await savePlan(req.user.tenantId, parse(planBody, req.body)));
  });

  r.put('/plans/:id', requirePerm('plans'), async (req, res) => {
    const p = await own(db, 'plans', parse(id, req.params.id), req.user.tenantId, 'Plan');
    res.json(await savePlan(req.user.tenantId, parse(planBody, req.body), p.id));
  });

  // ------------------------------------------------------------------ Clientes
  const clientsRead = requirePerm('clients', 'attendance', 'reports', 'payments', 'bookings');

  r.get('/clients', clientsRead, async (req, res) => {
    const q = parse(z.object({ q: z.string().trim().max(80).optional(), academyId: optId, siteId: optId }), req.query);
    const rows = await db.query(
      `SELECT u.id, u.username, u.full_name, u.email, u.phone, u.active, u.consent_at, u.home_site_id, p.document,
              hs.name AS home_site_name,
              coalesce((SELECT json_agg(json_build_object('id', a.id, 'name', a.name) ORDER BY a.name) FROM client_academies ca JOIN academies a ON a.id = ca.academy_id WHERE ca.client_id = u.id), '[]') AS academies,
              (SELECT max(scanned_at) FROM attendances at WHERE at.client_id = u.id) AS last_attendance
         FROM users u JOIN persons p ON p.id = u.person_id LEFT JOIN sites hs ON hs.id = u.home_site_id
        WHERE u.tenant_id = $1 AND u.role = 'client'
          AND ($2::text IS NULL OR u.full_name ILIKE '%' || $2 || '%' OR p.document ILIKE $2 || '%' OR u.username ILIKE $2 || '%')
          AND ($3::int IS NULL OR EXISTS (SELECT 1 FROM client_academies ca WHERE ca.client_id = u.id AND ca.academy_id = $3))
          AND ($4::int IS NULL OR u.home_site_id = $4 OR EXISTS (SELECT 1 FROM attendances at WHERE at.client_id = u.id AND at.site_id = $4))
        ORDER BY u.full_name LIMIT 500`,
      [req.user.tenantId, q.q || null, q.academyId ?? null, q.siteId ?? null],
    );
    res.json(rows);
  });

  r.get('/clients/:id', clientsRead, async (req, res) => {
    const c = await own(db, 'users', parse(id, req.params.id), req.user.tenantId, 'Cliente');
    if (c.role !== 'client') throw new HttpError(404, 'Cliente no encontrado', 'NOT_FOUND');
    const [info] = await db.query(
      `SELECT u.id, u.username, u.full_name, u.email, u.phone, u.active, u.consent_at, u.home_site_id, p.document, hs.name AS home_site_name
         FROM users u JOIN persons p ON p.id = u.person_id LEFT JOIN sites hs ON hs.id = u.home_site_id WHERE u.id = $1`,
      [c.id],
    );
    const academies = await db.query(`SELECT a.id, a.name FROM client_academies ca JOIN academies a ON a.id = ca.academy_id WHERE ca.client_id = $1 ORDER BY a.name`, [c.id]);
    const payments = await db.query(
      `SELECT pay.id, pay.amount::float8, pay.method, pay.reference, pay.paid_at, pay.membership_id, pay.booking_id, coalesce(pl.name, b.title) AS concept
         FROM payments pay LEFT JOIN memberships m ON m.id = pay.membership_id LEFT JOIN plans pl ON pl.id = m.plan_id LEFT JOIN bookings b ON b.id = pay.booking_id
        WHERE pay.client_id = $1 ORDER BY pay.paid_at DESC LIMIT 100`,
      [c.id],
    );
    const attendances = await db.query(
      `SELECT at.id, at.scanned_at, at.over_capacity, a.name AS academy_name, s.name AS site_name, b.title AS booking_title
         FROM attendances at JOIN academies a ON a.id = at.academy_id JOIN sites s ON s.id = at.site_id LEFT JOIN bookings b ON b.id = at.booking_id
        WHERE at.client_id = $1 ORDER BY at.scanned_at DESC LIMIT 50`,
      [c.id],
    );
    res.json({ ...info, academies, memberships: await membershipsOf(db, [c.id]), payments, attendances });
  });

  const clientBody = z.object({
    fullName: text(120), email, phone: optText(30), academyIds: z.array(id).min(1, 'Selecciona al menos una academia'),
    homeSiteId: optId.nullable(), active: z.boolean().default(true),
  });

  // El personal registra un cliente; aceptara el tratamiento de datos en su primer ingreso (RQ14)
  r.post('/clients', requirePerm('clients'), async (req, res) => {
    const b = parse(clientBody.extend({ username, password, document }), req.body);
    await ownAll(db, 'academies', b.academyIds, req.user.tenantId);
    if (b.homeSiteId) await own(db, 'sites', b.homeSiteId, req.user.tenantId, 'Sede');
    const clientId = await db.tx(async (q) => {
      await assertUsernameFree(q, b.username);
      const personId = await upsertPerson(q, b.document, b.fullName);
      await assertNoAccountInTenant(q, req.user.tenantId, personId);
      const [u] = await q.query(
        `INSERT INTO users (tenant_id, person_id, username, password_hash, full_name, email, phone, role, home_site_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'client', $8) RETURNING id`,
        [req.user.tenantId, personId, b.username, await hashPassword(b.password), b.fullName, b.email ?? null, b.phone, b.homeSiteId ?? null],
      );
      await q.query(`INSERT INTO client_academies (client_id, academy_id) SELECT $1, unnest($2::int[])`, [u.id, b.academyIds]);
      return u.id;
    });
    res.status(201).json({ id: clientId });
  });

  r.put('/clients/:id', requirePerm('clients'), async (req, res) => {
    const c = await own(db, 'users', parse(id, req.params.id), req.user.tenantId, 'Cliente');
    if (c.role !== 'client') throw new HttpError(404, 'Cliente no encontrado', 'NOT_FOUND');
    const b = parse(clientBody.extend({ password: password.optional().or(z.literal('').transform(() => undefined)) }), req.body);
    await ownAll(db, 'academies', b.academyIds, req.user.tenantId);
    if (b.homeSiteId) await own(db, 'sites', b.homeSiteId, req.user.tenantId, 'Sede');
    await db.tx(async (q) => {
      await q.query(`UPDATE users SET full_name = $2, email = $3, phone = $4, home_site_id = $5, active = $6 WHERE id = $1`, [c.id, b.fullName, b.email ?? null, b.phone, b.homeSiteId ?? null, b.active]);
      if (b.password) await q.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [c.id, await hashPassword(b.password)]);
      await q.query(`DELETE FROM client_academies WHERE client_id = $1 AND NOT (academy_id = ANY($2::int[]))`, [c.id, b.academyIds]);
      await q.query(`INSERT INTO client_academies (client_id, academy_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING`, [c.id, b.academyIds]);
    });
    res.json({ ok: true });
  });

  // ------------------------------------------------------------------ Planes adquiridos
  r.post('/memberships', requirePerm('clients'), async (req, res) => {
    const b = parse(z.object({ clientId: id, planId: id, startsOn: dateStr.optional(), payment: z.object(paymentFields).optional().nullable() }), req.body);
    const c = await own(db, 'users', b.clientId, req.user.tenantId, 'Cliente');
    if (c.role !== 'client') throw new HttpError(400, 'Solo se asignan planes a clientes');
    const plan = await own(db, 'plans', b.planId, req.user.tenantId, 'Plan');
    if (!plan.active) throw new HttpError(409, 'El plan está inactivo');
    const startsOn = b.startsOn ?? todayLocal();
    const membershipId = await db.tx(async (q) => {
      const [m] = await q.query(
        `INSERT INTO memberships (tenant_id, client_id, plan_id, starts_on, ends_on, units_total, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [req.user.tenantId, c.id, plan.id, startsOn, addDays(startsOn, plan.validity_days - 1), plan.units, req.user.id],
      );
      // Al adquirir el plan el cliente queda asociado a todas sus academias (RQ13)
      await q.query(`INSERT INTO client_academies (client_id, academy_id) SELECT $1, academy_id FROM plan_academies WHERE plan_id = $2 ON CONFLICT DO NOTHING`, [c.id, plan.id]);
      if (b.payment) {
        await q.query(
          `INSERT INTO payments (tenant_id, client_id, membership_id, amount, method, reference, notes, paid_at, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, coalesce($8::timestamptz, now()), $9)`,
          [req.user.tenantId, c.id, m.id, b.payment.amount, b.payment.method, b.payment.reference, b.payment.notes, b.payment.paidAt ?? null, req.user.id],
        );
      }
      return m.id;
    });
    const [m] = (await membershipsOf(db, [c.id])).filter((x) => x.id === membershipId);
    res.status(201).json(m);
  });

  r.post('/memberships/:id/cancel', requirePerm('clients'), async (req, res) => {
    const m = await own(db, 'memberships', parse(id, req.params.id), req.user.tenantId, 'Plan adquirido');
    await db.query(`UPDATE memberships SET status = 'cancelled' WHERE id = $1`, [m.id]);
    res.json({ ok: true });
  });

  // ------------------------------------------------------------------ Pagos
  r.get('/payments', requirePerm('payments', 'reports'), async (req, res) => {
    const q = parse(z.object({ from: dateStr.optional(), to: dateStr.optional(), clientId: optId, academyId: optId, siteId: optId }), req.query);
    const { from, to } = range(q);
    res.json(await db.query(
      `SELECT pay.id, pay.amount::float8, pay.method, pay.reference, pay.notes, pay.paid_at, pay.membership_id, pay.booking_id,
              coalesce(u.full_name, pay.payer_name) AS payer, pay.client_id,
              CASE WHEN pay.membership_id IS NOT NULL THEN 'Plan: ' || pl.name ELSE 'Reserva: ' || b.title END AS concept
         FROM payments pay
         LEFT JOIN users u ON u.id = pay.client_id
         LEFT JOIN memberships m ON m.id = pay.membership_id LEFT JOIN plans pl ON pl.id = m.plan_id
         LEFT JOIN bookings b ON b.id = pay.booking_id LEFT JOIN sites bs ON bs.id = b.site_id
        WHERE pay.tenant_id = $1
          AND pay.paid_at >= ($2::date::timestamp AT TIME ZONE $4) AND pay.paid_at < (($3::date + 1)::timestamp AT TIME ZONE $4)
          AND ($5::int IS NULL OR pay.client_id = $5)
          AND ($6::int IS NULL OR bs.academy_id = $6 OR EXISTS (SELECT 1 FROM plan_academies pa WHERE pa.plan_id = m.plan_id AND pa.academy_id = $6))
          AND ($7::int IS NULL OR b.site_id = $7 OR (m.id IS NOT NULL AND (pl.all_sites OR EXISTS (SELECT 1 FROM plan_sites ps WHERE ps.plan_id = m.plan_id AND ps.site_id = $7))))
        ORDER BY pay.paid_at DESC`,
      [req.user.tenantId, from, to, TZ, q.clientId ?? null, q.academyId ?? null, q.siteId ?? null],
    ));
  });

  // Todo pago va ligado a un plan adquirido o a una reserva (RQ6)
  r.post('/payments', requirePerm('payments'), async (req, res) => {
    const b = parse(z.object({ ...paymentFields, membershipId: optId, bookingId: optId, payerName: optText(120) })
      .refine((p) => !!p.membershipId !== !!p.bookingId, { message: 'Asocia el pago a un plan adquirido o a una reserva (solo uno)', path: ['membershipId'] }), req.body);
    let clientId: number | null;
    if (b.membershipId) {
      clientId = (await own(db, 'memberships', b.membershipId, req.user.tenantId, 'Plan adquirido')).client_id;
    } else {
      const bk = await own(db, 'bookings', b.bookingId!, req.user.tenantId, 'Reserva');
      clientId = bk.client_id;
      if (!clientId && !b.payerName) throw new HttpError(400, 'payerName: Indica quién paga la reserva');
    }
    const [p] = await db.query(
      `INSERT INTO payments (tenant_id, client_id, payer_name, membership_id, booking_id, amount, method, reference, notes, paid_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10::timestamptz, now()), $11) RETURNING id, amount::float8, method, paid_at`,
      [req.user.tenantId, clientId, b.payerName, b.membershipId ?? null, b.bookingId ?? null, b.amount, b.method, b.reference, b.notes, b.paidAt ?? null, req.user.id],
    );
    res.status(201).json(p);
  });

  // ------------------------------------------------------------------ Personal (RQ17)
  const perms = z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).default([]);

  r.get('/users', requireAdmin, async (req, res) => {
    res.json(await db.query(
      `SELECT u.id, u.username, u.full_name, u.email, u.phone, u.role, u.permissions, u.active, p.document
         FROM users u JOIN persons p ON p.id = u.person_id WHERE u.tenant_id = $1 AND u.role IN ('admin', 'staff') ORDER BY u.role, u.full_name`,
      [req.user.tenantId],
    ));
  });

  r.post('/users', requireAdmin, async (req, res) => {
    const b = parse(z.object({ username, password, fullName: text(120), document, email, phone: optText(30), permissions: perms }), req.body);
    const userId = await db.tx(async (q) => {
      await assertUsernameFree(q, b.username);
      const personId = await upsertPerson(q, b.document, b.fullName);
      await assertNoAccountInTenant(q, req.user.tenantId, personId);
      const [u] = await q.query(
        `INSERT INTO users (tenant_id, person_id, username, password_hash, full_name, email, phone, role, permissions)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'staff', $8) RETURNING id`,
        [req.user.tenantId, personId, b.username, await hashPassword(b.password), b.fullName, b.email ?? null, b.phone, b.permissions],
      );
      return u.id;
    });
    res.status(201).json({ id: userId });
  });

  r.put('/users/:id', requireAdmin, async (req, res) => {
    const u = await own(db, 'users', parse(id, req.params.id), req.user.tenantId, 'Usuario');
    if (u.role !== 'staff') throw new HttpError(400, 'Solo se editan usuarios del personal');
    const b = parse(z.object({ fullName: text(120), email, phone: optText(30), permissions: perms, active: z.boolean().default(true), password: password.optional().or(z.literal('').transform(() => undefined)) }), req.body);
    await db.query(`UPDATE users SET full_name = $2, email = $3, phone = $4, permissions = $5, active = $6 WHERE id = $1`, [u.id, b.fullName, b.email ?? null, b.phone, b.permissions, b.active]);
    if (b.password) await db.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [u.id, await hashPassword(b.password)]);
    res.json({ ok: true });
  });

  return r;
}
