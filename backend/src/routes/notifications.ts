/**
 * Parametros de los correos (RQ63, RQ64):
 *  - La organizacion (admin o usuario con el permiso `notifications`) decide que avisos se envian y con cuantos
 *    dias de anticipacion se avisa el vencimiento del plan.
 *  - Cada usuario, cliente o personal, decide cuales recibe y a que correo.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { HttpError, requirePerm } from '../auth.ts';
import type { Db } from '../db.ts';
import { compose, mailConfigured, mailProvider, mailSender, sendMail } from '../lib/mailer.ts';
import { DAY_BEFORE_H, HOURS_BEFORE_H, dispatchNotifications } from '../lib/notifications.ts';
import { id, parse } from '../lib/util.ts';

const flags = { dayBefore: z.boolean(), hoursBefore: z.boolean(), plan: z.boolean() };

export function notificationRoutes(db: Db) {
  const r = Router();

  const orgSettings = async (tenantId: number) => {
    const [t] = await db.query(
      `SELECT notify_day_before, notify_hours_before, notify_plan, plan_notice_days FROM tenants WHERE id = $1`,
      [tenantId],
    );
    return {
      dayBefore: !!t.notify_day_before,
      hoursBefore: !!t.notify_hours_before,
      plan: !!t.notify_plan,
      planNoticeDays: t.plan_notice_days as number,
      dayBeforeHours: DAY_BEFORE_H,
      hoursBeforeHours: HOURS_BEFORE_H,
      mailConfigured: mailConfigured(), // sin proveedor los correos solo quedan registrados
      mailProvider: mailProvider(),     // RQ67: 'gmail-api' o 'gmail' = desde la cuenta de Gmail del administrador
      mailFrom: mailSender(),
    };
  };

  r.get('/notification-settings', async (req, res) => {
    res.json(await orgSettings(req.user.tenantId));
  });

  r.put('/notification-settings', requirePerm('notifications'), async (req, res) => {
    const b = parse(z.object({ ...flags, planNoticeDays: z.coerce.number().int().min(0).max(30) }), req.body);
    await db.query(
      `UPDATE tenants SET notify_day_before = $2, notify_hours_before = $3, notify_plan = $4, plan_notice_days = $5 WHERE id = $1`,
      [req.user.tenantId, b.dayBefore, b.hoursBefore, b.plan, b.planNoticeDays],
    );
    res.json(await orgSettings(req.user.tenantId));
  });

  /** Usuario de la organizacion que puede gestionar quien pide: el admin a todos; con permiso de clientes, a clientes */
  const managedUser = async (req: Request) => {
    const [u] = await db.query(`SELECT id, role FROM users WHERE id = $1 AND tenant_id = $2`, [parse(id, req.params.id), req.user.tenantId]);
    if (!u) throw new HttpError(404, 'Usuario no encontrado', 'NOT_FOUND');
    if (req.user.role !== 'admin' && !(u.role === 'client' && req.user.permissions.includes('clients'))) {
      throw new HttpError(403, 'No tienes permiso para esta acción', 'FORBIDDEN');
    }
    return u as { id: number; role: string };
  };

  const mine = async (userId: number, tenantId: number) => {
    const [u] = await db.query(`SELECT email, notify_day_before, notify_hours_before, notify_plan FROM users WHERE id = $1`, [userId]);
    return {
      email: u.email as string | null,
      dayBefore: !!u.notify_day_before,
      hoursBefore: !!u.notify_hours_before,
      plan: !!u.notify_plan,
      organization: await orgSettings(tenantId),
    };
  };

  r.get('/me/notifications', async (req, res) => {
    res.json(await mine(req.user.id, req.user.tenantId));
  });

  r.put('/me/notifications', async (req, res) => {
    const b = parse(z.object({
      ...flags,
      email: z.preprocess((v) => (typeof v === 'string' && !v.trim() ? null : v), z.string().trim().email('Correo inválido').nullable().optional()),
    }), req.body);
    if (b.email !== undefined) await db.query(`UPDATE users SET email = $2 WHERE id = $1`, [req.user.id, b.email]);
    await db.query(
      `UPDATE users SET notify_day_before = $2, notify_hours_before = $3, notify_plan = $4 WHERE id = $1`,
      [req.user.id, b.dayBefore, b.hoursBefore, b.plan],
    );
    res.json(await mine(req.user.id, req.user.tenantId));
  });

  // RQ70: el administrador (o el personal con permiso de clientes, para clientes) define los correos de otro usuario
  r.get('/users/:id/notifications', async (req, res) => {
    const u = await managedUser(req);
    res.json(await mine(u.id, req.user.tenantId));
  });
  r.put('/users/:id/notifications', async (req, res) => {
    const u = await managedUser(req);
    const b = parse(z.object(flags), req.body);
    await db.query(`UPDATE users SET notify_day_before = $2, notify_hours_before = $3, notify_plan = $4 WHERE id = $1`, [u.id, b.dayBefore, b.hoursBefore, b.plan]);
    res.json(await mine(u.id, req.user.tenantId));
  });

  // Ultimos correos de la organizacion, para revisar que salieron
  r.get('/notifications', requirePerm('notifications'), async (req, res) => {
    const rows = await db.query(
      `SELECT n.id, n.kind, n.ref_id, n.email, n.subject, n.status, n.error, n.created_at, u.full_name
         FROM notifications n JOIN users u ON u.id = n.user_id
        WHERE n.tenant_id = $1 ORDER BY n.created_at DESC, n.id DESC LIMIT 100`,
      [req.user.tenantId],
    );
    res.json(rows);
  });

  // Correo de prueba al usuario que lo pide, para validar la configuracion SMTP
  r.post('/notifications/test', requirePerm('notifications'), async (req, res) => {
    const [u] = await db.query(`SELECT email, full_name FROM users WHERE id = $1`, [req.user.id]);
    if (!u?.email) throw new HttpError(409, 'Registra tu correo en Mi perfil para recibir la prueba.', 'NO_EMAIL');
    if (!mailConfigured()) throw new HttpError(409, 'El servidor no tiene configurado el envío de correos (SMTP).', 'MAIL_NOT_CONFIGURED');
    try {
      await sendMail({ to: u.email, subject: 'AcademiaPass: correo de prueba', ...compose([{ p: `Hola ${u.full_name},` }, { p: 'El envío de correos de AcademiaPass funciona.' }]) });
    } catch (e) {
      throw new HttpError(502, `No se pudo enviar el correo: ${(e as Error).message}`, 'MAIL_FAILED');
    }
    res.json({ ok: true, email: u.email });
  });

  // Envia ya los avisos pendientes (la tarea automatica lo hace cada 5 minutos)
  r.post('/notifications/run', requirePerm('notifications'), async (_req, res) => {
    res.json(await dispatchNotifications(db));
  });

  return r;
}
