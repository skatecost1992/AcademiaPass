/**
 * Registro de ingresos con el QR del cliente (RQ7, RQ16, RQ20).
 *
 * Antes de escanear, el personal elige academia, sede y (opcional) la clase o reserva de ese momento. Con eso
 * se busca el plan del cliente que cubre ese lugar y ese tipo de ingreso, y se descuenta una clase de ese plan:
 * si el cliente tiene un plan en la academia A y otro en la B, cada ingreso descuenta del plan que corresponde.
 */
import { Router } from 'express';
import { z } from 'zod';
import { HttpError, requireAdmin, requirePerm, verifyQr } from '../auth.ts';
import type { Db } from '../db.ts';
import { KINDS_FOR_CONTEXT, coversPlace, membershipsOf, type MembershipView } from '../lib/memberships.ts';
import { TZ, dateStr, id, optId, own, parse, range } from '../lib/util.ts';

const KIND_LABEL = { classes: 'clases', reservations: 'reservas', access: 'acceso', mixed: 'mixto' };

const scanBody = z.object({
  qrToken: z.string().min(10).optional(),
  clientId: optId, // registro manual (por documento) cuando el cliente no puede mostrar el QR
  academyId: id,
  siteId: id,
  bookingId: optId.nullable(),
  override: z.boolean().default(false),
  dryRun: z.boolean().default(false),
}).refine((b) => !!b.qrToken !== !!b.clientId, { message: 'Envía el QR o el cliente', path: ['qrToken'] });

