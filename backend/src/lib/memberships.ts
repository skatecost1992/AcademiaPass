/**
 * Planes adquiridos por un cliente con su cobertura (academias y sedes) y saldo de clases (RQ7, RQ11, RQ12, RQ16).
 */
import type { Db } from '../db.ts';
import { todayLocal } from './util.ts';

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

export async function membershipsOf(db: Db, clientIds: number[]): Promise<MembershipView[]> {
  if (clientIds.length === 0) return [];
  const rows = await db.query(
    `SELECT m.id, m.client_id, m.plan_id, p.name AS plan_name, p.kind, m.starts_on, m.ends_on, m.units_total, m.units_used,
            m.status, p.all_sites, p.price::float8 AS price,
            coalesce((SELECT json_agg(json_build_object('id', a.id, 'name', a.name) ORDER BY a.name)
                        FROM plan_academies pa JOIN academies a ON a.id = pa.academy_id WHERE pa.plan_id = p.id), '[]') AS academies,
            coalesce((SELECT json_agg(json_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
                        FROM plan_sites ps JOIN sites s ON s.id = ps.site_id WHERE ps.plan_id = p.id), '[]') AS sites,
            (SELECT coalesce(sum(amount), 0)::float8 FROM payments pay WHERE pay.membership_id = m.id) AS paid
       FROM memberships m JOIN plans p ON p.id = m.plan_id
      WHERE m.client_id = ANY($1::int[])
      ORDER BY m.ends_on DESC, m.id DESC`,
    [clientIds],
  );
  const today = todayLocal();
  return rows.map((m) => {
    const academies = typeof m.academies === 'string' ? JSON.parse(m.academies) : m.academies;
    const sites = typeof m.sites === 'string' ? JSON.parse(m.sites) : m.sites;
    const remaining = m.units_total == null ? null : Math.max(0, m.units_total - m.units_used);
    return {
      ...m,
      academies,
      sites,
      remaining,
      is_current: m.status === 'active' && m.starts_on <= today && today <= m.ends_on && (remaining == null || remaining > 0),
    };
  });
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
