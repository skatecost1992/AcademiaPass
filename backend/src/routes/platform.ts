/**
 * Administracion general de la plataforma (RQ58). Solo el administrador general (usuario base `admin`) ve las
 * organizaciones registradas y activa o rechaza las nuevas.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { HttpError, signActingSession } from '../auth.ts';
import { profile } from './auth.ts';
import type { Db } from '../db.ts';
import { id, parse } from '../lib/util.ts';

function requireSuperadmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user.isSuperadmin) throw new HttpError(403, 'Solo el administrador general puede hacer esto', 'FORBIDDEN');
  next();
}

export function platformRoutes(db: Db) {
  const r = Router();

  r.get('/platform/tenants', requireSuperadmin, async (req, res) => {
    const status = parse(z.enum(['pending', 'active', 'rejected', 'all']).default('pending'), req.query.status);
    const rows = await db.query(
      `SELECT t.id, t.name, t.status, t.created_at, t.reviewed_at,
              (SELECT count(*) FROM academies a WHERE a.tenant_id = t.id) AS academies,
              (SELECT count(*) FROM users c WHERE c.tenant_id = t.id AND c.role = 'client') AS clients
         FROM tenants t WHERE ($1 = 'all' OR t.status = $1) ORDER BY t.created_at DESC`,
      [status],
    );
    // Datos de contacto del administrador de cada organizacion
    const admins = rows.length
      ? await db.query(`SELECT tenant_id, username, full_name, email, phone FROM users WHERE role = 'admin' ORDER BY id`)
      : [];
    res.json(rows.map((t) => ({
      ...t,
      academies: Number(t.academies),
      clients: Number(t.clients),
      admin: admins.find((a) => a.tenant_id === t.id) ?? null,
    })));
  });

  const review = (status: 'active' | 'rejected') => async (req: Request, res: Response) => {
    if (req.user.actingTenantId != null) throw new HttpError(400, 'Vuelve primero a tu organización', 'ALREADY_ACTING');
    const tenantId = parse(id, req.params.id);
    if (tenantId === req.user.tenantId) throw new HttpError(400, 'No puedes cambiar el estado de tu propia organización');
    const upd = await db.query(`UPDATE tenants SET status = $2, reviewed_at = $3 WHERE id = $1 RETURNING id, name, status`, [tenantId, status, new Date()]);
    if (!upd.length) throw new HttpError(404, 'Organización no encontrada', 'NOT_FOUND');
    res.json(upd[0]);
  };
  /**
   * RQ70: el administrador general entra a una organizacion como su administrador para hacer y parametrizar todo
   * (usuarios, clientes, planes, reglas, correos...). Recibe una sesion de 8 horas solo para esa organizacion.
   */
  r.post('/platform/tenants/:id/enter', requireSuperadmin, async (req, res) => {
    if (req.user.actingTenantId != null) throw new HttpError(400, 'Vuelve primero a tu organización', 'ALREADY_ACTING');
    const tenantId = parse(id, req.params.id);
    const [t] = await db.query(`SELECT id, name FROM tenants WHERE id = $1`, [tenantId]);
    if (!t) throw new HttpError(404, 'Organización no encontrada', 'NOT_FOUND');
    console.log(`[plataforma] ${new Date().toISOString()} ${req.user.username} administra la organizacion #${t.id} ${t.name}`);
    res.json({ token: signActingSession(req.user.id, t.id), user: await profile(db, req.user.id, t.id) });
  });

  r.post('/platform/tenants/:id/approve', requireSuperadmin, review('active'));
  r.post('/platform/tenants/:id/reject', requireSuperadmin, review('rejected'));

  return r;
}