export function attendanceRoutes(db: Db) {
  const r = Router();

  r.post('/attendance/scan', requirePerm('attendance'), async (req, res) => {
    const b = parse(scanBody, req.body);
    const tenantId = req.user.tenantId;

    let clientId = b.clientId;
    if (b.qrToken) {
      const qr = verifyQr(b.qrToken);
      // QR de un cliente de otra organizacion: para esta organizacion no existe (RQ25, RQ26)
      if (qr.tenantId !== tenantId) throw new HttpError(404, 'Este cliente no está registrado en tu organización', 'CLIENT_NOT_FOUND');
      clientId = qr.userId;
    }
    const [client] = await db.query(
      `SELECT u.id, u.full_name, u.active, u.role, p.document FROM users u JOIN persons p ON p.id = u.person_id WHERE u.id = $1 AND u.tenant_id = $2`,
      [clientId, tenantId],
    );
    if (!client || client.role !== 'client') throw new HttpError(404, 'Este cliente no está registrado en tu organización', 'CLIENT_NOT_FOUND');
    if (!client.active) throw new HttpError(409, `La cuenta de ${client.full_name} está desactivada`, 'INACTIVE');

    const site = await own(db, 'sites', b.siteId, tenantId, 'Sede');
    if (site.academy_id !== b.academyId) throw new HttpError(400, 'La sede no pertenece a la academia seleccionada');

    // ---------------------------------------------------------------- Contexto: clase, reserva o ingreso general
    let booking: any = null;
    let context: keyof typeof KINDS_FOR_CONTEXT = 'general';
    if (b.bookingId) {
      booking = await own(db, 'bookings', b.bookingId, tenantId, 'Clase o reserva');
      if (booking.site_id !== site.id) throw new HttpError(400, 'La clase o reserva es de otra sede');
      if (booking.status !== 'confirmed') throw new HttpError(409, 'La clase o reserva está cancelada');
      const now = Date.now();
      if (now < new Date(booking.starts_at).getTime() - 2 * 3600_000 || now > new Date(booking.ends_at).getTime()) {
        throw new HttpError(409, 'Solo se registran ingresos desde 2 horas antes del inicio hasta el final', 'OUT_OF_TIME');
      }
      context = booking.kind;
      const [dup] = await db.query(`SELECT 1 FROM attendances WHERE client_id = $1 AND booking_id = $2`, [client.id, booking.id]);
      if (dup) throw new HttpError(409, `${client.full_name} ya registró su ingreso a ${booking.title}`, 'ALREADY_REGISTERED');
    }

    // ---------------------------------------------------------------- Plan que cubre el ingreso
    const all = await membershipsOf(db, [client.id]);
    let membership: MembershipView | null = null;
    let paidOwnRental = false;
    if (booking?.kind === 'rental' && booking.client_id === client.id) {
      const [{ paid }] = await db.query(`SELECT coalesce(sum(amount), 0)::float8 AS paid FROM payments WHERE booking_id = $1`, [booking.id]);
      paidOwnRental = paid > 0; // reserva propia y pagada: no descuenta del plan
    }
    if (!paidOwnRental) {
      const kinds: readonly string[] = KINDS_FOR_CONTEXT[context];
      const candidates = all
        .filter((m) => m.is_current && kinds.includes(m.kind) && coversPlace(m, b.academyId, site.id))
        // primero el que vence antes; entre iguales, el que tiene saldo limitado (el ilimitado se reserva)
        .sort((x, y) => x.ends_on.localeCompare(y.ends_on) || (x.remaining == null ? 1 : 0) - (y.remaining == null ? 1 : 0));
      membership = candidates[0] ?? null;
      if (!membership) {
        const current = all.filter((m) => m.status === 'active');
        const reasons = current.map((m) => {
          if (!m.is_current) return `${m.plan_name}: ${m.remaining === 0 ? 'sin clases disponibles' : 'fuera de vigencia'}`;
          if (!kinds.includes(m.kind)) return `${m.plan_name}: es de ${KIND_LABEL[m.kind]}`;
          return `${m.plan_name}: no incluye esta academia o sede`;
        });
        throw new HttpError(409, `${client.full_name} no tiene un plan vigente para este ingreso`, 'NO_PLAN', { reasons, client: { id: client.id, fullName: client.full_name } });
      }
    }

    // ---------------------------------------------------------------- Aforo (RQ20)
    let full: string | null = null;
    if (booking) {
      const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM attendances WHERE booking_id = $1`, [booking.id]);
      const [space] = await db.query(`SELECT name, max_capacity FROM spaces WHERE id = $1`, [booking.space_id]);
      const [{ inSpace }] = await db.query(
        `SELECT count(*)::int AS "inSpace" FROM attendances at JOIN bookings ob ON ob.id = at.booking_id
          WHERE ob.space_id = $1 AND ob.status = 'confirmed' AND ob.starts_at < $3 AND ob.ends_at > $2`,
        [booking.space_id, booking.starts_at, booking.ends_at],
      );
      if (n >= booking.group_size) full = `El cupo de ${booking.title} está completo (${n}/${booking.group_size})`;
      else if (inSpace >= space.max_capacity) full = `El aforo de ${space.name} está completo (${inSpace}/${space.max_capacity})`;
    }
    const canOverride = req.user.permissions.includes('override_capacity');
    if (full && !b.override) {
      throw new HttpError(409, full, 'CAPACITY_FULL', { canOverride, client: { id: client.id, fullName: client.full_name } });
    }
    if (full && !canOverride) throw new HttpError(403, 'No tienes permiso para registrar ingresos por fuera del aforo', 'FORBIDDEN');

    const summary = {
      client: { id: client.id, fullName: client.full_name, document: client.document },
      membership: membership && {
        id: membership.id, planName: membership.plan_name, endsOn: membership.ends_on,
        remainingBefore: membership.remaining, remainingAfter: membership.remaining == null ? null : membership.remaining - 1,
      },
      paidRental: paidOwnRental,
      booking: booking && { id: booking.id, title: booking.title, startsAt: booking.starts_at },
      overCapacity: !!full,
    };
    if (b.dryRun) return res.json({ ok: true, dryRun: true, ...summary });

    const attendanceId = await db.tx(async (q) => {
      if (membership && membership.units_total != null) {
        // Descuento atomico: si otro escaneo simultaneo agoto el saldo, no se actualiza ninguna fila
        const upd = await q.query(
          `UPDATE memberships SET units_used = units_used + 1 WHERE id = $1 AND units_used < units_total RETURNING units_used`,
          [membership.id],
        );
        if (upd.length === 0) throw new HttpError(409, 'El plan se quedó sin clases disponibles', 'NO_PLAN');
      }
      const [a] = await q.query(
        `INSERT INTO attendances (tenant_id, client_id, membership_id, academy_id, site_id, booking_id, space_id, method, over_capacity, scanned_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [tenantId, client.id, membership?.id ?? null, b.academyId, site.id, booking?.id ?? null, booking?.space_id ?? null, b.qrToken ? 'qr' : 'manual', !!full, req.user.id],
      );
      return a.id;
    });
    res.status(201).json({ ok: true, attendanceId, ...summary });
  });

  r.get('/attendance', requirePerm('attendance', 'reports'), async (req, res) => {
    const q = parse(z.object({ from: dateStr.optional(), to: dateStr.optional(), academyId: optId, siteId: optId, clientId: optId, bookingId: optId }), req.query);
    const { from, to } = range(q);
    res.json(await db.query(
      `SELECT at.id, at.scanned_at, at.method, at.over_capacity, at.client_id, u.full_name AS client_name,
              a.name AS academy_name, s.name AS site_name, b.title AS booking_title, sp.name AS space_name,
              pl.name AS plan_name, st.full_name AS scanned_by_name
         FROM attendances at
         JOIN users u ON u.id = at.client_id JOIN academies a ON a.id = at.academy_id JOIN sites s ON s.id = at.site_id
         LEFT JOIN bookings b ON b.id = at.booking_id LEFT JOIN spaces sp ON sp.id = at.space_id
         LEFT JOIN memberships m ON m.id = at.membership_id LEFT JOIN plans pl ON pl.id = m.plan_id
         LEFT JOIN users st ON st.id = at.scanned_by
        WHERE at.tenant_id = $1
          AND at.scanned_at >= ($2::date::timestamp AT TIME ZONE $4) AND at.scanned_at < (($3::date + 1)::timestamp AT TIME ZONE $4)
          AND ($5::int IS NULL OR at.academy_id = $5) AND ($6::int IS NULL OR at.site_id = $6)
          AND ($7::int IS NULL OR at.client_id = $7) AND ($8::int IS NULL OR at.booking_id = $8)
        ORDER BY at.scanned_at DESC LIMIT 1000`,
      [req.user.tenantId, from, to, TZ, q.academyId ?? null, q.siteId ?? null, q.clientId ?? null, q.bookingId ?? null],
    ));
  });

  // Anula un ingreso registrado por error y devuelve la clase al plan
  r.delete('/attendance/:id', requireAdmin, async (req, res) => {
    const [a] = await db.query(`SELECT * FROM attendances WHERE id = $1 AND tenant_id = $2`, [parse(id, req.params.id), req.user.tenantId]);
    if (!a) throw new HttpError(404, 'Ingreso no encontrado', 'NOT_FOUND');
    await db.tx(async (q) => {
      if (a.membership_id) await q.query(`UPDATE memberships SET units_used = greatest(units_used - 1, 0) WHERE id = $1 AND units_total IS NOT NULL`, [a.membership_id]);
      await q.query(`DELETE FROM attendances WHERE id = $1`, [a.id]);
    });
    res.status(204).end();
  });

  return r;
}
