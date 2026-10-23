/**
 * Registro de ingresos con el QR del cliente (RQ7, RQ16, RQ20).
 *
 * Antes de escanear, el personal elige academia, sede y (opcional) la clase o reserva de ese momento. Con eso
 * se busca el plan del cliente que cubre ese lugar y ese tipo de ingreso, y se descuenta una clase de ese plan:
 * si el cliente tiene un plan en la academia A y otro en la B, cada ingreso descuenta del plan que corresponde.
 *
 * RQ37: si la clase o el espacio estan llenos y quien escanea no puede exceder el aforo, envia una solicitud de
 * autorizacion; los usuarios de la academia con ese permiso la aprueban (se registra el ingreso) o la rechazan.
 */
import { Router } from 'express';
import { z } from 'zod';
import { type AuthUser, HttpError, effectivePermissions, requireAdmin, requirePerm, verifyQr } from '../auth.ts';
import type { Db } from '../db.ts';
import { KINDS_FOR_CONTEXT, membershipsOf, pickMembership, type MembershipView } from '../lib/memberships.ts';
import { dateStr, dayBounds, id, localParts, optId, own, parse, range } from '../lib/util.ts';

/** RQ39: el ingreso se valida desde 1 hora antes del inicio */
const ENTRY_WINDOW_MS = 3600_000;


const scanBody = z.object({
  qrToken: z.string().min(10).optional(),
  clientId: optId, // registro manual (por documento) cuando el cliente no puede mostrar el QR
  academyId: id,
  siteId: id,
  bookingId: optId.nullable(),
  override: z.boolean().default(false),
  dryRun: z.boolean().default(false),
}).refine((b) => !!b.qrToken !== !!b.clientId, { message: 'Envía el QR o el cliente', path: ['qrToken'] });

type ScanInput = z.infer<typeof scanBody>;

/** Usuarios de la organizacion que pueden autorizar ingresos por fuera del aforo (RQ37) */
export async function capacityContacts(db: Db, tenantId: number) {
  const rows = await db.query(
    `SELECT id, full_name, phone, email, role, permissions FROM users WHERE tenant_id = $1 AND active = true AND role IN ('admin', 'staff') ORDER BY full_name`,
    [tenantId],
  );
  return rows
    .filter((u) => effectivePermissions(u.role, Array.isArray(u.permissions) ? u.permissions : []).includes('override_capacity'))
    .map((u) => ({ id: u.id, fullName: u.full_name, phone: u.phone, email: u.email, role: u.role }));
}

