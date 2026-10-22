/**
 * Planes adquiridos por un cliente con su cobertura (academias y sedes) y saldo de clases (RQ7, RQ11, RQ12, RQ16).
 */
import type { Db } from '../db.ts';
import { idList, todayLocal } from './util.ts';

export interface MembershipView {
  id: number;
  client_id: number;
  plan_id: number;
  plan_name: string;
  kind: 'classes' | 'reservations' | 'access' | 'mixed';
  starts_on: string;
  ends_on: string;
  units_total: number | null;
  units_used: number;
  remaining: number | null; // null = ilimitado
  status: 'active' | 'cancelled';
  all_sites: boolean;
  academies: { id: number; name: string }[];
  sites: { id: number; name: string }[];
  paid: number;
  price: number;
  is_current: boolean; // activo, vigente hoy y con saldo
}

/** Academias y sedes de cada plan: { planId: { academies, sites } } */
export async function planPlaces(db: Db, planIds: number[]) {
  const out = new Map<number, { academies: { id: number; name: string }[]; sites: { id: number; name: string }[] }>();
  for (const pid of planIds) out.set(pid, { academies: [], sites: [] });
  if (!planIds.length) return out;
  const list = idList([...new Set(planIds)]);
  const academies = await db.query(`SELECT pa.plan_id, a.id, a.name FROM plan_academies pa JOIN academies a ON a.id = pa.academy_id WHERE pa.plan_id IN ${list} ORDER BY a.name`);
  const sites = await db.query(`SELECT ps.plan_id, s.id, s.name FROM plan_sites ps JOIN sites s ON s.id = ps.site_id WHERE ps.plan_id IN ${list} ORDER BY s.name`);
  for (const a of academies) out.get(a.plan_id)!.academies.push({ id: a.id, name: a.name });
  for (const x of sites) out.get(x.plan_id)!.sites.push({ id: x.id, name: x.name });
  return out;
}

export async function membershipsOf(db: Db, clientIds: number[]): Promise<MembershipView[]> {
  if (clientIds.length === 0) return [];
  const rows = await db.query(
    `SELECT m.id, m.client_id, m.plan_id, p.name AS plan_name, p.kind, m.starts_on, m.ends_on, m.units_total, m.units_used,
            m.status, p.all_sites, p.price,
            (SELECT coalesce(sum(amount), 0) FROM payments pay WHERE pay.membership_id = m.id) AS paid
       FROM memberships m JOIN plans p ON p.id = m.plan_id
      WHERE m.client_id IN ${idList(clientIds)}
      ORDER BY m.ends_on DESC, m.id DESC`,
  );
  const places = await planPlaces(db, rows.map((m) => m.plan_id));
  const today = todayLocal();
  return rows.map((m) => {
    const remaining = m.units_total == null ? null : Math.max(0, m.units_total - m.units_used);
    return {
      ...m,
      ...places.get(m.plan_id)!,
      price: Number(m.price),
      paid: Number(m.paid),
      remaining,
      is_current: m.status === 'active' && m.starts_on <= today && today <= m.ends_on && (remaining == null || remaining > 0),
    };
  });
}

const KIND_LABEL: Record<string, string> = { classes: 'clases', reservations: 'reservas', access: 'acceso', mixed: 'mixto' };

/**
 * Plan vigente con saldo que cubre la academia, la sede y el tipo de uso (clase, reserva de espacio o ingreso
 * general). Si hay varios, el que vence primero. Si no hay, explica por que no sirve cada plan (RQ16, RQ31).
 */
export function pickMembership(all: MembershipView[], kinds: readonly string[], academyId: number, siteId: number) {
  const candidates = all
    .filter((m) => m.is_current && kinds.includes(m.kind) && coversPlace(m, academyId, siteId))
    .sort((x, y) => x.ends_on.localeCompare(y.ends_on) || (x.remaining == null ? 1 : 0) - (y.remaining == null ? 1 : 0));
  if (candidates[0]) return { membership: candidates[0], reasons: [] as string[] };
  const reasons = all.filter((m) => m.status === 'active').map((m) => {
    if (!m.is_current) return `${m.plan_name}: ${m.remaining === 0 ? 'sin clases disponibles' : 'fuera de vigencia'}`;
    if (!kinds.includes(m.kind)) return `${m.plan_name}: es de ${KIND_LABEL[m.kind]}`;
    return `${m.plan_name}: no incluye esta academia o sede`;
  });
  return { membership: null, reasons };
}

/** Que tipo de plan cubre cada contexto de ingreso */
export const KINDS_FOR_CONTEXT = {
  class: ['classes', 'mixed'],
  rental: ['reservations', 'mixed'],
  general: ['access', 'classes', 'mixed'],
} as const;

/** ¿El plan permite entrar a esta academia y sede? (RQ11, RQ12) */
export function coversPlace(m: MembershipView, academyId: number, siteId: number) {
  if (!m.academies.some((a) => a.id === academyId)) return false;
  return m.all_sites || m.sites.some((s) => s.id === siteId);
}
