/**
 * Registro, inicio de sesion, perfil propio, consentimiento de datos (RQ14) y QR del cliente (RQ7).
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import {
  CONSENT_VERSION, tenantBlock, HttpError, PERMISSIONS, QR_TTL_SECONDS, authenticate, checkPassword, hashPassword, signQr, signSession,
} from '../auth.ts';
import type { Db } from '../db.ts';
import { joinCode, optText, parse, text } from '../lib/util.ts';

const username = z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{4,40}$/, 'Usa 4 a 40 letras, números, punto, guion o guion bajo');
const password = z.string().min(8, 'Mínimo 8 caracteres').max(100);
const document = z.string().trim().regex(/^[A-Za-z0-9-]{4,20}$/, 'Documento inválido');
const consent = z.literal(true, { error: 'Debes aceptar el tratamiento de datos' });

const personFields = {
  username,
  password,
  fullName: text(120),
  document,
  email: z.string().trim().email('Correo inválido').optional().nullable(),
  phone: optText(30),
};

/** Busca la persona por documento o la crea. Una misma persona puede tener cuentas en varias organizaciones (RQ26) */
/** RQ58: por defecto las organizaciones nuevas requieren activacion (TENANT_APPROVAL=off la desactiva) */
const requiresApproval = () => (process.env.TENANT_APPROVAL ?? 'on').toLowerCase() !== 'off';

export async function upsertPerson(db: Db, documentId: string, fullName: string) {
  const doc = documentId.toUpperCase();
  const [found] = await db.query(`SELECT id FROM persons WHERE document = $1`, [doc]);
  if (found) return found.id as number;
  const [p] = await db.query(`INSERT INTO persons (document, full_name) VALUES ($1, $2) RETURNING id`, [doc, fullName]);
  return p.id as number;
}

/** Asocia el cliente a las academias que aun no tenga (RQ13) */
export async function linkClientAcademies(db: Db, clientId: number, academyIds: number[]) {
  for (const academyId of academyIds) {
    await db.query(
      `INSERT INTO client_academies (client_id, academy_id)
       SELECT $1::int, $2::int WHERE NOT EXISTS (SELECT 1 FROM client_academies WHERE client_id = $1 AND academy_id = $2)`,
      [clientId, academyId],
    );
  }
}

export async function assertUsernameFree(db: Db, name: string) {
  const [u] = await db.query(`SELECT 1 FROM users WHERE username = $1`, [name]);
  if (u) throw new HttpError(409, 'Ese usuario ya existe, elige otro', 'USERNAME_TAKEN');
}

export async function assertNoAccountInTenant(db: Db, tenantId: number, personId: number) {
  const [u] = await db.query(`SELECT username FROM users WHERE tenant_id = $1 AND person_id = $2`, [tenantId, personId]);
  if (u) throw new HttpError(409, 'Esta persona ya tiene una cuenta en esta organización. Inicia sesión con ella.', 'ALREADY_REGISTERED');
}

export async function profile(db: Db, userId: number) {
  const [u] = await db.query(
    `SELECT u.id, u.username, u.full_name, u.email, u.phone, u.role, u.permissions, u.consent_at, u.consent_version, u.is_superadmin,
            p.document, t.id AS tenant_id, t.name AS tenant_name
       FROM users u JOIN persons p ON p.id = u.person_id JOIN tenants t ON t.id = u.tenant_id
      WHERE u.id = $1`,
    [userId],
  );
  const academies = u.role === 'client'
    ? await db.query(
        `SELECT a.id, a.name FROM client_academies ca JOIN academies a ON a.id = ca.academy_id WHERE ca.client_id = $1 ORDER BY a.name`,
        [userId],
      )
    : await db.query(`SELECT id, name, join_code FROM academies WHERE tenant_id = $1 ORDER BY name`, [u.tenant_id]);
  return {
    id: u.id,
    username: u.username,
    fullName: u.full_name,
    email: u.email,
    phone: u.phone,
    document: u.document,
    role: u.role,
    permissions: u.role === 'admin' ? Object.keys(PERMISSIONS) : u.role === 'client' ? [] : u.permissions,
    consentAt: u.consent_at,
    consentRequired: !u.consent_at || u.consent_version !== CONSENT_VERSION,
    tenant: { id: u.tenant_id, name: u.tenant_name },
    isSuperadmin: !!u.is_superadmin,
    academies,
  };
}