/** Registra (o simula con dryRun) el ingreso de un cliente. Lanza HttpError con el motivo si no procede */
async function performScan(db: Db, user: AuthUser, b: ScanInput) {
    const tenantId = user.tenantId;

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
      // RQ39: solo el mismo dia, desde 1 hora antes del inicio hasta la hora de finalizacion
      const now = new Date();
      const start = new Date(booking.starts_at);
      const end = new Date(booking.ends_at);
      const sameDay = localParts(now).date === localParts(start).date;
      if (!sameDay || now.getTime() < start.getTime() - ENTRY_WINDOW_MS || now > end) {
        const hm = (d: Date) => localParts(d).time;
        throw new HttpError(409,
          `El ingreso a ${booking.title} solo se valida el ${localParts(start).date} de ${hm(new Date(start.getTime() - ENTRY_WINDOW_MS))} a ${hm(end)}`,
          'OUT_OF_TIME');
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
      const picked = pickMembership(all, KINDS_FOR_CONTEXT[context], b.academyId, site.id);
      membership = picked.membership;
      if (!membership) {
        throw new HttpError(409, `${client.full_name} no tiene un plan vigente para este ingreso`, 'NO_PLAN', { reasons: picked.reasons, client: { id: client.id, fullName: client.full_name } });
      }
    }

    // ---------------------------------------------------------------- Aforo (RQ20)
    let full: string | null = null;
    if (booking) {
      const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM attendances WHERE booking_id = $1`, [booking.id]);
      const [space] = await db.query(`SELECT name, max_capacity FROM spaces WHERE id = $1`, [booking.space_id]);
      const [{ inSpace }] = await db.query(
        `SELECT count(*)::int AS "inSpace" FROM attendances att JOIN bookings ob ON ob.id = att.booking_id
          WHERE ob.space_id = $1 AND ob.status = 'confirmed' AND ob.starts_at < $3 AND ob.ends_at > $2`,
        [booking.space_id, booking.starts_at, booking.ends_at],
      );
      if (n >= booking.group_size) full = `El cupo de ${booking.title} está completo (${n}/${booking.group_size})`;
      else if (inSpace >= space.max_capacity) full = `El aforo de ${space.name} está completo (${inSpace}/${space.max_capacity})`;
    }
    const canOverride = user.permissions.includes('override_capacity');
    if (full && !b.override) {
      const contacts = canOverride ? [] : await capacityContacts(db, tenantId);
      throw new HttpError(409, full, 'CAPACITY_FULL', { canOverride, contacts, client: { id: client.id, fullName: client.full_name } });
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
    if (b.dryRun) return { ok: true, dryRun: true, attendanceId: null as number | null, ...summary };

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
        [tenantId, client.id, membership?.id ?? null, b.academyId, site.id, booking?.id ?? null, booking?.space_id ?? null, b.qrToken ? 'qr' : 'manual', !!full, user.id],
      );
      return a.id as number;
    });
    return { ok: true, dryRun: false, attendanceId: attendanceId as number | null, ...summary };
}

const REQUEST_SELECT = `
  SELECT cq.id, cq.status, cq.created_at, cq.resolved_at, cq.client_id, cq.booking_id, cq.academy_id, cq.site_id,
         u.full_name AS client_name, b.title AS booking_title, b.starts_at, b.group_size, s.name AS site_name,
         rq.full_name AS requested_by_name, rs.full_name AS resolved_by_name,
         (SELECT count(*) FROM attendances att WHERE att.booking_id = cq.booking_id) AS attendees
    FROM capacity_requests cq
    JOIN users u ON u.id = cq.client_id JOIN sites s ON s.id = cq.site_id
    LEFT JOIN bookings b ON b.id = cq.booking_id
    LEFT JOIN users rq ON rq.id = cq.requested_by LEFT JOIN users rs ON rs.id = cq.resolved_by`;

export function attendanceRoutes(db: Db) {
  const r = Router();

  r.post('/attendance/scan', requirePerm('attendance'), async (req, res) => {
    const body = parse(scanBody, req.body);
    // Registro de cada intento en la consola del servidor para diagnosticar lecturas (sin el token del QR)
    const tag = `[ingreso] ${new Date().toISOString()} por=${req.user.username} via=${body.qrToken ? 'qr' : 'manual'} sede=${body.siteId} clase=${body.bookingId ?? 'general'}`;
    try {
      const out = await performScan(db, req.user, body);
      console.info(`${tag} cliente=${out.client.id} -> ${out.dryRun ? 'simulado' : `registrado #${out.attendanceId}`}`);
      res.status(out.dryRun ? 200 : 201).json(out);
    } catch (e) {
      console.info(`${tag} -> rechazado ${e instanceof HttpError ? `${e.code ?? e.status}: ${e.message}` : 'error interno'}`);
      throw e;
    }
  });

  // ------------------------------------------------------------------ Autorizaciones de aforo (RQ37)
  r.get('/capacity-contacts', requirePerm('attendance', 'bookings', 'classes'), async (req, res) => {
    res.json(await capacityContacts(db, req.user.tenantId));
  });

  // Quien escanea sin permiso pide autorizacion para un ingreso con aforo completo
  r.post('/attendance/requests', requirePerm('attendance'), async (req, res) => {
    const b = parse(z.object({ clientId: id, academyId: id, siteId: id, bookingId: id }), req.body);
    const t = req.user.tenantId;
    const client = await own(db, 'users', b.clientId, t, 'Cliente');
    const booking = await own(db, 'bookings', b.bookingId, t, 'Clase o reserva');
    const site = await own(db, 'sites', b.siteId, t, 'Sede');
    if (client.role !== 'client' || booking.site_id !== site.id || site.academy_id !== b.academyId) throw new HttpError(400, 'Datos de la solicitud inválidos');
    const [pending] = await db.query(`SELECT id FROM capacity_requests WHERE client_id = $1 AND booking_id = $2 AND status = 'pending'`, [client.id, booking.id]);
    const requestId = pending?.id ?? (await db.query(
      `INSERT INTO capacity_requests (tenant_id, client_id, booking_id, academy_id, site_id, requested_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [t, client.id, booking.id, b.academyId, site.id, req.user.id],
    ))[0].id;
    const [row] = await db.query(`${REQUEST_SELECT} WHERE cq.id = $1`, [requestId]);
    res.status(201).json({ ...row, attendees: Number(row.attendees), contacts: await capacityContacts(db, t) });
  });

  r.get('/attendance/requests', requirePerm('attendance', 'override_capacity'), async (req, res) => {
    const status = parse(z.enum(['pending', 'approved', 'rejected', 'all']).default('pending'), req.query.status);
    const rows = await db.query(
      `${REQUEST_SELECT} WHERE cq.tenant_id = $1 AND ($2 = 'all' OR cq.status = $2) ORDER BY cq.created_at DESC LIMIT 200`,
      [req.user.tenantId, status],
    );
    res.json(rows.map((x) => ({ ...x, attendees: Number(x.attendees) })));
  });

  // Aprobar = registrar el ingreso por fuera del aforo a nombre de quien autoriza
  r.post('/attendance/requests/:id/approve', requirePerm('override_capacity'), async (req, res) => {
    const [cq] = await db.query(`SELECT * FROM capacity_requests WHERE id = $1 AND tenant_id = $2`, [parse(id, req.params.id), req.user.tenantId]);
    if (!cq) throw new HttpError(404, 'Solicitud no encontrada', 'NOT_FOUND');
    if (cq.status !== 'pending') throw new HttpError(409, 'La solicitud ya fue atendida', 'ALREADY_RESOLVED');
    const out = await performScan(db, req.user, { clientId: cq.client_id, academyId: cq.academy_id, siteId: cq.site_id, bookingId: cq.booking_id, override: true, dryRun: false });
    await db.query(
      `UPDATE capacity_requests SET status = 'approved', resolved_by = $2, resolved_at = $3, attendance_id = $4 WHERE id = $1`,
      [cq.id, req.user.id, new Date(), out.attendanceId ?? null],
    );
    res.json(out);
  });

  r.post('/attendance/requests/:id/reject', requirePerm('override_capacity'), async (req, res) => {
    const [cq] = await db.query(`SELECT id, status FROM capacity_requests WHERE id = $1 AND tenant_id = $2`, [parse(id, req.params.id), req.user.tenantId]);
    if (!cq) throw new HttpError(404, 'Solicitud no encontrada', 'NOT_FOUND');
    if (cq.status !== 'pending') throw new HttpError(409, 'La solicitud ya fue atendida', 'ALREADY_RESOLVED');
    await db.query(`UPDATE capacity_requests SET status = 'rejected', resolved_by = $2, resolved_at = $3 WHERE id = $1`, [cq.id, req.user.id, new Date()]);
    res.json({ ok: true });
  });

  r.get('/attendance', requirePerm('attendance', 'reports'), async (req, res) => {
    const q = parse(z.object({ from: dateStr.optional(), to: dateStr.optional(), academyId: optId, siteId: optId, clientId: optId, bookingId: optId }), req.query);
    const { from, to } = range(q);
    const [start, end] = dayBounds(from, to);
    res.json(await db.query(
      `SELECT att.id, att.scanned_at, att.method, att.over_capacity, att.client_id, u.full_name AS client_name,
              a.name AS academy_name, s.name AS site_name, b.title AS booking_title, sp.name AS space_name,
              pl.name AS plan_name, st.full_name AS scanned_by_name
         FROM attendances att
         JOIN users u ON u.id = att.client_id JOIN academies a ON a.id = att.academy_id JOIN sites s ON s.id = att.site_id
         LEFT JOIN bookings b ON b.id = att.booking_id LEFT JOIN spaces sp ON sp.id = att.space_id
         LEFT JOIN memberships m ON m.id = att.membership_id LEFT JOIN plans pl ON pl.id = m.plan_id
         LEFT JOIN users st ON st.id = att.scanned_by
        WHERE att.tenant_id = $1
          AND att.scanned_at >= $2 AND att.scanned_at < $3
          AND ($4::int IS NULL OR att.academy_id = $4) AND ($5::int IS NULL OR att.site_id = $5)
          AND ($6::int IS NULL OR att.client_id = $6) AND ($7::int IS NULL OR att.booking_id = $7)
        ORDER BY att.scanned_at DESC LIMIT 1000`,
      [req.user.tenantId, start, end, q.academyId ?? null, q.siteId ?? null, q.clientId ?? null, q.bookingId ?? null],
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
