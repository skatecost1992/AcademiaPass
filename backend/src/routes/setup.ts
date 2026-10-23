/**
 * Parametrizacion: academias (RQ12), sedes y horarios de atencion (RQ2, RQ10), espacios y aforo (RQ19),
 * fotos en Base64 (RQ29), profesores internos/externos (RQ3, RQ5) y clases.
 *
 * Las lecturas estan disponibles para todo usuario de la organizacion; un cliente solo ve las academias a las
 * que esta asociado.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { HttpError, requireAdmin, requirePerm } from '../auth.ts';
import type { Db } from '../db.ts';
import { deleteAcademy, deleteSites, deleteSpaces } from '../lib/cleanup.ts';
import { id, idList, joinCode, optId, optText, own, parse, text, timeStr } from '../lib/util.ts';

/** Academias visibles para el usuario: todas las de su organizacion o, si es cliente, las suyas */
export async function visibleAcademyIds(db: Db, req: Request): Promise<number[]> {
  const rows = req.user.role === 'client'
    ? await db.query(`SELECT academy_id AS id FROM client_academies WHERE client_id = $1`, [req.user.id])
    : await db.query(`SELECT id FROM academies WHERE tenant_id = $1`, [req.user.tenantId]);
  return rows.map((r) => r.id);
}

const openingHours = z.array(z.object({ day: z.number().int().min(0).max(6), open: timeStr, close: timeStr }).refine((h) => h.open < h.close, 'La hora de apertura debe ser menor que la de cierre')).max(30);

const spaceBody = z.object({
  siteId: id,
  name: text(120),
  description: optText(),
  maxCapacity: z.coerce.number().int().positive(),
  allowMultiGroup: z.boolean().default(false),
  maxGroups: z.coerce.number().int().positive().default(1),
  capacityPerGroup: z.coerce.number().int().positive().optional().nullable(),
  active: z.boolean().default(true),
  openingHours: openingHours.nullable().optional(), // RQ40: null = usa el horario de la sede
}).refine((s) => !s.allowMultiGroup || (s.capacityPerGroup ?? 0) <= s.maxCapacity, { message: 'El cupo por grupo no puede superar el aforo', path: ['capacityPerGroup'] });

// Una foto ya comprimida en el telefono (~1600 px, JPEG 0.8) pesa 200-600 KB; el limite deja margen
const MAX_PHOTO_BYTES = 2_500_000;
const MAX_PHOTOS_PER_OWNER = 10;

