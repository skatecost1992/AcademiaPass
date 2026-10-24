import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { HttpError } from '../auth.ts';
import { type Db, dialect } from '../db.ts';

/** Zona horaria del negocio: agrupa reportes por semana/mes y valida horarios de atencion */
export const TZ = process.env.APP_TIMEZONE ?? 'America/Bogota';

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const first = r.error.issues[0];
    const field = first.path.join('.');
    throw new HttpError(400, field ? `${field}: ${first.message}` : first.message, 'VALIDATION', { issues: r.error.issues });
  }
  return r.data;
}

const OWNED_TABLES = ['academies', 'sites', 'spaces', 'teachers', 'classes', 'bookings', 'plans', 'memberships', 'payments', 'users', 'photos'] as const;

/** Devuelve la fila si pertenece al tenant; si no, 404 (no revela que exista en otra organizacion, RQ25) */
export async function own<T = any>(db: Db, table: (typeof OWNED_TABLES)[number], id: number, tenantId: number, what = 'Registro'): Promise<T> {
  if (!OWNED_TABLES.includes(table)) throw new Error('tabla no permitida');
  const [row] = await db.query(`SELECT * FROM ${table} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  if (!row) throw new HttpError(404, `${what} no encontrado`, 'NOT_FOUND');
  return row as T;
}

/** Comprueba que todos los ids pertenezcan al tenant */
export async function ownAll(db: Db, table: 'academies' | 'sites', ids: number[], tenantId: number) {
  if (ids.length === 0) return;
  const rows = await db.query(`SELECT id FROM ${table} WHERE id IN ${idList([...new Set(ids)])} AND tenant_id = $1`, [tenantId]);
  if (rows.length !== new Set(ids).size) throw new HttpError(404, 'Alguna academia o sede no existe', 'NOT_FOUND');
}

/**
 * Bloquea la fila hasta que termine la transaccion de `q`, para que dos peticiones simultaneas no pasen a la vez la
 * misma validacion de cupo, aforo o cruce de horario (RQ18, RQ20, RQ38). Fuera de una transaccion no bloquea nada.
 * Para no bloquearse mutuamente, cada transaccion toma los bloqueos en este orden:
 * capacity_requests -> spaces -> bookings -> teachers -> users.
 */
export async function lockRow(q: Db, table: 'capacity_requests' | 'spaces' | 'bookings' | 'teachers' | 'users', rowId: number) {
  await q.query(
    dialect === 'mssql'
      ? `SELECT id FROM ${table} WITH (UPDLOCK, HOLDLOCK, ROWLOCK) WHERE id = $1`
      : `SELECT id FROM ${table} WHERE id = $1 FOR UPDATE`,
    [rowId],
  );
}

export function joinCode() {
  // Sin 0/O/1/I para que se pueda dictar por telefono
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(6);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** Dia de la semana (0 = domingo) y hora 'HH:MM' de un instante en la zona del negocio */
export function localParts(d: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day, time: `${get('hour')}:${get('minute')}`, date: `${get('year')}-${get('month')}-${get('day')}` };
}

/** Fecha de hoy 'YYYY-MM-DD' en la zona del negocio */
export const todayLocal = () => localParts(new Date()).date;

/** Suma meses calendario a 'YYYY-MM-DD' (31 ene + 1 mes = 28/29 feb) */
export function addMonths(date: string, months: number) {
  const [y, m, d] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, last))).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const id = z.coerce.number().int().positive();
export const optId = z.coerce.number().int().positive().optional();
export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato AAAA-MM-DD');
export const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Formato HH:MM');
export const isoDateTime = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Fecha y hora inválidas');
export const text = (max = 200) => z.string().trim().min(1, 'Obligatorio').max(max);
export const optText = (max = 500) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

/**
 * Lista de ids para `col IN ${idList(ids)}`. Los ids son enteros validados, asi que se escriben en el SQL:
 * funciona igual en PostgreSQL y SQL Server (que no tiene arreglos como parametro).
 */
export function idList(ids: number[]) {
  if (ids.some((n) => !Number.isSafeInteger(n))) throw new Error('id invalido');
  return ids.length ? `(${ids.join(', ')})` : '(NULL)';
}

/** Desfase (ms) de la zona del negocio respecto a UTC en un instante */
function tzOffset(at: Date) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at);
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - at.getTime();
}

/** Instante en que empieza el dia 'YYYY-MM-DD' en la zona del negocio */
export function startOfLocalDay(date: string) {
  const guess = new Date(`${date}T00:00:00Z`);
  return new Date(guess.getTime() - tzOffset(guess));
}

/** [inicio de `from`, inicio del dia siguiente a `to`) en la zona del negocio, para filtrar por fecha local */
export function dayBounds(from: string, to: string): [Date, Date] {
  return [startOfLocalDay(from), startOfLocalDay(addDays(to, 1))];
}

/** Inicio de la semana (lunes) o del mes de un instante, como 'YYYY-MM-DD' local */
export function periodStart(at: Date, groupBy: 'week' | 'month') {
  const { date, day } = localParts(at);
  if (groupBy === 'month') return `${date.slice(0, 8)}01`;
  return addDays(date, -((day + 6) % 7));
}

/** Rango de fechas de los reportes: por defecto los ultimos 90 dias */
export function range(q: { from?: string; to?: string }) {
  const to = q.to ?? todayLocal();
  const from = q.from ?? addDays(to, -90);
  if (from > to) throw new HttpError(400, 'La fecha inicial es mayor que la final');
  // RQ50: maximo un ano de registros por consulta
  if ((Date.parse(to) - Date.parse(from)) / 86400_000 > 366) throw new HttpError(400, 'El rango máximo de consulta es de un año', 'RANGE_TOO_LONG');
  return { from, to };
}
