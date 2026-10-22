/**
 * Reglas de ocupacion de espacios (RQ18, RQ19) y de horarios de atencion (RQ2).
 */
import { HttpError } from '../auth.ts';
import type { Db } from '../db.ts';
import { localParts } from './util.ts';

export interface Space {
  id: number;
  site_id: number;
  name: string;
  max_capacity: number;
  allow_multi_group: boolean;
  max_groups: number;
  capacity_per_group: number | null;
}

export interface OpeningSlot {
  day: number;
  open: string;
  close: string;
}

/** Ocupacion del espacio entre start y end (grupos y personas de reservas confirmadas que se cruzan) */
export async function spaceOccupancy(db: Db, spaceId: number, start: Date, end: Date, excludeBookingId?: number) {
  const [r] = await db.query(
    `SELECT count(*)::int AS groups, coalesce(sum(group_size), 0)::int AS people
       FROM bookings
      WHERE space_id = $1 AND status = 'confirmed' AND starts_at < $3 AND ends_at > $2 AND id <> $4`,
    [spaceId, start, end, excludeBookingId ?? 0],
  );
  return r as { groups: number; people: number };
}

/**
 * Valida que el espacio admita un grupo de `groupSize` personas en ese horario:
 * - Espacio de un solo grupo: si ya hay una reserva que se cruza, esta ocupado.
 * - Espacio multigrupo: maximo `max_groups` grupos, `capacity_per_group` por grupo y `max_capacity` en total.
 */
export async function assertSpaceAvailable(db: Db, space: Space, start: Date, end: Date, groupSize: number, excludeBookingId?: number) {
  if (groupSize > space.max_capacity) {
    throw new HttpError(409, `El aforo máximo de ${space.name} es ${space.max_capacity} personas`, 'CAPACITY_FULL');
  }
  if (space.allow_multi_group && space.capacity_per_group && groupSize > space.capacity_per_group) {
    throw new HttpError(409, `Cada grupo en ${space.name} admite máximo ${space.capacity_per_group} personas`, 'GROUP_TOO_BIG');
  }
  const occ = await spaceOccupancy(db, space.id, start, end, excludeBookingId);
  if (!space.allow_multi_group && occ.groups > 0) {
    throw new HttpError(409, `${space.name} ya está reservado en ese horario`, 'SPACE_TAKEN');
  }
  if (space.allow_multi_group && occ.groups >= space.max_groups) {
    throw new HttpError(409, `${space.name} ya tiene ${occ.groups} de ${space.max_groups} grupos en ese horario`, 'SPACE_TAKEN');
  }
  if (occ.people + groupSize > space.max_capacity) {
    const free = Math.max(0, space.max_capacity - occ.people);
    throw new HttpError(409, `Aforo completo en ${space.name}: quedan ${free} cupos en ese horario`, 'CAPACITY_FULL');
  }
}

/** Si la sede tiene horarios configurados, la reserva debe caber en una franja del mismo dia */
export function assertWithinOpeningHours(siteName: string, hours: OpeningSlot[], start: Date, end: Date) {
  if (!hours || hours.length === 0) return;
  const s = localParts(start);
  const e = localParts(new Date(end.getTime() - 1)); // un fin a las 21:00 en punto cuenta como 20:59
  const ok = s.date === e.date && hours.some((h) => h.day === s.day && h.open <= s.time && e.time < h.close);
  if (!ok) throw new HttpError(409, `El horario está fuera de la atención de la sede ${siteName}`, 'OUT_OF_HOURS');
}