export function setupRoutes(db: Db) {
  const r = Router();
  const settings = requirePerm('schedules');

  // ------------------------------------------------------------------ Academias
  r.get('/academies', async (req, res) => {
    const ids = await visibleAcademyIds(db, req);
    const rows = await db.query(
      `SELECT a.id, a.name, a.description, a.active, ${req.user.role === 'client' ? 'NULL' : 'a.join_code'} AS join_code,
              (SELECT count(*)::int FROM sites s WHERE s.academy_id = a.id) AS sites
         FROM academies a WHERE a.id IN ${idList(ids)} ORDER BY a.name`,
    );
    res.json(rows);
  });

  r.post('/academies', requireAdmin, async (req, res) => {
    const b = parse(z.object({ name: text(120), description: optText() }), req.body);
    const [a] = await db.query(`INSERT INTO academies (tenant_id, name, description, join_code) VALUES ($1, $2, $3, $4) RETURNING *`, [req.user.tenantId, b.name, b.description, joinCode()]);
    res.status(201).json(a);
  });

  r.put('/academies/:id', requireAdmin, async (req, res) => {
    const a = await own(db, 'academies', parse(id, req.params.id), req.user.tenantId, 'Academia');
    const b = parse(z.object({ name: text(120), description: optText(), active: z.boolean().default(true), regenerateCode: z.boolean().optional() }), req.body);
    const [row] = await db.query(`UPDATE academies SET name = $2, description = $3, active = $4, join_code = $5 WHERE id = $1 RETURNING *`, [a.id, b.name, b.description, b.active, b.regenerateCode ? joinCode() : a.join_code]);
    res.json(row);
  });

  r.delete('/academies/:id', requireAdmin, async (req, res) => {
    const a = await own(db, 'academies', parse(id, req.params.id), req.user.tenantId, 'Academia');
    const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM attendances WHERE academy_id = $1`, [a.id]);
    if (n > 0) throw new HttpError(409, 'La academia tiene asistencias registradas: desactívala en lugar de borrarla', 'IN_USE');
    await db.tx((q) => deleteAcademy(q, req.user.tenantId, a.id));
    res.status(204).end();
  });

  // ------------------------------------------------------------------ Sedes
  r.get('/sites', async (req, res) => {
    const academyId = parse(optId, req.query.academyId);
    const ids = await visibleAcademyIds(db, req);
    const rows = await db.query(
      `SELECT s.*, a.name AS academy_name,
              (SELECT count(*)::int FROM photos p WHERE p.owner_type = 'site' AND p.owner_id = s.id) AS photos
         FROM sites s JOIN academies a ON a.id = s.academy_id
        WHERE s.academy_id IN ${idList(ids)} AND ($1::int IS NULL OR s.academy_id = $1)
        ORDER BY a.name, s.name`,
      [academyId ?? null],
    );
    res.json(rows);
  });

  const siteBody = z.object({ academyId: id, name: text(120), address: optText(), phone: optText(30), openingHours: openingHours.default([]), active: z.boolean().default(true) });

  r.post('/sites', settings, async (req, res) => {
    const b = parse(siteBody, req.body);
    await own(db, 'academies', b.academyId, req.user.tenantId, 'Academia');
    const [s] = await db.query(
      `INSERT INTO sites (tenant_id, academy_id, name, address, phone, opening_hours, active) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.user.tenantId, b.academyId, b.name, b.address, b.phone, JSON.stringify(b.openingHours), b.active],
    );
    res.status(201).json(s);
  });

  r.put('/sites/:id', settings, async (req, res) => {
    const s = await own(db, 'sites', parse(id, req.params.id), req.user.tenantId, 'Sede');
    const b = parse(siteBody, req.body);
    await own(db, 'academies', b.academyId, req.user.tenantId, 'Academia');
    const [row] = await db.query(
      `UPDATE sites SET academy_id = $2, name = $3, address = $4, phone = $5, opening_hours = $6, active = $7 WHERE id = $1 RETURNING *`,
      [s.id, b.academyId, b.name, b.address, b.phone, JSON.stringify(b.openingHours), b.active],
    );
    res.json(row);
  });

  r.delete('/sites/:id', settings, async (req, res) => {
    const s = await own(db, 'sites', parse(id, req.params.id), req.user.tenantId, 'Sede');
    const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM attendances WHERE site_id = $1`, [s.id]);
    if (n > 0) throw new HttpError(409, 'La sede tiene asistencias registradas: desactívala en lugar de borrarla', 'IN_USE');
    await db.tx((q) => deleteSites(q, req.user.tenantId, [s.id]));
    res.status(204).end();
  });

  // ------------------------------------------------------------------ Espacios
  r.get('/spaces', async (req, res) => {
    const siteId = parse(optId, req.query.siteId);
    const ids = await visibleAcademyIds(db, req);
    const rows = await db.query(
      `SELECT sp.*, s.name AS site_name, s.academy_id,
              (SELECT count(*)::int FROM photos p WHERE p.owner_type = 'space' AND p.owner_id = sp.id) AS photos
         FROM spaces sp JOIN sites s ON s.id = sp.site_id
        WHERE s.academy_id IN ${idList(ids)} AND ($1::int IS NULL OR sp.site_id = $1)
        ORDER BY s.name, sp.name`,
      [siteId ?? null],
    );
    res.json(rows);
  });

  const saveSpace = async (req: Request, existingId?: number) => {
    const b = parse(spaceBody, req.body);
    const site = await own(db, 'sites', b.siteId, req.user.tenantId, 'Sede');
    // RQ40: el horario del espacio debe caber dentro del horario de atencion de la sede
    const siteHours: { day: number; open: string; close: string }[] = typeof site.opening_hours === 'string' ? JSON.parse(site.opening_hours) : site.opening_hours ?? [];
    const spaceHours = b.openingHours && b.openingHours.length ? b.openingHours : null;
    for (const h of spaceHours ?? []) {
      if (!siteHours.some((x) => x.day === h.day && x.open <= h.open && h.close <= x.close)) {
        throw new HttpError(400, `El horario del espacio (${['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][h.day]} ${h.open}-${h.close}) debe estar dentro del horario de atención de la sede`, 'SPACE_HOURS');
      }
    }
    const params = [b.siteId, b.name, b.description, b.maxCapacity, b.allowMultiGroup, b.allowMultiGroup ? b.maxGroups : 1, b.allowMultiGroup ? b.capacityPerGroup ?? null : null, b.active, spaceHours ? JSON.stringify(spaceHours) : null];
    if (existingId) {
      const [row] = await db.query(
        `UPDATE spaces SET site_id = $2, name = $3, description = $4, max_capacity = $5, allow_multi_group = $6, max_groups = $7, capacity_per_group = $8, active = $9, opening_hours = $10 WHERE id = $1 RETURNING *`,
        [existingId, ...params],
      );
      return row;
    }
    const [row] = await db.query(
      `INSERT INTO spaces (tenant_id, site_id, name, description, max_capacity, allow_multi_group, max_groups, capacity_per_group, active, opening_hours) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [req.user.tenantId, ...params],
    );
    return row;
  };

  r.post('/spaces', settings, async (req, res) => {
    res.status(201).json(await saveSpace(req));
  });

  r.put('/spaces/:id', settings, async (req, res) => {
    const sp = await own(db, 'spaces', parse(id, req.params.id), req.user.tenantId, 'Espacio');
    res.json(await saveSpace(req, sp.id));
  });

  r.delete('/spaces/:id', settings, async (req, res) => {
    const sp = await own(db, 'spaces', parse(id, req.params.id), req.user.tenantId, 'Espacio');
    await db.tx((q) => deleteSpaces(q, req.user.tenantId, [sp.id]));
    res.status(204).end();
  });

  // ------------------------------------------------------------------ Fotos (RQ29)
  const ownerQuery = z.object({ ownerType: z.enum(['site', 'space']), ownerId: id });
  const assertOwner = (type: 'site' | 'space', ownerId: number, tenantId: number) =>
    own(db, type === 'site' ? 'sites' : 'spaces', ownerId, tenantId, type === 'site' ? 'Sede' : 'Espacio');

  // Solo metadatos: la imagen se descarga aparte con GET /photos/:id
  r.get('/photos', async (req, res) => {
    const q = parse(ownerQuery, req.query);
    await assertOwner(q.ownerType, q.ownerId, req.user.tenantId);
    res.json(await db.query(
      `SELECT id, owner_type, owner_id, mime, width, height, size_bytes, created_at FROM photos WHERE tenant_id = $1 AND owner_type = $2 AND owner_id = $3 ORDER BY id`,
      [req.user.tenantId, q.ownerType, q.ownerId],
    ));
  });

  r.get('/photos/:id', async (req, res) => {
    const [p] = await db.query(`SELECT id, mime, data, width, height FROM photos WHERE id = $1 AND tenant_id = $2`, [parse(id, req.params.id), req.user.tenantId]);
    if (!p) throw new HttpError(404, 'Foto no encontrada', 'NOT_FOUND');
    res.set('Cache-Control', 'private, max-age=86400'); // una foto nunca cambia: se reemplaza por otra
    res.json(p);
  });

  r.post('/photos', settings, async (req, res) => {
    const b = parse(ownerQuery.extend({
      mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
      data: z.string().regex(/^[A-Za-z0-9+/]+=*$/, 'La foto debe venir en Base64 (sin encabezado data:)'),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
    }), req.body);
    await assertOwner(b.ownerType, b.ownerId, req.user.tenantId);
    const size = Math.floor((b.data.length * 3) / 4) - (b.data.endsWith('==') ? 2 : b.data.endsWith('=') ? 1 : 0);
    if (size > MAX_PHOTO_BYTES) throw new HttpError(413, 'La foto pesa más de 2,5 MB. Comprímela antes de subirla.', 'PHOTO_TOO_BIG');
    const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM photos WHERE tenant_id = $1 AND owner_type = $2 AND owner_id = $3`, [req.user.tenantId, b.ownerType, b.ownerId]);
    if (n >= MAX_PHOTOS_PER_OWNER) throw new HttpError(409, `Máximo ${MAX_PHOTOS_PER_OWNER} fotos por ${b.ownerType === 'site' ? 'sede' : 'espacio'}`, 'TOO_MANY_PHOTOS');
    const [p] = await db.query(
      `INSERT INTO photos (tenant_id, owner_type, owner_id, mime, data, width, height, size_bytes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, owner_type, owner_id, mime, width, height, size_bytes, created_at`,
      [req.user.tenantId, b.ownerType, b.ownerId, b.mime, b.data, b.width ?? null, b.height ?? null, size],
    );
    res.status(201).json(p);
  });

  r.delete('/photos/:id', settings, async (req, res) => {
    const p = await own(db, 'photos', parse(id, req.params.id), req.user.tenantId, 'Foto');
    await db.query(`DELETE FROM photos WHERE id = $1`, [p.id]);
    res.status(204).end();
  });

  // ------------------------------------------------------------------ Profesores
  const classesPerm = requirePerm('classes');
  const teacherBody = z.object({ fullName: text(120), kind: z.enum(['internal', 'external']), phone: optText(30), email: optText(120), specialty: optText(120), active: z.boolean().default(true) });

  r.get('/teachers', classesPerm, async (req, res) => {
    res.json(await db.query(`SELECT * FROM teachers WHERE tenant_id = $1 ORDER BY active DESC, full_name`, [req.user.tenantId]));
  });

  r.post('/teachers', classesPerm, async (req, res) => {
    const b = parse(teacherBody, req.body);
    const [t] = await db.query(
      `INSERT INTO teachers (tenant_id, full_name, kind, phone, email, specialty, active) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.user.tenantId, b.fullName, b.kind, b.phone, b.email, b.specialty, b.active],
    );
    res.status(201).json(t);
  });

  r.put('/teachers/:id', classesPerm, async (req, res) => {
    const t = await own(db, 'teachers', parse(id, req.params.id), req.user.tenantId, 'Profesor');
    const b = parse(teacherBody, req.body);
    const [row] = await db.query(
      `UPDATE teachers SET full_name = $2, kind = $3, phone = $4, email = $5, specialty = $6, active = $7 WHERE id = $1 RETURNING *`,
      [t.id, b.fullName, b.kind, b.phone, b.email, b.specialty, b.active],
    );
    res.json(row);
  });

  // ------------------------------------------------------------------ Clases
  const classBody = z.object({ academyId: id, teacherId: optId.nullable(), name: text(120), description: optText(), defaultCapacity: z.coerce.number().int().positive(), active: z.boolean().default(true) });

  r.get('/classes', async (req, res) => {
    const ids = await visibleAcademyIds(db, req);
    res.json(await db.query(
      `SELECT c.*, a.name AS academy_name, t.full_name AS teacher_name, t.kind AS teacher_kind
         FROM classes c JOIN academies a ON a.id = c.academy_id LEFT JOIN teachers t ON t.id = c.teacher_id
        WHERE c.academy_id IN ${idList(ids)} ORDER BY c.active DESC, a.name, c.name`,
    ));
  });

  const checkClassRefs = async (req: Request, b: z.infer<typeof classBody>) => {
    await own(db, 'academies', b.academyId, req.user.tenantId, 'Academia');
    if (b.teacherId) await own(db, 'teachers', b.teacherId, req.user.tenantId, 'Profesor');
  };

  r.post('/classes', classesPerm, async (req, res) => {
    const b = parse(classBody, req.body);
    await checkClassRefs(req, b);
    const [c] = await db.query(
      `INSERT INTO classes (tenant_id, academy_id, teacher_id, name, description, default_capacity, active) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.user.tenantId, b.academyId, b.teacherId ?? null, b.name, b.description, b.defaultCapacity, b.active],
    );
    res.status(201).json(c);
  });

  r.put('/classes/:id', classesPerm, async (req, res) => {
    const c = await own(db, 'classes', parse(id, req.params.id), req.user.tenantId, 'Clase');
    const b = parse(classBody, req.body);
    await checkClassRefs(req, b);
    const [row] = await db.query(
      `UPDATE classes SET academy_id = $2, teacher_id = $3, name = $4, description = $5, default_capacity = $6, active = $7 WHERE id = $1 RETURNING *`,
      [c.id, b.academyId, b.teacherId ?? null, b.name, b.description, b.defaultCapacity, b.active],
    );
    res.json(row);
  });

  return r;
}
