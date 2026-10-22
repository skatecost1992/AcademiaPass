/**
 * Planes (RQ7, RQ11, RQ12), clientes (RQ10, RQ13), planes adquiridos, pagos (RQ4, RQ6) y usuarios del
 * personal con permisos (RQ17).
 */
import { Router } from 'express';
import { z } from 'zod';
import { ALL_PERMISSIONS, HttpError, hashPassword, requireAdmin, requirePerm } from '../auth.ts';
import type { Db } from '../db.ts';
import { membershipsOf, planPlaces } from '../lib/memberships.ts';
import { addDays, dateStr, dayBounds, id, idList, isoDateTime, optId, optText, own, ownAll, parse, range, text, todayLocal } from '../lib/util.ts';
import { assertNoAccountInTenant, assertUsernameFree, linkClientAcademies, upsertPerson } from './auth.ts';

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

  /** Planes con sus academias y sedes permitidas */
  const loadPlans = async (where: string, params: unknown[]) => {
    const rows = await db.query(`SELECT * FROM plans p WHERE ${where} ORDER BY p.active DESC, p.name`, params);
    const places = await planPlaces(db, rows.map((p) => p.id));
    return rows.map((p) => ({ ...p, price: Number(p.price), ...places.get(p.id)! }));
  };

  r.get('/plans', async (req, res) => {
    res.json(await loadPlans(`p.tenant_id = $1 AND ($2 = true OR p.active = true)`, [req.user.tenantId, req.user.role !== 'client']));
  });

  const savePlan = async (tenantId: number, b: z.infer<typeof planBody>, planId?: number) => {
    await ownAll(db, 'academies', b.academyIds, tenantId);
    const siteIds = b.allSites ? [] : b.siteIds;
    if (siteIds.length) {
      await ownAll(db, 'sites', siteIds, tenantId);
      const bad = await db.query(`SELECT name FROM sites WHERE id IN ${idList(siteIds)} AND academy_id NOT IN ${idList(b.academyIds)}`);
      if (bad.length) throw new HttpError(400, `La sede ${bad[0].name} no pertenece a las academias del plan`);
    }
    return db.tx(async (q) => {
      const params = [b.name, b.description, b.kind, b.units ?? null, b.validityDays, b.price, b.allSites, b.active];
      const [p] = planId
        ? await q.query(`UPDATE plans SET name = $2, description = $3, kind = $4, units = $5, validity_days = $6, price = $7, all_sites = $8, active = $9 WHERE id = $1 RETURNING id`, [planId, ...params])
        : await q.query(`INSERT INTO plans (tenant_id, name, description, kind, units, validity_days, price, all_sites, active) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`, [tenantId, ...params]);
      await q.query(`DELETE FROM plan_academies WHERE plan_id = $1`, [p.id]);
      await q.query(`DELETE FROM plan_sites WHERE plan_id = $1`, [p.id]);
      for (const aid of new Set(b.academyIds)) await q.query(`INSERT INTO plan_academies (plan_id, academy_id) VALUES ($1, $2)`, [p.id, aid]);
      for (const sid of new Set(siteIds)) await q.query(`INSERT INTO plan_sites (plan_id, site_id) VALUES ($1, $2)`, [p.id, sid]);
      return p.id as number;
    }).then(async (pid) => (await loadPlans(`p.id = $1`, [pid]))[0]);
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
              (SELECT max(scanned_at) FROM attendances att WHERE att.client_id = u.id) AS last_attendance
         FROM users u JOIN persons p ON p.id = u.person_id LEFT JOIN sites hs ON hs.id = u.home_site_id
        WHERE u.tenant_id = $1 AND u.role = 'client'
          AND ($2::text IS NULL OR lower(u.full_name) LIKE lower(CONCAT('%', $2::text, '%')) OR lower(p.document) LIKE lower(CONCAT($2::text, '%'))
               OR u.username LIKE lower(CONCAT($2::text, '%')))
          AND ($3::int IS NULL OR EXISTS (SELECT 1 FROM client_academies ca WHERE ca.client_id = u.id AND ca.academy_id = $3))
          AND ($4::int IS NULL OR u.home_site_id = $4 OR EXISTS (SELECT 1 FROM attendances att WHERE att.client_id = u.id AND att.site_id = $4))
        ORDER BY u.full_name LIMIT 500`,
      [req.user.tenantId, q.q || null, q.academyId ?? null, q.siteId ?? null],
    );
    const links = rows.length
      ? await db.query(`SELECT ca.client_id, a.id, a.name FROM client_academies ca JOIN academies a ON a.id = ca.academy_id WHERE ca.client_id IN ${idList(rows.map((r) => r.id))} ORDER BY a.name`)
      : [];
    res.json(rows.map((c) => ({ ...c, academies: links.filter((l) => l.client_id === c.id).map((l) => ({ id: l.id, name: l.name })) })));
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
      `SELECT pay.id, pay.amount, pay.method, pay.reference, pay.paid_at, pay.membership_id, pay.booking_id, coalesce(pl.name, b.title) AS concept
         FROM payments pay LEFT JOIN memberships m ON m.id = pay.membership_id LEFT JOIN plans pl ON pl.id = m.plan_id LEFT JOIN bookings b ON b.id = pay.booking_id
        WHERE pay.client_id = $1 ORDER BY pay.paid_at DESC LIMIT 100`,
      [c.id],
    );
    const attendances = await db.query(
      `SELECT att.id, att.scanned_at, att.over_capacity, a.name AS academy_name, s.name AS site_name, b.title AS booking_title
         FROM attendances att JOIN academies a ON a.id = att.academy_id JOIN sites s ON s.id = att.site_id LEFT JOIN bookings b ON b.id = att.booking_id
        WHERE att.client_id = $1 ORDER BY att.scanned_at DESC LIMIT 50`,
      [c.id],
    );
    res.json({ ...info, academies, memberships: await membershipsOf(db, [c.id]), payments: payments.map((p) => ({ ...p, amount: Number(p.amount) })), attendances });
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
      await linkClientAcademies(q, u.id, b.academyIds);
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
      await q.query(`DELETE FROM client_academies WHERE client_id = $1 AND academy_id NOT IN ${idList(b.academyIds)}`, [c.id]);
      await linkClientAcademies(q, c.id, b.academyIds);
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
      const planAcademies = await q.query(`SELECT academy_id FROM plan_academies WHERE plan_id = $1`, [plan.id]);
      await linkClientAcademies(q, c.id, planAcademies.map((x) => x.academy_id));
      if (b.payment) {
        await q.query(
          `INSERT INTO payments (tenant_id, client_id, membership_id, amount, method, reference, notes, paid_at, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [req.user.tenantId, c.id, m.id, b.payment.amount, b.payment.method, b.payment.reference, b.payment.notes, b.payment.paidAt ? new Date(b.payment.paidAt) : new Date(), req.user.id],
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
    const [start, end] = dayBounds(from, to);
    res.json(await db.query(
      `SELECT pay.id, pay.amount, pay.method, pay.reference, pay.notes, pay.paid_at, pay.membership_id, pay.booking_id,
              coalesce(u.full_name, pay.payer_name) AS payer, pay.client_id,
              CASE WHEN pay.membership_id IS NOT NULL THEN CONCAT('Plan: ', pl.name) ELSE CONCAT('Reserva: ', b.title) END AS concept
         FROM payments pay
         LEFT JOIN users u ON u.id = pay.client_id
         LEFT JOIN memberships m ON m.id = pay.membership_id LEFT JOIN plans pl ON pl.id = m.plan_id
         LEFT JOIN bookings b ON b.id = pay.booking_id LEFT JOIN sites bs ON bs.id = b.site_id
        WHERE pay.tenant_id = $1
          AND pay.paid_at >= $2 AND pay.paid_at < $3
          AND ($4::int IS NULL OR pay.client_id = $4)
          AND ($5::int IS NULL OR bs.academy_id = $5 OR EXISTS (SELECT 1 FROM plan_academies pa WHERE pa.plan_id = m.plan_id AND pa.academy_id = $5))
          AND ($6::int IS NULL OR b.site_id = $6 OR (m.id IS NOT NULL AND (pl.all_sites = true OR EXISTS (SELECT 1 FROM plan_sites ps WHERE ps.plan_id = m.plan_id AND ps.site_id = $6))))
        ORDER BY pay.paid_at DESC`,
      [req.user.tenantId, start, end, q.clientId ?? null, q.academyId ?? null, q.siteId ?? null],
    ).then((rows) => rows.map((p) => ({ ...p, amount: Number(p.amount) }))));
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
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id, amount, method, paid_at`,
      [req.user.tenantId, clientId, b.payerName, b.membershipId ?? null, b.bookingId ?? null, b.amount, b.method, b.reference, b.notes, b.paidAt ? new Date(b.paidAt) : new Date(), req.user.id],
    );
    res.status(201).json({ ...p, amount: Number(p.amount) });
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
