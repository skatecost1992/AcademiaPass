/**
 * Autenticacion (JWT), roles y permisos.
 *
 * Roles base (RQ23): admin (todos los permisos de su organizacion) y client (solo su informacion y su QR).
 * El admin crea usuarios `staff` con permisos puntuales (RQ17).
 */
import bcrypt from 'bcryptjs';
import { createHmac, timingSafeEqual } from 'node:crypto';
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
  booking_rules: 'Configurar reglas de reserva y cancelación', // RQ44
  notifications: 'Configurar los correos de recordatorio y vencimiento', // RQ63, RQ64
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
  isSuperadmin: boolean; // RQ58: administrador general (usuario base)
  teacherId: number | null; // RQ69: usuario de un profesor: solo gestiona sus propias clases
  actingTenantId: number | null; // RQ70: el administrador general esta administrando otra organizacion
}

/** RQ58: mensaje si la organizacion aun no esta activa; el administrador general siempre puede entrar */
export function tenantBlock(status: string, isSuperadmin: boolean) {
  if (isSuperadmin || status === 'active') return null;
  return status === 'rejected'
    ? new HttpError(403, 'El registro de tu organización fue rechazado por el administrador general.', 'TENANT_REJECTED')
    : new HttpError(403, 'Tu organización está pendiente de activación por el administrador general.', 'TENANT_PENDING');
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

/** RQ70: sesion del administrador general como administrador de otra organizacion (dura 8 horas) */
export function signActingSession(userId: number, tenantId: number) {
  return jwt.sign({ sub: String(userId), typ: 'session', act: tenantId }, secret(), { expiresIn: '8h' });
}

/** Token del QR del cliente: vence en minutos para que una captura de pantalla no sirva despues (RQ7) */
export const QR_TTL_SECONDS = 300;
/**
 * QR compacto (RQ57): "AP.<cliente>.<organizacion>.<vence en segundos>.<firma>", unos 40 caracteres en vez de
 * ~200 de un JWT, para que el codigo tenga modulos grandes y la camara lo lea facil. La firma es un HMAC-SHA256
 * truncado (96 bits) con la misma clave del servidor; vence a los QR_TTL_SECONDS.
 */
const qrSignature = (payload: string) => createHmac('sha256', secret()).update(`qr.${payload}`).digest('base64url').slice(0, 16);

export function signQr(userId: number, tenantId: number) {
  const payload = `${userId}.${tenantId}.${Math.floor(Date.now() / 1000) + QR_TTL_SECONDS}`;
  return `AP.${payload}.${qrSignature(payload)}`;
}

export function verifyQr(token: string): { userId: number; tenantId: number } {
  const compact = /^AP\.(\d+)\.(\d+)\.(\d+)\.([\w-]{16})$/.exec(token.trim());
  if (compact) {
    const [, uid, tid, exp, sig] = compact;
    const expected = Buffer.from(qrSignature(`${uid}.${tid}.${exp}`));
    if (!timingSafeEqual(expected, Buffer.from(sig))) throw new HttpError(400, 'Código QR inválido', 'QR_INVALID');
    if (Number(exp) * 1000 < Date.now()) throw new HttpError(400, 'El código QR venció. Pide al cliente que lo actualice.', 'QR_EXPIRED');
    return { userId: Number(uid), tenantId: Number(tid) };
  }
  // Formato anterior (JWT), por si un cliente tiene una version vieja de la app abierta
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
    let act: number | null = null;
    try {
      const p = jwt.verify(token, secret()) as jwt.JwtPayload;
      if (p.typ !== 'session') throw new Error();
      userId = Number(p.sub);
      act = p.act ? Number(p.act) : null;
    } catch {
      throw new HttpError(401, 'La sesión venció. Vuelve a iniciar sesión.', 'UNAUTHENTICATED');
    }
    // Se lee el usuario en cada peticion para que un cambio de permisos o una desactivacion aplique de inmediato
    const [u] = await db.query(
      `SELECT u.id, u.tenant_id, u.person_id, u.role, u.permissions, u.full_name, u.username, u.consent_at, u.active, u.is_superadmin, u.teacher_id, t.status AS tenant_status
         FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`,
      [userId],
    );
    if (!u || !u.active) throw new HttpError(401, 'La cuenta no está activa', 'UNAUTHENTICATED');
    const blocked = tenantBlock(u.tenant_status, !!u.is_superadmin);
    if (blocked) throw blocked;
    req.user = {
      id: u.id,
      tenantId: u.tenant_id,
      personId: u.person_id,
      role: u.role,
      permissions: effectivePermissions(u.role, u.permissions),
      fullName: u.full_name,
      username: u.username,
      consentAt: u.consent_at,
      isSuperadmin: !!u.is_superadmin,
      teacherId: u.teacher_id ?? null,
      actingTenantId: null,
    };
    // RQ70: el administrador general administra otra organizacion con todos los permisos de su administrador
    if (act != null) {
      if (!u.is_superadmin) throw new HttpError(401, 'La sesión no es válida', 'UNAUTHENTICATED');
      const [t] = await db.query(`SELECT id FROM tenants WHERE id = $1`, [act]);
      if (!t) throw new HttpError(401, 'La organización ya no existe', 'UNAUTHENTICATED');
      Object.assign(req.user, { tenantId: act, role: 'admin', permissions: ALL_PERMISSIONS, teacherId: null, actingTenantId: act });
    }
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

/** RQ69: permisos que se le pueden dar al usuario de un profesor (por defecto los tres primeros) */
export const TEACHER_PERMISSIONS = ['classes', 'bookings', 'attendance', 'booking_rules'] as const satisfies readonly Permission[];
export const DEFAULT_TEACHER_PERMISSIONS: Permission[] = ['classes', 'bookings', 'attendance'];

/** RQ69: el usuario de un profesor solo actua sobre sus propias clases y sesiones */
export function assertOwnTeacher(user: AuthUser, teacherId: number | null | undefined, what = 'esta clase') {
  if (user.teacherId != null && teacherId !== user.teacherId) {
    throw new HttpError(403, `Como profesor solo puedes gestionar tus propias clases (${what} es de otro profesor)`, 'NOT_YOUR_CLASS');
  }
}