export function authRoutes(db: Db) {
  const r = Router();
  const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiados intentos, espera unos minutos' } });

  r.post('/auth/login', limiter, async (req, res) => {
    const b = parse(z.object({ username: z.string().trim().toLowerCase(), password: z.string() }), req.body);
    const [u] = await db.query(
      `SELECT u.id, u.password_hash, u.active, u.is_superadmin, t.status AS tenant_status FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.username = $1`,
      [b.username],
    );
    if (!u || !(await checkPassword(b.password, u.password_hash))) throw new HttpError(401, 'Usuario o contraseña incorrectos', 'BAD_CREDENTIALS');
    if (!u.active) throw new HttpError(403, 'La cuenta está desactivada', 'INACTIVE');
    const blocked = tenantBlock(u.tenant_status, !!u.is_superadmin); // RQ58
    if (blocked) throw blocked;
    res.json({ token: signSession(u.id), user: await profile(db, u.id) });
  });

  // Un administrador crea su organizacion con su primera academia y sede
  r.post('/auth/register-admin', limiter, async (req, res) => {
    const b = parse(z.object({ ...personFields, organization: text(120), academyName: text(120), siteName: text(120).default('Sede principal'), consent, signupCode: z.string().optional() }), req.body);
    if (process.env.ADMIN_SIGNUP_CODE && b.signupCode !== process.env.ADMIN_SIGNUP_CODE) {
      throw new HttpError(403, 'Código de alta de administrador inválido', 'BAD_SIGNUP_CODE');
    }
    const userId = await db.tx(async (q) => {
      await assertUsernameFree(q, b.username);
      const personId = await upsertPerson(q, b.document, b.fullName);
      // RQ58: la organizacion nueva queda pendiente hasta que el administrador general la active
      const [t] = await q.query(`INSERT INTO tenants (name, status) VALUES ($1, $2) RETURNING id`, [b.organization, requiresApproval() ? 'pending' : 'active']);
      const [u] = await q.query(
        `INSERT INTO users (tenant_id, person_id, username, password_hash, full_name, email, phone, role, consent_at, consent_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'admin', now(), $8) RETURNING id`,
        [t.id, personId, b.username, await hashPassword(b.password), b.fullName, b.email ?? null, b.phone, CONSENT_VERSION],
      );
      const [a] = await q.query(`INSERT INTO academies (tenant_id, name, join_code) VALUES ($1, $2, $3) RETURNING id`, [t.id, b.academyName, joinCode()]);
      await q.query(`INSERT INTO sites (tenant_id, academy_id, name) VALUES ($1, $2, $3)`, [t.id, a.id, b.siteName]);
      return u.id as number;
    });
    if (requiresApproval()) {
      return res.status(201).json({ pending: true, message: 'Registro recibido. Podrás ingresar cuando el administrador general active tu organización.' });
    }
    res.status(201).json({ token: signSession(userId), user: await profile(db, userId) });
  });

  // Un cliente se registra con el codigo de la academia (RQ7). Si ya existe en otra organizacion, se crea
  // una cuenta nueva ligada a la misma persona (RQ26)
  r.post('/auth/register-client', limiter, async (req, res) => {
    const b = parse(z.object({ ...personFields, joinCode: z.string().trim().toUpperCase().min(4), consent }), req.body);
    const [academy] = await db.query(
      `SELECT a.id, a.tenant_id FROM academies a JOIN tenants t ON t.id = a.tenant_id WHERE a.join_code = $1 AND a.active = true AND t.status = 'active'`,
      [b.joinCode],
    );
    if (!academy) throw new HttpError(404, 'Código de academia no válido', 'BAD_JOIN_CODE');
    const userId = await db.tx(async (q) => {
      await assertUsernameFree(q, b.username);
      const personId = await upsertPerson(q, b.document, b.fullName);
      await assertNoAccountInTenant(q, academy.tenant_id, personId);
      const [u] = await q.query(
        `INSERT INTO users (tenant_id, person_id, username, password_hash, full_name, email, phone, role, consent_at, consent_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'client', now(), $8) RETURNING id`,
        [academy.tenant_id, personId, b.username, await hashPassword(b.password), b.fullName, b.email ?? null, b.phone, CONSENT_VERSION],
      );
      await q.query(`INSERT INTO client_academies (client_id, academy_id) VALUES ($1, $2)`, [u.id, academy.id]);
      return u.id as number;
    });
    res.status(201).json({ token: signSession(userId), user: await profile(db, userId) });
  });

  const auth = authenticate(db);

  r.get('/me', auth, async (req, res) => {
    res.json(await profile(db, req.user.id));
  });

  r.put('/me', auth, async (req, res) => {
    const b = parse(z.object({ fullName: text(120), email: z.string().trim().email('Correo inválido').optional().nullable(), phone: optText(30) }), req.body);
    await db.query(`UPDATE users SET full_name = $2, email = $3, phone = $4 WHERE id = $1`, [req.user.id, b.fullName, b.email ?? null, b.phone]);
    res.json(await profile(db, req.user.id));
  });

  // Aceptacion del tratamiento de datos (clientes creados por el admin la aceptan al primer ingreso)
  r.post('/me/consent', auth, async (req, res) => {
    parse(z.object({ consent }), req.body);
    await db.query(`UPDATE users SET consent_at = now(), consent_version = $2 WHERE id = $1`, [req.user.id, CONSENT_VERSION]);
    res.json(await profile(db, req.user.id));
  });

  r.post('/me/password', auth, async (req, res) => {
    const b = parse(z.object({ current: z.string(), password }), req.body);
    const [u] = await db.query(`SELECT password_hash FROM users WHERE id = $1`, [req.user.id]);
    if (!(await checkPassword(b.current, u.password_hash))) throw new HttpError(400, 'La contraseña actual no coincide', 'BAD_CREDENTIALS');
    await db.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [req.user.id, await hashPassword(b.password)]);
    res.json({ ok: true });
  });

  // El cliente se asocia a otra academia de la misma organizacion (RQ13)
  r.post('/me/academies', auth, async (req, res) => {
    if (req.user.role !== 'client') throw new HttpError(400, 'Solo para clientes');
    const b = parse(z.object({ joinCode: z.string().trim().toUpperCase().min(4) }), req.body);
    const [a] = await db.query(`SELECT id, tenant_id FROM academies WHERE join_code = $1 AND active = true`, [b.joinCode]);
    if (!a) throw new HttpError(404, 'Código de academia no válido', 'BAD_JOIN_CODE');
    if (a.tenant_id !== req.user.tenantId) {
      throw new HttpError(409, 'Esa academia pertenece a otra organización: crea una cuenta nueva con tu mismo documento desde "Crear cuenta".', 'OTHER_TENANT');
    }
    await linkClientAcademies(db, req.user.id, [a.id]);
    res.json(await profile(db, req.user.id));
  });

  r.get('/me/qr', auth, async (req, res) => {
    if (req.user.role !== 'client') throw new HttpError(400, 'El código QR es para clientes');
    res.json({ token: signQr(req.user.id, req.user.tenantId), expiresIn: QR_TTL_SECONDS });
  });

  r.get('/permissions', auth, (_req, res) => {
    res.json(Object.entries(PERMISSIONS).map(([key, label]) => ({ key, label })));
  });

  return r;
}
