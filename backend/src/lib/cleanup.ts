/**
 * Borrado de academias, sedes y espacios con todo lo que depende de ellos, en orden explicito.
 * PostgreSQL lo haria con ON DELETE CASCADE, pero SQL Server no admite varias rutas de cascada; asi el
 * comportamiento es el mismo en los dos motores. Ejecutar dentro de una transaccion.
 */
import { HttpError } from '../auth.ts';
import type { Db } from '../db.ts';
import { idList } from './util.ts';

export async function deleteSpaces(q: Db, tenantId: number, spaceIds: number[]) {
  if (!spaceIds.length) return;
  const list = idList(spaceIds);
  const [{ n }] = await q.query(`SELECT count(*) AS n FROM payments WHERE booking_id IN (SELECT id FROM bookings WHERE space_id IN ${list})`);
  if (n > 0) throw new HttpError(409, 'Hay reservas con pagos registrados: desactiva en lugar de borrar', 'IN_USE');
  await q.query(`UPDATE attendances SET booking_id = NULL WHERE booking_id IN (SELECT id FROM bookings WHERE space_id IN ${list})`);
  await q.query(`UPDATE attendances SET space_id = NULL WHERE space_id IN ${list}`);
  await q.query(`DELETE FROM bookings WHERE space_id IN ${list}`);
  await q.query(`DELETE FROM photos WHERE tenant_id = $1 AND owner_type = 'space' AND owner_id IN ${list}`, [tenantId]);
  await q.query(`DELETE FROM spaces WHERE id IN ${list}`);
}

export async function deleteSites(q: Db, tenantId: number, siteIds: number[]) {
  if (!siteIds.length) return;
  const list = idList(siteIds);
  const spaces = await q.query(`SELECT id FROM spaces WHERE site_id IN ${list}`);
  await deleteSpaces(q, tenantId, spaces.map((s) => s.id));
  await q.query(`DELETE FROM photos WHERE tenant_id = $1 AND owner_type = 'site' AND owner_id IN ${list}`, [tenantId]);
  await q.query(`DELETE FROM plan_sites WHERE site_id IN ${list}`);
  await q.query(`UPDATE users SET home_site_id = NULL WHERE home_site_id IN ${list}`);
  await q.query(`DELETE FROM sites WHERE id IN ${list}`);
}

export async function deleteAcademy(q: Db, tenantId: number, academyId: number) {
  const sites = await q.query(`SELECT id FROM sites WHERE academy_id = $1`, [academyId]);
  await deleteSites(q, tenantId, sites.map((s) => s.id));
  await q.query(`DELETE FROM classes WHERE academy_id = $1`, [academyId]);
  await q.query(`DELETE FROM plan_academies WHERE academy_id = $1`, [academyId]);
  await q.query(`DELETE FROM client_academies WHERE academy_id = $1`, [academyId]);
  await q.query(`DELETE FROM academies WHERE id = $1`, [academyId]);
}
