/**
 * Autenticacion (JWT), roles y permisos.
 *
 * Roles base (RQ23): admin (todos los permisos de su organizacion) y client (solo su informacion y su QR).
 * El admin crea usuarios `staff` con permisos puntuales (RQ17).
 */
import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Db } from './db.ts';

export const PERMISSIONS = {
  attendance: 'Registrar asistencias (escanear QR)',
  schedules: 'Configurar sedes, horarios de atención y espacios',
  classes: 'Configurar profesores, clases y horarios de clase',
  bookings: 'Gestionar reservas de espacios',
  clients: 'Gestionar clientes y planes adquiridos',
  plans: 'Configurar planes',
  payments: 'Registrar pagos',
  reports: 'Ver reportes de clientes y pagos',
  capacity_reports: 'Ver reportes de aforo',
  override_capacity: 'Permitir ingresos por fuera del aforo',
} as const;
export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/** Version del texto de tratamiento de datos que acepta el cliente (RQ14) */
export const CONSENT_VERSION = '2026-10';

export class HttpError extends Error {
  status: number;
  code?: string;
  extra?: Record<string, unknown>;
  constructor(status: number, message: string, code?: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export interface AuthUser {
  id: number;
  tenantId: number;
  personId: number;
  role: 'admin' | 'staff' | 'client';
  permissions: Permission[];
  fullName: string;
  username: string;
  consentAt: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user: AuthUser;
    }
  }
}

const secret = () => {
  const s = process.env.JWT_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production') throw new Error('Falta la variable JWT_SECRET');
  return 'solo-para-desarrollo-cambiar';
};

export const hashPassword = (p: string) => bcrypt.hash(p, 10);
export const checkPassword = (p: string, hash: string) => bcrypt.compare(p, hash);

export function signSession(userId: number) {
  return jwt.sign({ sub: String(userId), typ: 'session' }, secret(), { expiresIn: '30d' });
}

/** Token del QR del cliente: vence en minutos para que una captura de pantalla no sirva despues (RQ7) */
export const QR_TTL_SECONDS = 300;
export function signQr(userId: number, tenantId: number) {
  return jwt.sign({ sub: String(userId), tid: tenantId, typ: 'qr' }, secret(), { expiresIn: QR_TTL_SECONDS });
}

export function verifyQr(token: string): { userId: number; tenantId: number } {
  try {
    const p = jwt.verify(token, secret()) as jwt.JwtPayload;
    if (p.typ !== 'qr') throw new Error();
    return { userId: Number(p.sub), tenantId: Number(p.tid) };
  } catch (e) {
    const expired = e instanceof jwt.TokenExpiredError;
    throw new HttpError(400, expired ? 'El código QR venció. Pide al cliente que lo actualice.' : 'Código QR inválido', expired ? 'QR_EXPIRED' : 'QR_INVALID');
  }
}

export function effectivePermissions(role: string, perms: string[]): Permission[] {
  if (role === 'admin') return ALL_PERMISSIONS;
  if (role === 'client') return [];
  return perms.filter((p): p is Permission => p in PERMISSIONS);
}

export function authenticate(db: Db) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new HttpError(401, 'Inicia sesión para continuar', 'UNAUTHENTICATED');
    let userId: number;
    try {
      const p = jwt.verify(token, secret()) as jwt.JwtPayload;
      if (p.typ !== 'session') throw new Error();
      userId = Number(p.sub);
    } catch {
      throw new HttpError(401, 'La sesión venció. Vuelve a iniciar sesión.', 'UNAUTHENTICATED');
    }
    // Se lee el usuario en cada peticion para que un cambio de permisos o una desactivacion aplique de inmediato
    const [u] = await db.query(
      `SELECT id, tenant_id, person_id, role, permissions, full_name, username, consent_at, active FROM users WHERE id = $1`,
      [userId],
    );
    if (!u || !u.active) throw new HttpError(401, 'La cuenta no está activa', 'UNAUTHENTICATED');
    req.user = {
      id: u.id,
      tenantId: u.tenant_id,
      personId: u.person_id,
      role: u.role,
      permissions: effectivePermissions(u.role, u.permissions),
      fullName: u.full_name,
      username: u.username,
      consentAt: u.consent_at,
    };
    next();
  };
}

/** Exige al menos uno de los permisos indicados (el admin los tiene todos) */
export function requirePerm(...perms: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!perms.some((p) => req.user.permissions.includes(p))) {
      throw new HttpError(403, 'No tienes permiso para esta acción', 'FORBIDDEN');
    }
    next();
  };
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.user.role !== 'admin') throw new HttpError(403, 'Solo el administrador puede hacer esto', 'FORBIDDEN');
  next();
}

export const isStaffish = (u: AuthUser) => u.role === 'admin' || u.role === 'staff';
