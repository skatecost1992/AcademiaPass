/**
 * Prueba de punta a punta de la API con PGlite en memoria: recorre los requisitos principales.
 * Ejecutar: npm test
 */
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

process.env.PGLITE_DIR = 'memory://';
process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_INITIAL_PASSWORD = 'Bogota.2027'; // clave del usuario base en las pruebas
// Zona horaria de la prueba: se elige para que la hora local sea cerca del mediodia, asi los horarios de las sedes
// (05:00-23:00) y las ventanas de "hoy" no dependen de la hora a la que se corran las pruebas
const OFFSET_H = (() => { const o = 12 - new Date().getUTCHours(); return o > 14 ? o - 24 : o < -12 ? o + 24 : o; })();
process.env.APP_TIMEZONE = `Etc/GMT${OFFSET_H <= 0 ? '+' : '-'}${Math.abs(OFFSET_H)}`; // Etc/GMT+5 = UTC-5
const OFFSET_MS = OFFSET_H * 3600_000;
const OFFSET_ISO = `${OFFSET_H < 0 ? '-' : '+'}${String(Math.abs(OFFSET_H)).padStart(2, '0')}:00`;
const { createApp } = await import('../src/app.ts');
const { openDb } = await import('../src/db.ts');
const { ensureAdmin } = await import('../src/bootstrap.ts');
const { describePg } = await import('../src/db.ts');
const { settleMissedReservations } = await import('../src/lib/scheduling.ts');
const { sendReminders, sendPlanNotices } = await import('../src/lib/notifications.ts');
const { setMailSender, sendMail } = await import('../src/lib/mailer.ts');

let base = '';
let close = () => {};
let database: Awaited<ReturnType<typeof openDb>>;

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const ok = async (method: string, path: string, body?: unknown, token?: string) => {
  const r = await call(method, path, body, token);
  assert.ok(r.status < 300, `${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

/** RQ58: registra la organizacion, la activa el administrador general (usuario base) e inicia sesion */
async function registerAdmin(body: Record<string, unknown>) {
  const reg = await ok('POST', '/auth/register-admin', body);
  assert.equal(reg.pending, true);
  const root = (await ok('POST', '/auth/login', { username: 'admin', password: 'Bogota.2027' })).token;
  const pending = await ok('GET', '/platform/tenants', undefined, root);
  const tenant = pending.find((t: any) => t.name === body.organization);
  await ok('POST', `/platform/tenants/${tenant.id}/approve`, {}, root);
  return ok('POST', '/auth/login', { username: body.username, password: body.password });
}

/** Fecha ISO de hoy a la hora local indicada (zona de la prueba) */
const todayAt = (h: number, m = 0) => {
  const local = new Date(Date.now() + OFFSET_MS).toISOString().slice(0, 10);
  return new Date(`${local}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00${OFFSET_ISO}`).toISOString();
};

before(async () => {
  const db = await openDb();
  database = db;
  const server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  close = () => { server.close(); db.close(); };
});
after(() => close());

describe('AcademiaPass API', () => {
  const s: Record<string, any> = {};

  it('informa el motor y la ubicacion de la base sin credenciales', async () => {
    const h = await ok('GET', '/health');
    assert.equal(h.database.engine, process.env.DB_CLIENT === 'mssql' ? 'SQL Server' : 'PostgreSQL');
    assert.ok(!JSON.stringify(h.database).toLowerCase().includes('password'));
    const neon = describePg('postgresql://dueno:clave-secreta@ep-demo-pooler.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require');
    assert.deepEqual(neon, { engine: 'PostgreSQL', provider: 'Neon', host: 'ep-demo-pooler.c-6.us-east-2.aws.neon.tech', database: 'neondb' });
    assert.ok(!JSON.stringify(neon).includes('clave-secreta') && !JSON.stringify(neon).includes('dueno'));
  });

  it('crea el usuario admin en la tabla users con clave cifrada y no lo duplica', async () => {
    assert.equal(await ensureAdmin(database), true);
    assert.equal(await ensureAdmin(database), false);
    const [row] = await database.query(`SELECT password_hash, role FROM users WHERE username = 'admin'`);
    assert.equal(row.role, 'admin');
    assert.ok(row.password_hash.startsWith('$2') && !row.password_hash.includes('Bogota'), 'solo se guarda el hash');
    const r = await ok('POST', '/auth/login', { username: 'admin', password: 'Bogota.2027' });
    assert.equal(r.user.role, 'admin');
    assert.equal((await call('POST', '/auth/login', { username: 'admin', password: 'otra' })).status, 401);
  });

  it('una organizacion nueva queda pendiente hasta que el administrador general la activa (RQ58)', async () => {
    const reg = await ok('POST', '/auth/register-admin', { username: 'pendiente', password: 'Clave.12345', fullName: 'P', document: '6060', organization: 'Org Pendiente', academyName: 'Acad P', consent: true });
    assert.equal(reg.pending, true);
    assert.equal(reg.token, undefined);
    assert.equal((await call('POST', '/auth/login', { username: 'pendiente', password: 'Clave.12345' })).body.code, 'TENANT_PENDING');
    const root = (await ok('POST', '/auth/login', { username: 'admin', password: 'Bogota.2027' })).token;
    assert.equal((await ok('GET', '/me', undefined, root)).isSuperadmin, true);
    const list = await ok('GET', '/platform/tenants', undefined, root);
    const t = list.find((x: any) => x.name === 'Org Pendiente');
    assert.equal(t.admin.username, 'pendiente');
    await ok('POST', `/platform/tenants/${t.id}/reject`, {}, root);
    assert.equal((await call('POST', '/auth/login', { username: 'pendiente', password: 'Clave.12345' })).body.code, 'TENANT_REJECTED');
    await ok('POST', `/platform/tenants/${t.id}/approve`, {}, root);
    const ok2 = await ok('POST', '/auth/login', { username: 'pendiente', password: 'Clave.12345' });
    assert.equal((await call('GET', '/platform/tenants', undefined, ok2.token)).status, 403, 'solo el administrador general');
  });

  it('registra un administrador con su organizacion, academia y sede (RQ23)', async () => {
    const r = await registerAdmin({
      username: 'admin.uno', password: 'Clave.12345', fullName: 'Ana Admin', document: '1001',
      organization: 'Org Uno', academyName: 'Danza Uno', consent: true,
    });
    s.admin = r.token;
    s.academyA = r.user.academies[0];
    assert.equal(r.user.role, 'admin');
    assert.equal(r.user.consentRequired, false);
    const sites = await ok('GET', '/sites', undefined, s.admin);
    s.siteA1 = sites[0];
  });

  it('exige el consentimiento de datos al registrarse (RQ14)', async () => {
    const r = await call('POST', '/auth/register-admin', { username: 'otro.admin', password: 'Clave.12345', fullName: 'X', document: '9', organization: 'O', academyName: 'A', consent: false });
    assert.equal(r.status, 400);
  });

  it('crea otra academia, sedes con horario, espacios con aforo y fotos en Base64 (RQ2, RQ10, RQ12, RQ19, RQ29)', async () => {
    s.academyB = await ok('POST', '/academies', { name: 'Yoga Dos' }, s.admin);
    const allDays = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '05:00', close: '23:00' }));
    s.siteA1 = await ok('PUT', `/sites/${s.siteA1.id}`, { academyId: s.academyA.id, name: 'Norte', openingHours: allDays }, s.admin);
    s.siteA2 = await ok('POST', '/sites', { academyId: s.academyA.id, name: 'Sur', openingHours: allDays }, s.admin);
    s.siteB1 = await ok('POST', '/sites', { academyId: s.academyB.id, name: 'Centro', openingHours: allDays }, s.admin);
    s.salon = await ok('POST', '/spaces', { siteId: s.siteA1.id, name: 'Salón 1', maxCapacity: 3 }, s.admin);
    s.cancha = await ok('POST', '/spaces', { siteId: s.siteA1.id, name: 'Cancha', maxCapacity: 20, allowMultiGroup: true, maxGroups: 2, capacityPerGroup: 10 }, s.admin);
    s.yogaRoom = await ok('POST', '/spaces', { siteId: s.siteB1.id, name: 'Sala Yoga', maxCapacity: 10 }, s.admin);

    const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const photo = await ok('POST', '/photos', { ownerType: 'space', ownerId: s.salon.id, mime: 'image/png', data: pixel, width: 1, height: 1 }, s.admin);
    const list = await ok('GET', `/photos?ownerType=space&ownerId=${s.salon.id}`, undefined, s.admin);
    assert.equal(list.length, 1);
    assert.equal(list[0].data, undefined, 'la lista no trae la imagen');
    const full = await ok('GET', `/photos/${photo.id}`, undefined, s.admin);
    assert.equal(full.data, pixel);
    const bad = await call('POST', '/photos', { ownerType: 'space', ownerId: s.salon.id, mime: 'image/png', data: 'data:image/png;base64,xx' }, s.admin);
    assert.equal(bad.status, 400);
  });

  it('valida horario de atencion y espacios ocupados (RQ18, RQ19)', async () => {
    // RQ62: profesor sin sede no se crea
    assert.equal((await call('POST', '/teachers', { fullName: 'Sin sede', kind: 'internal', siteIds: [] }, s.admin)).status, 400);
    s.teacherIn = await ok('POST', '/teachers', { fullName: 'Pedro Interno', kind: 'internal', siteIds: [s.siteA1.id] }, s.admin);
    s.teacherExt = await ok('POST', '/teachers', { fullName: 'Laura Externa', kind: 'external', siteIds: [s.siteA1.id] }, s.admin);
    assert.equal(s.teacherIn.sites[0].name, 'Norte');
    // RQ61: la clase exige profesor y espacio de una sede de su academia, con el profesor asignado a esa sede
    assert.equal((await call('POST', '/classes', { academyId: s.academyA.id, name: 'Sin profe', defaultCapacity: 2, spaceId: s.salon.id }, s.admin)).status, 400);
    assert.equal((await call('POST', '/classes', { academyId: s.academyA.id, teacherId: s.teacherIn.id, name: 'Otra academia', defaultCapacity: 2, spaceId: s.yogaRoom.id }, s.admin)).body.code, 'SPACE_ACADEMY');
    assert.equal((await call('POST', '/classes', { academyId: s.academyA.id, teacherId: s.teacherIn.id, name: 'Muy grande', defaultCapacity: 50, spaceId: s.salon.id }, s.admin)).body.code, 'CAPACITY_EXCEEDED');
    s.salsa = await ok('POST', '/classes', { academyId: s.academyA.id, teacherId: s.teacherIn.id, spaceId: s.salon.id, name: 'Salsa', defaultCapacity: 2 }, s.admin);

    const out = await call('POST', '/bookings', { spaceId: s.salon.id, kind: 'class', classId: s.salsa.id, startsAt: todayAt(23, 0), endsAt: todayAt(23, 59) }, s.admin);
    assert.equal(out.body.code, 'OUT_OF_HOURS');

    // La sesion empieza en el pasado cercano para poder registrar ingresos ya
    const [session] = await ok('POST', '/bookings', { spaceId: s.salon.id, kind: 'class', classId: s.salsa.id, startsAt: new Date(Date.now() - 600_000).toISOString(), endsAt: new Date(Date.now() + 3000_000).toISOString() }, s.admin);
    s.session = session;
    assert.equal(session.group_size, 2);
    assert.equal(session.teacher_name, 'Pedro Interno');

    const taken = await call('POST', '/bookings', { spaceId: s.salon.id, kind: 'rental', teacherId: s.teacherExt.id, title: 'Clase externa', startsAt: new Date(Date.now()).toISOString(), endsAt: new Date(Date.now() + 1800_000).toISOString() }, s.admin);
    assert.equal(taken.status, 409);
    assert.equal(taken.body.code, 'SPACE_TAKEN');

    // Cancha multigrupo: 2 grupos de hasta 10
    const t0 = todayAt(10), t1 = todayAt(11);
    await ok('POST', '/bookings', { spaceId: s.cancha.id, kind: 'rental', teacherId: s.teacherExt.id, title: 'Fútbol externo', startsAt: t0, endsAt: t1, groupSize: 10 }, s.admin);
    const tooBig = await call('POST', '/bookings', { spaceId: s.cancha.id, kind: 'rental', title: 'G', startsAt: t0, endsAt: t1, groupSize: 11 }, s.admin);
    assert.equal(tooBig.body.code, 'GROUP_TOO_BIG');
    await ok('POST', '/bookings', { spaceId: s.cancha.id, kind: 'rental', title: 'Grupo 2', startsAt: t0, endsAt: t1, groupSize: 5 }, s.admin);
    const third = await call('POST', '/bookings', { spaceId: s.cancha.id, kind: 'rental', title: 'Grupo 3', startsAt: t0, endsAt: t1, groupSize: 1 }, s.admin);
    assert.equal(third.body.code, 'SPACE_TAKEN');
  });

  it('crea planes con academias y sedes permitidas (RQ7, RQ11, RQ12)', async () => {
    s.planNorte = await ok('POST', '/plans', { name: '8 clases Norte', kind: 'classes', units: 8, validityDays: 30, price: 120000, academyIds: [s.academyA.id], allSites: false, siteIds: [s.siteA1.id] }, s.admin);
    s.planYoga = await ok('POST', '/plans', { name: 'Yoga 1', kind: 'mixed', units: 1, validityDays: 30, price: 20000, academyIds: [s.academyB.id], allSites: true }, s.admin);
    const bad = await call('POST', '/plans', { name: 'X', kind: 'classes', units: 1, validityDays: 30, price: 1, academyIds: [s.academyB.id], allSites: false, siteIds: [s.siteA1.id] }, s.admin);
    assert.equal(bad.status, 400);
  });

  it('el cliente se registra con el codigo de la academia y obtiene su QR (RQ7)', async () => {
    const r = await ok('POST', '/auth/register-client', { username: 'carlos.c', password: 'Clave.12345', fullName: 'Carlos Cliente', document: '2002', joinCode: s.academyA.join_code, consent: true }, undefined);
    s.client = r.token;
    s.clientId = r.user.id;
    assert.equal(r.user.role, 'client');
    const qr = await ok('GET', '/me/qr', undefined, s.client);
    s.qr = qr.token;
    // RQ57: QR compacto (modulos grandes, facil de leer) y firmado
    assert.ok(qr.token.startsWith('AP.') && qr.token.length < 60, `QR corto: ${qr.token.length} caracteres`);
    const forged = qr.token.replace(/\.(\d+)\.(\d+)\./, (_m: string, u: string, t: string) => `.${Number(u) + 1}.${t}.`);
    assert.equal((await call('POST', '/attendance/scan', { qrToken: forged, academyId: s.academyA.id, siteId: s.siteA1.id }, s.admin)).body.code, 'QR_INVALID');
    const forbidden = await call('GET', '/clients', undefined, s.client);
    assert.equal(forbidden.status, 403, 'un cliente no ve otros clientes (RQ23)');
  });

  it('sin plan no puede ingresar; con plan y pago descuenta clases (RQ4, RQ6, RQ7)', async () => {
    const noPlan = await call('POST', '/attendance/scan', { qrToken: s.qr, academyId: s.academyA.id, siteId: s.siteA1.id, bookingId: s.session.id }, s.admin);
    assert.equal(noPlan.body.code, 'NO_PLAN');

    s.m1 = await ok('POST', '/memberships', { clientId: s.clientId, planId: s.planNorte.id, payment: { amount: 120000, method: 'efectivo' } }, s.admin);
    assert.equal(s.m1.paid, 120000);
    s.m2 = await ok('POST', '/memberships', { clientId: s.clientId, planId: s.planYoga.id }, s.admin);
    await ok('POST', '/payments', { membershipId: s.m2.id, amount: 20000, method: 'nequi' }, s.admin);
    const orphan = await call('POST', '/payments', { amount: 1000, method: 'efectivo' }, s.admin);
    assert.equal(orphan.status, 400, 'un pago debe ir ligado a un plan o una reserva');

    const preview = await ok('POST', '/attendance/scan', { qrToken: s.qr, academyId: s.academyA.id, siteId: s.siteA1.id, bookingId: s.session.id, dryRun: true }, s.admin);
    assert.equal(preview.membership.remainingAfter, 7);
    const scan = await ok('POST', '/attendance/scan', { qrToken: s.qr, academyId: s.academyA.id, siteId: s.siteA1.id, bookingId: s.session.id }, s.admin);
    assert.equal(scan.membership.planName, '8 clases Norte');
    assert.equal(scan.membership.remainingAfter, 7);
    const dup = await call('POST', '/attendance/scan', { qrToken: s.qr, academyId: s.academyA.id, siteId: s.siteA1.id, bookingId: s.session.id }, s.admin);
    assert.equal(dup.body.code, 'ALREADY_REGISTERED');
  });

  it('el plan solo sirve en las sedes permitidas y descuenta del plan de cada academia (RQ11, RQ16)', async () => {
    const sur = await call('POST', '/attendance/scan', { qrToken: s.qr, academyId: s.academyA.id, siteId: s.siteA2.id }, s.admin);
    assert.equal(sur.body.code, 'NO_PLAN');
    // Academia B (Yoga): no se registro con su codigo, pero el plan lo asocio (RQ13) y descuenta del plan de yoga
    const yoga = await ok('POST', '/attendance/scan', { qrToken: s.qr, academyId: s.academyB.id, siteId: s.siteB1.id }, s.admin);
    assert.equal(yoga.membership.planName, 'Yoga 1');
    assert.equal(yoga.membership.remainingAfter, 0);
    const again = await call('POST', '/attendance/scan', { qrToken: s.qr, academyId: s.academyB.id, siteId: s.siteB1.id }, s.admin);
    assert.equal(again.body.code, 'NO_PLAN');
    const me = await ok('GET', '/me', undefined, s.client);
    assert.equal(me.academies.length, 2);
  });

  it('aforo completo: solo quien tiene permiso registra por fuera (RQ17, RQ20)', async () => {
    // Dos clientes mas con plan; la sesion tiene cupo 2 y ya entro uno
    const mk = async (u: string, d: string) => {
      const { id } = await ok('POST', '/clients', { username: u, password: 'Clave.12345', fullName: u, document: d, academyIds: [s.academyA.id], homeSiteId: s.siteA1.id }, s.admin);
      await ok('POST', '/memberships', { clientId: id, planId: s.planNorte.id }, s.admin);
      return id;
    };
    const c2 = await mk('cliente.dos', '3003');
    const c3 = await mk('cliente.tres', '3004');
    await ok('POST', '/users', { username: 'portero', password: 'Clave.12345', fullName: 'Portero', document: '4004', permissions: ['attendance'] }, s.admin);
    const staff = (await ok('POST', '/auth/login', { username: 'portero', password: 'Clave.12345' })).token;

    await ok('POST', '/attendance/scan', { clientId: c2, academyId: s.academyA.id, siteId: s.siteA1.id, bookingId: s.session.id }, staff);
    const full = await call('POST', '/attendance/scan', { clientId: c3, academyId: s.academyA.id, siteId: s.siteA1.id, bookingId: s.session.id }, staff);
    assert.equal(full.body.code, 'CAPACITY_FULL');
    assert.equal(full.body.canOverride, false);
    const denied = await call('POST', '/attendance/scan', { clientId: c3, academyId: s.academyA.id, siteId: s.siteA1.id, bookingId: s.session.id, override: true }, staff);
    assert.equal(denied.status, 403);
    const noPerm = await call('POST', '/plans', { name: 'X', kind: 'classes', units: 1, validityDays: 1, price: 1, academyIds: [s.academyA.id] }, staff);
    assert.equal(noPerm.status, 403);
    const over = await ok('POST', '/attendance/scan', { clientId: c3, academyId: s.academyA.id, siteId: s.siteA1.id, bookingId: s.session.id, override: true }, s.admin);
    assert.equal(over.overCapacity, true);
  });

  it('reportes del cliente, unificado, aforo, pagos y agrupado (RQ8, RQ9, RQ15, RQ21, RQ22)', async () => {
    const mine = await ok('GET', '/reports/me', undefined, s.client);
    assert.equal(mine.totals.visits, 2);
    assert.equal(mine.byAcademy.length, 2);
    assert.equal(mine.weekly.totals[0].visits, 2);
    assert.equal(mine.memberships.length, 2);
    const asAdmin = await ok('GET', `/reports/clients/${s.clientId}/unified`, undefined, s.admin);
    assert.equal(asAdmin.totals.visits, 2);
    const forbidden = await call('GET', `/reports/clients/${s.clientId}/unified`, undefined, s.client);
    assert.equal(forbidden.status, 403);

    const att = await ok('GET', `/reports/attendance?siteId=${s.siteA1.id}&groupBy=month`, undefined, s.admin);
    assert.equal(att.totals.visits, 3);
    const cap = await ok('GET', '/reports/capacity', undefined, s.admin);
    const salon = cap.bySpace.find((x: any) => x.name === 'Salón 1');
    assert.equal(salon.attendees, 3);
    assert.equal(salon.over_capacity, 1);
    const pay = await ok('GET', '/reports/payments', undefined, s.admin);
    assert.equal(pay.total, 140000);
    const sum = await ok('GET', '/reports/summary', undefined, s.admin);
    assert.equal(sum.kpi.clients, 3);
    assert.ok(sum.capacity && sum.attendance && sum.payments);
  });

  it('aisla organizaciones y permite una cuenta por organizacion para la misma persona (RQ25, RQ26)', async () => {
    const other = await registerAdmin({ username: 'admin.dos', password: 'Clave.12345', fullName: 'Beto', document: '5005', organization: 'Org Dos', academyName: 'Box', consent: true });
    const t2 = other.token;
    assert.equal((await ok('GET', '/clients', undefined, t2)).length, 0);
    assert.equal((await call('GET', `/clients/${s.clientId}`, undefined, t2)).status, 404);
    assert.equal((await call('GET', `/sites/${s.siteA1.id}`, undefined, t2)).status, 404);
    assert.equal((await call('PUT', `/spaces/${s.salon.id}`, { siteId: s.siteA1.id, name: 'hack', maxCapacity: 1 }, t2)).status, 404);
    const sites2 = await ok('GET', '/sites', undefined, t2);
    const scan = await call('POST', '/attendance/scan', { qrToken: s.qr, academyId: other.user.academies[0].id, siteId: sites2[0].id }, t2);
    assert.equal(scan.body.code, 'CLIENT_NOT_FOUND');

    // Mismo documento de Carlos en la otra organizacion: nuevo usuario y contrasena, datos separados
    const reg = await ok('POST', '/auth/register-client', { username: 'carlos.box', password: 'Otra.12345', fullName: 'Carlos Cliente', document: '2002', joinCode: other.user.academies[0].join_code, consent: true });
    const rep = await ok('GET', '/reports/me', undefined, reg.token);
    assert.equal(rep.totals.visits, 0);
    assert.equal(rep.memberships.length, 0);
    const dupe = await call('POST', '/auth/register-client', { username: 'carlos.tres', password: 'Otra.12345', fullName: 'Carlos', document: '2002', joinCode: other.user.academies[0].join_code, consent: true });
    assert.equal(dupe.body.code, 'ALREADY_REGISTERED');
    const join = await call('POST', '/me/academies', { joinCode: s.academyA.join_code }, reg.token);
    assert.equal(join.body.code, 'OTHER_TENANT');
  });

  it('borra espacios, sedes y academias con lo que depende de ellos', async () => {
    // Espacio con reservas sin pagos: se borra junto con ellas
    assert.equal((await call('DELETE', `/spaces/${s.cancha.id}`, undefined, s.admin)).status, 204);
    // Academia con asistencias: no se borra
    assert.equal((await call('DELETE', `/academies/${s.academyB.id}`, undefined, s.admin)).body.code, 'IN_USE');
    // Academia nueva con sede, espacio, foto, clase y reserva: se borra completa
    const tmp = await ok('POST', '/academies', { name: 'Temporal' }, s.admin);
    // RQ36: sin horario de atencion no se agenda; con horario si
    const site = await ok('POST', '/sites', { academyId: tmp.id, name: 'Sede temporal' }, s.admin);
    const tmpSpace = await ok('POST', '/spaces', { siteId: site.id, name: 'Sin horario', maxCapacity: 5 }, s.admin);
    const tmpTeacher = await ok('POST', '/teachers', { fullName: 'Profe temporal', kind: 'internal', siteIds: [site.id] }, s.admin);
    const tmpClass = await ok('POST', '/classes', { academyId: tmp.id, teacherId: tmpTeacher.id, spaceId: tmpSpace.id, name: 'Sin horario', defaultCapacity: 3 }, s.admin);
    assert.equal((await call('POST', '/bookings', { spaceId: tmpSpace.id, kind: 'class', classId: tmpClass.id, startsAt: todayAt(12), endsAt: todayAt(13) }, s.admin)).body.code, 'NO_OPENING_HOURS');
    await ok('PUT', `/sites/${site.id}`, { academyId: tmp.id, name: 'Sede temporal', openingHours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '05:00', close: '23:00' })) }, s.admin);
    const space = await ok('POST', '/spaces', { siteId: site.id, name: 'Sala', maxCapacity: 5 }, s.admin);
    const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    await ok('POST', '/photos', { ownerType: 'site', ownerId: site.id, mime: 'image/png', data: pixel }, s.admin);
    const cls = await ok('POST', '/classes', { academyId: tmp.id, teacherId: tmpTeacher.id, spaceId: space.id, name: 'Clase temporal', defaultCapacity: 3 }, s.admin);
    await ok('PUT', `/teachers/${tmpTeacher.id}`, { fullName: 'Profe temporal', kind: 'internal', siteIds: [site.id] }, s.admin);
    await ok('POST', '/bookings', { spaceId: space.id, kind: 'class', classId: cls.id, startsAt: todayAt(12), endsAt: todayAt(13) }, s.admin);
    assert.equal((await call('DELETE', `/academies/${tmp.id}`, undefined, s.admin)).status, 204);
    const academies = await ok('GET', '/academies', undefined, s.admin);
    assert.ok(!academies.some((a: any) => a.id === tmp.id));
  });

  it('reserva cupos en clases solo con plan y cancela hasta el limite del admin (RQ30, RQ31, RQ32)', async () => {
    const tomorrow = (h: number) => new Date(new Date(todayAt(h)).getTime() + 24 * 3600_000).toISOString();
    const [norte] = await ok('POST', '/bookings', { spaceId: s.salon.id, kind: 'class', classId: s.salsa.id, startsAt: tomorrow(10), endsAt: tomorrow(11) }, s.admin);
    assert.equal(norte.group_size, 2);

    // RQ30: solo sesiones de clase definidas por la academia
    const rental = await ok('POST', '/bookings', { spaceId: s.salon.id, kind: 'rental', title: 'Alquiler', startsAt: tomorrow(14), endsAt: tomorrow(15) }, s.admin);
    assert.equal((await call('POST', '/me/class-reservations', { bookingId: rental[0].id }, s.client)).status, 404);

    // RQ31: un cliente sin plan no reserva; con plan de la sede si
    const nuevo = await ok('POST', '/auth/register-client', { username: 'sin.plan', password: 'Clave.12345', fullName: 'Sin Plan', document: '7007', joinCode: s.academyA.join_code, consent: true });
    assert.equal((await call('POST', '/me/class-reservations', { bookingId: norte.id }, nuevo.token)).body.code, 'NO_PLAN');
    const mine = await ok('POST', '/me/class-reservations', { bookingId: norte.id }, s.client);
    assert.equal(mine.reserved, 1);
    assert.equal((await call('POST', '/me/class-reservations', { bookingId: norte.id }, s.client)).body.code, 'ALREADY_RESERVED');
    const list = await ok('GET', `/bookings?from=${tomorrow(10).slice(0, 10)}&to=${tomorrow(10).slice(0, 10)}&kind=class`, undefined, s.client);
    assert.equal(list.find((x: any) => x.id === norte.id).my_reservation_id, mine.id);

    // Cupo lleno (cupo 2)
    const otro = async (u: string, d: string) => {
      const { id } = await ok('POST', '/clients', { username: u, password: 'Clave.12345', fullName: u, document: d, academyIds: [s.academyA.id] }, s.admin);
      await ok('POST', '/memberships', { clientId: id, planId: s.planNorte.id }, s.admin);
      await ok('POST', '/me/consent', { consent: true }, (await ok('POST', '/auth/login', { username: u, password: 'Clave.12345' })).token);
      return (await ok('POST', '/auth/login', { username: u, password: 'Clave.12345' })).token;
    };
    await ok('POST', '/me/class-reservations', { bookingId: norte.id }, await otro('cupo.dos', '7008'));
    assert.equal((await call('POST', '/me/class-reservations', { bookingId: norte.id }, await otro('cupo.tres', '7009'))).body.code, 'CAPACITY_FULL');
    const detail = await ok('GET', `/bookings/${norte.id}`, undefined, s.admin);
    assert.equal(detail.reservationList.length, 2);

    // RQ32: con limite de 48 h no puede cancelar una clase de manana; con 1 h si
    assert.equal((await call('PUT', '/settings', { cancelHours: 48 }, s.client)).status, 403);
    await ok('PUT', '/settings', { cancelHours: 48 }, s.admin);
    assert.equal((await ok('GET', '/settings', undefined, s.client)).cancelHours, 48);
    assert.equal((await call('POST', `/me/class-reservations/${mine.id}/cancel`, {}, s.client)).body.code, 'CANCEL_DEADLINE');
    // RQ35: la academia hereda 48 h salvo que defina la suya; la sede manda sobre la academia
    await ok('PUT', '/settings', { academies: [{ id: s.academyA.id, cancelHours: 72 }] }, s.admin);
    let st = await ok('GET', '/settings', undefined, s.admin);
    assert.equal(st.academies.find((a: any) => a.id === s.academyA.id).cancelHours, 72);
    assert.equal((await call('POST', `/me/class-reservations/${mine.id}/cancel`, {}, s.client)).body.cancelHours, 72);
    await ok('PUT', '/settings', { sites: [{ id: s.siteA1.id, cancelHours: 1 }] }, s.admin);
    st = await ok('GET', '/settings', undefined, s.admin);
    assert.equal(st.sites.find((x: any) => x.id === s.siteA1.id).cancelHours, 1);
    const listed = await ok('GET', '/me/class-reservations', undefined, s.client);
    assert.equal(listed.find((x: any) => x.id === mine.id).cancel_hours, 1);
    await ok('POST', `/me/class-reservations/${mine.id}/cancel`, {}, s.client);
    await ok('PUT', '/settings', { cancelHours: 1, academies: [{ id: s.academyA.id, cancelHours: null }], sites: [{ id: s.siteA1.id, cancelHours: null }] }, s.admin);
    assert.equal((await ok('GET', '/me/class-reservations', undefined, s.client)).length, 0);
  });

  it('no permite reservas simultaneas y pide autorizacion con el aforo completo (RQ37, RQ38)', async () => {
    const tomorrow = (h: number, m = 0) => new Date(new Date(todayAt(h, m)).getTime() + 24 * 3600_000).toISOString();
    // RQ38: dos clases que se cruzan en el tiempo, en espacios distintos
    const [c1] = await ok('POST', '/bookings', { spaceId: s.salon.id, kind: 'class', classId: s.salsa.id, startsAt: tomorrow(16), endsAt: tomorrow(17) }, s.admin);
    const otherSpace = await ok('POST', '/spaces', { siteId: s.siteA1.id, name: 'Salón 2', maxCapacity: 10 }, s.admin);
    const otro = await ok('POST', '/teachers', { fullName: 'Marta Otra', kind: 'internal', siteIds: [s.siteA1.id] }, s.admin);
    const bachata = await ok('POST', '/classes', { academyId: s.academyA.id, teacherId: otro.id, spaceId: otherSpace.id, name: 'Bachata', defaultCapacity: 5 }, s.admin);
    // RQ61: una clase solo se programa en su espacio; RQ62: el profesor no puede estar en dos clases a la vez
    assert.equal((await call('POST', '/bookings', { spaceId: otherSpace.id, kind: 'class', classId: s.salsa.id, startsAt: tomorrow(16, 30), endsAt: tomorrow(17, 30) }, s.admin)).body.code, 'CLASS_SPACE');
    const busyTeacher = await call('POST', '/bookings', { spaceId: otherSpace.id, kind: 'class', classId: bachata.id, teacherId: s.teacherIn.id, startsAt: tomorrow(16, 30), endsAt: tomorrow(17, 30) }, s.admin);
    assert.equal(busyTeacher.body.code, 'TEACHER_BUSY');
    const [c2] = await ok('POST', '/bookings', { spaceId: otherSpace.id, kind: 'class', classId: bachata.id, startsAt: tomorrow(16, 30), endsAt: tomorrow(17, 30) }, s.admin);
    await ok('POST', '/me/class-reservations', { bookingId: c1.id }, s.client);
    const clash = await call('POST', '/me/class-reservations', { bookingId: c2.id }, s.client);
    assert.equal(clash.body.code, 'OVERLAP');
    assert.ok(clash.body.error.includes('No puedes reservar dos espacios al mismo tiempo'));
    // El personal tampoco puede reservarle un espacio que se cruce
    const rent = await call('POST', '/bookings', { spaceId: otherSpace.id, kind: 'rental', clientId: s.clientId, title: 'Alquiler', startsAt: tomorrow(16, 15), endsAt: tomorrow(16, 45) }, s.admin);
    assert.equal(rent.body.code, 'SPACE_TAKEN'); // el espacio ya esta ocupado por la clase c2
    const freeSpace = await ok('POST', '/spaces', { siteId: s.siteA1.id, name: 'Salón 3', maxCapacity: 10 }, s.admin);
    assert.equal((await call('POST', '/bookings', { spaceId: freeSpace.id, kind: 'rental', clientId: s.clientId, title: 'Alquiler', startsAt: tomorrow(16, 15), endsAt: tomorrow(16, 45) }, s.admin)).body.code, 'OVERLAP');

    // RQ37: clase llena; quien escanea sin permiso solicita autorizacion y ve a quien contactar
    const staff = (await ok('POST', '/auth/login', { username: 'portero', password: 'Clave.12345' })).token;
    const full = await call('POST', '/attendance/scan', { clientId: (await ok('GET', '/clients?q=cupo.tres', undefined, s.admin))[0].id, academyId: s.academyA.id, siteId: s.siteA1.id, bookingId: s.session.id }, staff);
    assert.equal(full.body.code, 'CAPACITY_FULL');
    assert.ok(full.body.contacts.some((c: any) => c.role === 'admin'), 'muestra a quien contactar');
    const reqBody = { clientId: full.body.client.id, academyId: s.academyA.id, siteId: s.siteA1.id, bookingId: s.session.id };
    const request = await ok('POST', '/attendance/requests', reqBody, staff);
    assert.equal(request.status, 'pending');
    assert.equal((await ok('POST', '/attendance/requests', reqBody, staff)).id, request.id, 'no duplica solicitudes pendientes');
    assert.equal((await call('POST', `/attendance/requests/${request.id}/approve`, {}, staff)).status, 403);
    const pending = await ok('GET', '/attendance/requests', undefined, s.admin);
    assert.ok(pending.some((x: any) => x.id === request.id));
    const approved = await ok('POST', `/attendance/requests/${request.id}/approve`, {}, s.admin);
    assert.equal(approved.overCapacity, true);
    assert.equal((await call('POST', `/attendance/requests/${request.id}/approve`, {}, s.admin)).body.code, 'ALREADY_RESOLVED');
    const history = await ok('GET', '/attendance/requests?status=approved', undefined, s.admin);
    assert.equal(history.find((x: any) => x.id === request.id).resolved_by_name, 'Ana Admin');
  });

  it('valida el ingreso solo el mismo dia desde 1 h antes, respeta el horario del espacio y reporta clases (RQ39, RQ40, RQ41)', async () => {
    const tomorrow = (h: number, m = 0) => new Date(new Date(todayAt(h, m)).getTime() + 24 * 3600_000);
    const dayInBogota = new Date(tomorrow(12).getTime() + OFFSET_MS).getUTCDay(); // dia de la semana local

    // RQ40: horario propio del espacio, dentro del de la sede (05:00-23:00)
    const sala = await ok('POST', '/spaces', { siteId: s.siteA1.id, name: 'Sala mañanas', maxCapacity: 8 }, s.admin);
    const bad = await call('PUT', `/spaces/${sala.id}`, { siteId: s.siteA1.id, name: 'Sala mañanas', maxCapacity: 8, openingHours: [{ day: dayInBogota, open: '04:00', close: '12:00' }] }, s.admin);
    assert.equal(bad.body.code, 'SPACE_HOURS');
    await ok('PUT', `/spaces/${sala.id}`, { siteId: s.siteA1.id, name: 'Sala mañanas', maxCapacity: 8, openingHours: [{ day: dayInBogota, open: '08:00', close: '12:00' }] }, s.admin);
    const yogaM = await ok('POST', '/classes', { academyId: s.academyA.id, teacherId: s.teacherExt.id, spaceId: sala.id, name: 'Yoga mañanas', defaultCapacity: 8 }, s.admin);
    const late = await call('POST', '/bookings', { spaceId: sala.id, kind: 'class', classId: yogaM.id, startsAt: tomorrow(18).toISOString(), endsAt: tomorrow(19).toISOString() }, s.admin);
    assert.equal(late.body.code, 'OUT_OF_HOURS');
    assert.ok(late.body.error.includes('el espacio'));
    const [morning] = await ok('POST', '/bookings', { spaceId: sala.id, kind: 'class', classId: yogaM.id, startsAt: tomorrow(9).toISOString(), endsAt: tomorrow(10).toISOString() }, s.admin);

    // RQ39: una clase de manana no se valida hoy
    await ok('POST', '/me/class-reservations', { bookingId: morning.id }, s.client);
    const early = await call('POST', '/attendance/scan', { clientId: s.clientId, academyId: s.academyA.id, siteId: s.siteA1.id, bookingId: morning.id }, s.admin);
    assert.equal(early.body.code, 'OUT_OF_TIME');
    assert.ok(early.body.error.includes('08:00'), 'informa desde que hora (1 h antes del inicio)');

    // RQ41: reservadas y tomadas; el cliente solo ve lo suyo, el personal con reportes ve a todos
    const range = `from=${new Date(Date.now() + OFFSET_MS - 86400_000).toISOString().slice(0, 10)}&to=${new Date(tomorrow(12).getTime() + OFFSET_MS).toISOString().slice(0, 10)}`;
    const mine = await ok('GET', `/reports/classes?${range}&clientId=999`, undefined, s.client);
    assert.ok(mine.rows.length > 0 && mine.rows.every((r: any) => r.client_id === s.clientId), 'el cliente solo ve su informacion');
    assert.ok(mine.rows.some((r: any) => r.booking_id === morning.id && r.state === 'reserved'));
    const all = await ok('GET', `/reports/classes?${range}`, undefined, s.admin);
    assert.ok(new Set(all.rows.map((r: any) => r.client_id)).size > 1, 'el personal ve a todos');
    assert.ok(all.totals.taken >= 1 && all.totals.reserved >= 1);
    const portero = (await ok('POST', '/auth/login', { username: 'portero', password: 'Clave.12345' })).token;
    assert.equal((await call('GET', `/reports/classes?${range}`, undefined, portero)).status, 403);
  });

  it('franjas libres, reglas por permiso, aforo consistente, horizonte, Mis reservas, reportes e inasistencias (RQ42-RQ52)', async () => {
    const tomorrow = (h: number, m = 0) => new Date(new Date(todayAt(h, m)).getTime() + 24 * 3600_000);
    const localDay = (d: Date) => new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 10);

    // RQ42: espacio ocupado -> sugiere las franjas libres del dia
    await ok('POST', '/bookings', { spaceId: s.salon.id, kind: 'class', classId: s.salsa.id, startsAt: tomorrow(12).toISOString(), endsAt: tomorrow(13).toISOString() }, s.admin);
    const taken = await call('POST', '/bookings', { spaceId: s.salon.id, kind: 'rental', title: 'Choque', startsAt: tomorrow(12, 30).toISOString(), endsAt: tomorrow(13, 30).toISOString() }, s.admin);
    assert.equal(taken.body.code, 'SPACE_TAKEN');
    assert.ok(taken.body.error.includes('Horarios disponibles ese día'));
    assert.ok(taken.body.available.some((x: string) => x.endsWith('-12:00')) && taken.body.available.some((x: string) => x.startsWith('13:00')));
    const av = await ok('GET', `/spaces/${s.salon.id}/availability?date=${localDay(tomorrow(12))}`, undefined, s.client);
    assert.deepEqual(av.available, taken.body.available);
    // RQ60: el cliente ve las franjas reservadas y los cupos libres, sin titulos ni nombres
    assert.ok(av.busy.some((b: any) => b.from === '12:00' && b.label === 'Reservado' && b.spotsLeft === 0));
    assert.ok(!JSON.stringify(av).includes('Salsa') && !JSON.stringify(av).includes('Carlos'));

    // RQ44: las reglas las configura quien tenga el permiso, no solo el admin
    await ok('POST', '/users', { username: 'reglas', password: 'Clave.12345', fullName: 'Reglas', document: '8008', permissions: ['booking_rules'] }, s.admin);
    const rules = (await ok('POST', '/auth/login', { username: 'reglas', password: 'Clave.12345' })).token;
    await ok('PUT', '/settings', { bookingHorizonMonths: 1 }, rules);
    const portero = (await ok('POST', '/auth/login', { username: 'portero', password: 'Clave.12345' })).token;
    assert.equal((await call('PUT', '/settings', { bookingHorizonMonths: 6 }, portero)).status, 403);

    // RQ47: no se agenda mas alla del horizonte (1 mes)
    const far = new Date(tomorrow(10).getTime() + 40 * 86400_000);
    const beyond = await call('POST', '/bookings', { spaceId: s.salon.id, kind: 'class', classId: s.salsa.id, startsAt: far.toISOString(), endsAt: new Date(far.getTime() + 3600_000).toISOString() }, s.admin);
    assert.equal(beyond.body.code, 'BEYOND_HORIZON');
    await ok('PUT', '/settings', { bookingHorizonMonths: 3 }, rules);

    // RQ46: con varios grupos, grupos x integrantes = aforo
    const bad = await call('POST', '/spaces', { siteId: s.siteA1.id, name: 'Patio', maxCapacity: 30, allowMultiGroup: true, maxGroups: 2, capacityPerGroup: 10 }, s.admin);
    assert.equal(bad.status, 400);
    await ok('POST', '/spaces', { siteId: s.siteA1.id, name: 'Patio', maxCapacity: 30, allowMultiGroup: true, maxGroups: 3, capacityPerGroup: 10 }, s.admin);

    // RQ52: reservo, no asisto, la clase termina -> se descuenta del plan y ya no se puede cancelar
    const now = Date.now();
    const [past] = await ok('POST', '/bookings', { spaceId: s.salon.id, kind: 'class', classId: s.salsa.id, startsAt: new Date(now - 3 * 3600_000).toISOString(), endsAt: new Date(now - 2 * 3600_000).toISOString() }, s.admin);
    const [{ tenant_id }] = await database.query(`SELECT tenant_id FROM bookings WHERE id = $1`, [past.id]);
    const [cr] = await database.query(`INSERT INTO class_reservations (tenant_id, booking_id, client_id) VALUES ($1, $2, $3) RETURNING id`, [tenant_id, past.id, s.clientId]);
    const before = (await ok('GET', `/clients/${s.clientId}`, undefined, s.admin)).memberships.find((m: any) => m.plan_name === '8 clases Norte');
    const settled = await settleMissedReservations(database);
    assert.ok(settled.charged >= 1);
    assert.equal((await settleMissedReservations(database)).charged, 0, 'no descuenta dos veces');
    const after = (await ok('GET', `/clients/${s.clientId}`, undefined, s.admin)).memberships.find((m: any) => m.plan_name === '8 clases Norte');
    assert.equal(after.units_used, before.units_used + 1);
    assert.equal((await call('POST', `/me/class-reservations/${cr.id}/cancel`, {}, s.client)).body.code, 'EXPIRED');

    // RQ48, RQ49: Mis reservas de la mas reciente a la mas antigua, con estado; maximo 20 sin rango; rango de un ano
    const mine = await ok('GET', '/me/reservations', undefined, s.client);
    assert.ok(mine.rows.length <= 20);
    const times = mine.rows.map((r: any) => new Date(r.starts_at).getTime());
    assert.deepEqual(times, [...times].sort((a: number, b: number) => b - a));
    assert.equal(mine.rows.find((r: any) => r.type === 'class' && r.booking_id === past.id).state, 'missed');
    assert.ok(mine.rows.some((r: any) => r.state === 'cancelled'));
    assert.equal((await call('GET', '/me/reservations?from=2025-01-01&to=2026-12-31', undefined, s.client)).body.code, 'RANGE_TOO_LONG');

    // RQ50: los reportes del administrador tambien se limitan a un ano
    assert.equal((await call('GET', '/reports/attendance?from=2025-01-01&to=2026-12-31', undefined, s.admin)).body.code, 'RANGE_TOO_LONG');

    // RQ45: el reporte de clases trae el profesor; RQ51: clientes con mas planes y asistencias
    const cls = await ok('GET', `/reports/classes?from=${localDay(new Date(now - 86400_000))}&to=${localDay(tomorrow(12))}`, undefined, s.admin);
    assert.ok(cls.rows.some((r: any) => r.teacher_name === 'Pedro Interno' && r.state === 'missed'));
    const top = await ok('GET', '/reports/top-clients', undefined, s.admin);
    assert.equal(top.byPlans[0].full_name, 'Carlos Cliente');
    assert.ok(top.byAttendance.length >= 2 && top.byAttendance[0].visits >= top.byAttendance[1].visits);
  });

  it('vigencia del plan en meses o dias desde la fecha de ingreso y fecha limite de venta (RQ55, RQ56)', async () => {
    assert.equal((await call('POST', '/plans', { name: 'Largo', kind: 'classes', units: 4, validityDays: 400, price: 1, academyIds: [s.academyA.id] }, s.admin)).status, 400);
    assert.equal((await call('POST', '/plans', { name: 'Doble', kind: 'classes', units: 4, validityDays: 30, validityMonths: 1, price: 1, academyIds: [s.academyA.id] }, s.admin)).status, 400);
    const anual = await ok('POST', '/plans', { name: 'Anual', kind: 'classes', units: 100, validityMonths: 12, price: 1, academyIds: [s.academyA.id] }, s.admin);
    const m = await ok('POST', '/memberships', { clientId: s.clientId, planId: anual.id, startsOn: '2026-11-15' }, s.admin);
    assert.equal(m.starts_on, '2026-11-15');
    assert.equal(m.ends_on, '2027-11-14');
    const dias = await ok('POST', '/plans', { name: 'Quincena', kind: 'classes', units: 10, validityDays: 15, price: 1, academyIds: [s.academyA.id] }, s.admin);
    assert.equal((await ok('POST', '/memberships', { clientId: s.clientId, planId: dias.id, startsOn: '2026-11-01' }, s.admin)).ends_on, '2026-11-15');
    // Venta cerrada: ya no se asigna a nadie, pero quien lo tiene lo conserva
    await ok('PUT', `/plans/${dias.id}`, { name: 'Quincena', kind: 'classes', units: 10, validityDays: 15, price: 1, academyIds: [s.academyA.id], saleUntil: '2020-01-01' }, s.admin);
    assert.equal((await call('POST', '/memberships', { clientId: s.clientId, planId: dias.id }, s.admin)).body.code, 'PLAN_SALE_CLOSED');
    const still = (await ok('GET', `/clients/${s.clientId}`, undefined, s.admin)).memberships.filter((x: any) => x.plan_name === 'Quincena');
    assert.equal(still.length, 1);
  });

  it('el cliente reserva un espacio y ve las reservas ajenas sin datos personales', async () => {
    const start = new Date(new Date(todayAt(10)).getTime() + 48 * 3600_000); // pasado manana a las 10:00
    const body = { spaceId: s.yogaRoom.id, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3600_000).toISOString(), groupSize: 2 };
    // RQ31: sin un plan de reservas que incluya la sede no puede reservar
    assert.equal((await call('POST', '/me/bookings', body, s.client)).body.code, 'NO_PLAN');
    const planRes = await ok('POST', '/plans', { name: 'Reservas Yoga', kind: 'reservations', units: 4, validityDays: 30, price: 50000, academyIds: [s.academyB.id], allSites: true }, s.admin);
    const mRes = await ok('POST', '/memberships', { clientId: s.clientId, planId: planRes.id }, s.admin);
    const b = await ok('POST', '/me/bookings', body, s.client);
    assert.equal(b.kind, 'rental');
    s.rental = b;
    s.rentalMembershipId = mRes.id;
    // RQ34: el pago necesita cliente y plan; la reserva solo se asocia si es del mismo cliente
    assert.equal((await call('POST', '/payments', { bookingId: b.id, amount: 30000, method: 'tarjeta' }, s.admin)).status, 400);
    const otherClient = (await ok('GET', '/clients?q=cupo.dos', undefined, s.admin))[0];
    const otherM = (await ok('GET', `/clients/${otherClient.id}`, undefined, s.admin)).memberships[0];
    assert.equal((await call('POST', '/payments', { membershipId: otherM.id, bookingId: b.id, amount: 30000, method: 'tarjeta' }, s.admin)).status, 400);
    assert.equal((await call('POST', '/payments', { clientId: s.clientId, membershipId: otherM.id, amount: 1000, method: 'efectivo' }, s.admin)).status, 400);
    await ok('POST', '/payments', { clientId: s.clientId, membershipId: mRes.id, bookingId: b.id, amount: 30000, method: 'tarjeta' }, s.admin);
    const pays = await ok('GET', `/payments?clientId=${s.clientId}`, undefined, s.admin);
    assert.ok(pays.every((x: any) => x.client_id === s.clientId && x.membership_id), 'todo pago con cliente y plan');
    assert.ok(pays.some((x: any) => x.concept === 'Plan: Reservas Yoga · Reserva: Reserva de Carlos Cliente'));
    const day = new Date(start.getTime() + OFFSET_MS).toISOString().slice(0, 10);
    const listAdmin = await ok('GET', `/bookings?from=${day}&to=${day}&spaceId=${s.yogaRoom.id}`, undefined, s.admin);
    assert.equal(listAdmin[0].client_name, 'Carlos Cliente');
    assert.equal(listAdmin[0].paid, 30000);
  });
  it('envia recordatorios un dia y tres horas antes y avisa el vencimiento del plan (RQ63, RQ64)', async () => {
    const mails: { to: string; subject: string; text: string; html: string }[] = [];
    setMailSender(async (m) => { mails.push(m); });
    try {
      // Parametros de la organizacion: solo con permiso; preferencias y correo de cada usuario
      assert.equal((await call('PUT', '/notification-settings', { dayBefore: true, hoursBefore: true, plan: true, planNoticeDays: 5 }, s.client)).status, 403);
      const org = await ok('PUT', '/notification-settings', { dayBefore: true, hoursBefore: true, plan: true, planNoticeDays: 5 }, s.admin);
      assert.equal(org.planNoticeDays, 5);
      assert.equal((await call('PUT', '/me/notifications', { dayBefore: true, hoursBefore: true, plan: true, email: 'no-es-correo' }, s.client)).status, 400);
      const prefs = await ok('PUT', '/me/notifications', { dayBefore: true, hoursBefore: true, plan: true, email: 'carlos@example.com' }, s.client);
      assert.equal(prefs.email, 'carlos@example.com');
      assert.equal(prefs.organization.planNoticeDays, 5);

      // RQ63: la reserva se hizo con anticipacion; se recuerda un dia antes y tres horas antes, una sola vez cada uno
      const start = new Date(s.rental.starts_at).getTime();
      await database.query(`UPDATE bookings SET created_at = $2 WHERE id = $1`, [s.rental.id, new Date(start - 72 * 3600_000)]);
      assert.ok(await sendReminders(database, new Date(start - 23 * 3600_000)) >= 1);
      const day = mails.find((m) => m.subject.startsWith('Recordatorio: Reserva de Carlos Cliente mañana'));
      assert.ok(day && day.text.includes('Yoga') && day.text.includes('Sede'), 'recordatorio del dia anterior');
      assert.equal(await sendReminders(database, new Date(start - 22 * 3600_000)), 0, 'no repite');
      assert.ok(await sendReminders(database, new Date(start - 2 * 3600_000)) >= 1);
      assert.ok(mails.some((m) => m.subject.includes('en 3 horas') && m.to === 'carlos@example.com'));
      assert.equal(await sendReminders(database, new Date(start - 1 * 3600_000)), 0);

      // RQ64: plan por vencer dentro de los dias definidos, con datos del plan, clases tomadas y pendientes
      const mem = (await ok('GET', `/clients/${s.clientId}`, undefined, s.admin)).memberships.find((m: any) => m.id === s.rentalMembershipId);
      const noon = (ymd: string, plusDays: number) => new Date(new Date(`${ymd}T12:00:00${OFFSET_ISO}`).getTime() + plusDays * 86400_000);
      await sendPlanNotices(database, noon(mem.ends_on, -8));
      assert.ok(!mails.some((m) => m.subject.includes('Reservas Yoga')), 'fuera de los 5 dias no avisa');
      await sendPlanNotices(database, noon(mem.ends_on, -2));
      const expiring = mails.find((m) => m.subject === 'Tu plan Reservas Yoga vence en 2 día(s)');
      assert.ok(expiring, 'aviso de plan por vencer');
      assert.ok(expiring.text.includes('Clases pendientes por tomar') && expiring.text.includes('CLASES TOMADAS') && expiring.text.includes('CLASES RESERVADAS PENDIENTES'));
      // El cliente apaga el aviso: no le llega el de vencido; al encenderlo, si
      await ok('PUT', '/me/notifications', { dayBefore: true, hoursBefore: true, plan: false }, s.client);
      await sendPlanNotices(database, noon(mem.ends_on, 1));
      assert.ok(!mails.some((m) => m.subject.startsWith('Tu plan Reservas Yoga venció')));
      assert.equal((await ok('GET', '/me/notifications', undefined, s.client)).email, 'carlos@example.com', 'sin email en el cuerpo conserva el correo');
      await ok('PUT', '/me/notifications', { dayBefore: true, hoursBefore: true, plan: true }, s.client);
      await sendPlanNotices(database, noon(mem.ends_on, 1));
      assert.ok(mails.some((m) => m.subject.startsWith('Tu plan Reservas Yoga venció')));

      // Registro de envios para el administrador
      const log = await ok('GET', '/notifications', undefined, s.admin);
      assert.ok(log.some((n: any) => n.kind === 'day_before' && n.status === 'sent' && n.full_name === 'Carlos Cliente'));
      assert.ok(log.some((n: any) => n.kind === 'plan_expired'));
      assert.equal((await call('GET', '/notifications', undefined, s.client)).status, 403);
    } finally {
      setMailSender(null);
    }
  });
  it('envia los correos por la API de Resend o de Brevo cuando hay clave (despliegue en Railway)', async () => {
    const realFetch = globalThis.fetch;
    const calls: { url: string; headers: any; body: any }[] = [];
    globalThis.fetch = (async (url: any, init: any) => {
      if (!/resend\.com|brevo\.com|googleapis\.com/.test(String(url))) return realFetch(url, init);
      const isForm = String(init.headers['content-type']).includes('urlencoded');
      calls.push({ url: String(url), headers: init.headers, body: isForm ? Object.fromEntries(new URLSearchParams(init.body)) : JSON.parse(init.body) });
      if (String(url).includes('oauth2')) return new Response('{"access_token":"ya29.prueba","expires_in":3600}', { status: 200 });
      return new Response('{"id":"x"}', { status: 200 });
    }) as typeof fetch;
    const env = { ...process.env };
    try {
      const mail = { to: 'carlos@example.com', subject: 'Prueba', text: 'hola', html: '<p>hola</p>' };
      assert.equal(await sendMail(mail), 'logged', 'sin proveedor solo registra');
      process.env.MAIL_FROM = 'AcademiaPass <avisos@academia.co>';
      process.env.RESEND_API_KEY = 're_prueba';
      assert.equal(await sendMail(mail), 'sent');
      assert.equal(calls[0].url, 'https://api.resend.com/emails');
      assert.equal(calls[0].headers.authorization, 'Bearer re_prueba');
      assert.deepEqual(calls[0].body.to, ['carlos@example.com']);
      assert.equal(calls[0].body.from, 'AcademiaPass <avisos@academia.co>');
      delete process.env.RESEND_API_KEY;
      process.env.BREVO_API_KEY = 'xkeysib-prueba';
      await sendMail(mail);
      assert.equal(calls[1].url, 'https://api.brevo.com/v3/smtp/email');
      assert.deepEqual(calls[1].body.sender, { name: 'AcademiaPass', email: 'avisos@academia.co' });
      assert.equal((await ok('GET', '/notification-settings', undefined, s.admin)).mailConfigured, true);

      // RQ67: desde la cuenta de Gmail del administrador por la API de Gmail (HTTPS, sin servidor de correo)
      delete process.env.MAIL_FROM;
      Object.assign(process.env, { GMAIL_USER: 'academia@gmail.com', GMAIL_CLIENT_ID: 'cid', GMAIL_CLIENT_SECRET: 'csecret', GMAIL_REFRESH_TOKEN: '1//refresh' });
      await sendMail(mail);
      const [tokenCall, sendCall] = calls.slice(2);
      assert.equal(tokenCall.url, 'https://oauth2.googleapis.com/token');
      assert.equal(tokenCall.body.grant_type, 'refresh_token');
      assert.equal(sendCall.url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
      assert.equal(sendCall.headers.authorization, 'Bearer ya29.prueba');
      const raw = Buffer.from(sendCall.body.raw, 'base64url').toString();
      assert.ok(raw.includes('From: AcademiaPass <academia@gmail.com>') && raw.includes('To: carlos@example.com') && raw.includes('Subject: Prueba'));
      const org = await ok('GET', '/notification-settings', undefined, s.admin);
      assert.equal(org.mailProvider, 'gmail-api');
      assert.equal(org.mailFrom, 'AcademiaPass <academia@gmail.com>');
    } finally {
      globalThis.fetch = realFetch;
      for (const k of ['MAIL_FROM', 'RESEND_API_KEY', 'BREVO_API_KEY', 'GMAIL_USER', 'GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN']) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
    }
  });
  it('crea la clase con su horario, periodica en varios dias, sin superar el aforo (RQ65)', async () => {
    const start = new Date(new Date(todayAt(7)).getTime() + 9 * 86400_000);
    const end = new Date(start.getTime() + 3600_000);
    const day0 = new Date(start.getTime() + OFFSET_MS).getUTCDay();
    const base = { academyId: s.academyA.id, teacherId: s.teacherIn.id, spaceId: s.salon.id, defaultCapacity: 3 };
    // El cupo de la sesion no puede superar el aforo del espacio (Salon 1: 3 personas)
    const big = await call('POST', '/classes', { ...base, name: 'Muy llena', defaultCapacity: 4, schedule: { startsAt: start.toISOString(), endsAt: end.toISOString() } }, s.admin);
    assert.equal(big.body.code, 'CAPACITY_EXCEEDED');
    // Periodica: 2 semanas, el dia inicial y dos dias despues -> 4 sesiones con el cupo de la clase
    const c = await ok('POST', '/classes', { ...base, name: 'Bachata temprano', schedule: { startsAt: start.toISOString(), endsAt: end.toISOString(), repeatWeeks: 2, weekdays: [day0, (day0 + 2) % 7] } }, s.admin);
    assert.equal(c.sessions.length, 4);
    assert.ok(c.sessions.every((x: any) => x.group_size === 3 && x.class_id === c.id && x.teacher_name === 'Pedro Interno'));
    const gaps = c.sessions.map((x: any) => Math.round((new Date(x.starts_at).getTime() - start.getTime()) / 86400_000));
    assert.deepEqual(gaps, [0, 2, 7, 9]);
    // Si una sesion no cabe no se crea la clase y se informan los horarios libres
    const clash = await call('POST', '/classes', { ...base, name: 'Choca', teacherId: s.teacherExt.id, schedule: { startsAt: start.toISOString(), endsAt: end.toISOString() } }, s.admin);
    assert.equal(clash.status, 409);
    assert.equal(clash.body.code, 'SPACE_TAKEN');
    assert.ok(Array.isArray(clash.body.available) && clash.body.available.length > 0);
    assert.ok(!(await ok('GET', '/classes', undefined, s.admin)).some((x: any) => x.name === 'Choca'), 'no queda la clase a medias');
    // Sin horario se crea solo la clase
    const plain = await ok('POST', '/classes', { ...base, name: 'Sin horario aun' }, s.admin);
    assert.deepEqual(plain.sessions, []);
  });
  it('negocia el cruce con la clase de otro profesor pidiendole el cambio de horario (RQ66)', async () => {
    const mails: { to: string; subject: string; text: string; html: string }[] = [];
    setMailSender(async (m) => { mails.push(m); });
    try {
      const start = new Date(new Date(todayAt(7)).getTime() + 9 * 86400_000); // sesion de Bachata temprano (Pedro)
      const end = new Date(start.getTime() + 3600_000);
      const base66 = { academyId: s.academyA.id, teacherId: s.teacherExt.id, spaceId: s.salon.id, defaultCapacity: 2 };
      // Con skipConflicts se crea la clase y se informa con que sesion y profesor choca
      const c = await ok('POST', '/classes', { ...base66, name: 'Yoga de Laura', schedule: { startsAt: start.toISOString(), endsAt: end.toISOString(), repeatWeeks: 2, weekdays: [new Date(start.getTime() + OFFSET_MS).getUTCDay()], skipConflicts: true } }, s.admin);
      assert.equal(c.sessions.length, 0);
      assert.equal(c.conflicts.length, 2);
      const clash = c.conflicts[0].clashes[0];
      assert.equal(clash.teacherName, 'Pedro Interno');
      assert.ok(c.conflicts[0].available.length > 0);
      await database.query(`UPDATE teachers SET email = 'pedro@example.com' WHERE id = $1`, [s.teacherIn.id]);

      const at = (h: number, plusDays = 0) => new Date(new Date(todayAt(h)).getTime() + (9 + plusDays) * 86400_000).toISOString();
      const item = { bookingId: clash.bookingId, wantedStartsAt: start.toISOString(), wantedEndsAt: end.toISOString(), proposedStartsAt: at(9), proposedEndsAt: at(10) };
      assert.equal((await call('POST', '/schedule-requests', { classId: c.id, items: [{ ...item, proposedStartsAt: at(7), proposedEndsAt: at(8) }] }, s.admin)).body.code, 'PROPOSAL_CLASH');
      const req66 = await ok('POST', '/schedule-requests', { classId: c.id, message: 'Necesito el salón temprano', items: [item] }, s.admin);
      assert.equal(req66.status, 'pending');
      assert.equal(req66.emailed, true);
      assert.equal((await call('POST', '/schedule-requests', { classId: c.id, items: [item] }, s.admin)).body.code, 'ALREADY_REQUESTED');
      const mail = mails.find((m) => m.to === 'pedro@example.com')!;
      assert.ok(mail.subject.includes('Yoga de Laura'));
      const token = /token=([\w-]+)/.exec(mail.text)![1];

      // El profesor responde desde el enlace del correo, sin iniciar sesion
      const pageRes = await fetch(`${base}/schedule-requests/respond?token=${token}`);
      assert.equal(pageRes.status, 200);
      assert.ok((await pageRes.text()).includes('Aceptar el cambio'));
      const done = await fetch(`${base}/schedule-requests/respond`, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token, action: 'accept', note: 'De acuerdo' }).toString(),
      });
      assert.equal(done.status, 200, await done.clone().text());
      assert.ok((await done.text()).includes('Cambio aceptado'));
      // Su sesion paso a las 9 y la clase que pidio el cambio quedo a las 7
      const day = new Date(start.getTime() + OFFSET_MS).toISOString().slice(0, 10);
      const agenda = await ok('GET', `/bookings?from=${day}&to=${day}&spaceId=${s.salon.id}`, undefined, s.admin);
      assert.equal(new Date(agenda.find((x: any) => x.id === clash.bookingId).starts_at).toISOString(), at(9));
      assert.ok(agenda.some((x: any) => x.class_id === c.id && new Date(x.starts_at).toISOString() === start.toISOString()));
      const list = await ok('GET', '/schedule-requests', undefined, s.admin);
      const mine = list.find((x: any) => x.id === req66.id);
      assert.equal(mine.status, 'accepted');
      assert.equal(mine.resolved_via, 'email');
      assert.ok(mine.items[0].new_booking_id);
      // Ya respondida no se puede volver a aplicar
      const again = await fetch(`${base}/schedule-requests/respond`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token, action: 'reject' }).toString() });
      assert.equal(again.status, 409);

      // Segunda fecha: el personal la rechaza en nombre del profesor
      const second = c.conflicts[1].clashes[0];
      const r2 = await ok('POST', '/schedule-requests', { classId: c.id, items: [{ bookingId: second.bookingId, wantedStartsAt: c.conflicts[1].startsAt, wantedEndsAt: c.conflicts[1].endsAt, proposedStartsAt: at(11, 7), proposedEndsAt: at(12, 7) }] }, s.admin);
      assert.equal((await ok('POST', `/schedule-requests/${r2.id}/reject`, { note: 'No puede' }, s.admin)).status, 'rejected');
      assert.equal((await call('POST', `/schedule-requests/${r2.id}/accept`, {}, s.admin)).body.code, 'ALREADY_RESOLVED');
      assert.equal((await call('GET', '/schedule-requests', undefined, s.client)).status, 403);
    } finally {
      setMailSender(null);
    }
  });
  it('el profesor tiene usuario, gestiona solo sus clases, cancela con anticipacion y ve su reporte (RQ69)', async () => {
    const account = { username: 'ana.profe', password: 'Profe.2026x', document: '7770001' };
    // Solo el administrador crea el usuario del profesor
    const t = await ok('POST', '/teachers', { fullName: 'Ana Profe', kind: 'internal', email: 'ana@example.com', siteIds: [s.siteA1.id], account }, s.admin);
    assert.equal(t.account.username, 'ana.profe');
    assert.deepEqual(t.account.permissions, ['classes', 'bookings', 'attendance']);
    const ana = (await ok('POST', '/auth/login', { username: 'ana.profe', password: 'Profe.2026x' })).token;
    const me = await ok('GET', '/me', undefined, ana);
    assert.equal(me.teacher.id, t.id);
    assert.equal(me.role, 'staff');

    // Solo sus clases: no crea clases de otro profesor, no edita las ajenas ni crea profesores
    const base69 = { academyId: s.academyA.id, spaceId: s.salon.id, defaultCapacity: 3 };
    assert.equal((await call('POST', '/classes', { ...base69, teacherId: s.teacherIn.id, name: 'Ajena' }, ana)).body.code, 'NOT_YOUR_CLASS');
    assert.equal((await call('PUT', `/classes/${s.salsa.id}`, { academyId: s.academyA.id, teacherId: t.id, spaceId: s.salon.id, name: 'Salsa', defaultCapacity: 2 }, ana)).body.code, 'NOT_YOUR_CLASS');
    assert.equal((await call('POST', '/teachers', { fullName: 'Otro', kind: 'internal', siteIds: [s.siteA1.id] }, ana)).status, 403);
    const far = new Date(new Date(todayAt(20)).getTime() + 10 * 86400_000);
    const near = new Date(new Date(todayAt(20)).getTime() + 1 * 86400_000);
    const mine = await ok('POST', '/classes', { ...base69, teacherId: t.id, name: 'Funcional de Ana', schedule: { startsAt: far.toISOString(), endsAt: new Date(far.getTime() + 3600_000).toISOString() } }, ana);
    assert.equal(mine.sessions.length, 1);
    const [soon] = await ok('POST', '/bookings', { kind: 'class', classId: mine.id, spaceId: s.salon.id, startsAt: near.toISOString(), endsAt: new Date(near.getTime() + 3600_000).toISOString() }, ana);
    // Separa espacios a su nombre
    const rental = await ok('POST', '/bookings', { kind: 'rental', spaceId: s.salon.id, title: 'Ensayo de Ana', teacherId: s.teacherIn.id, startsAt: new Date(far.getTime() + 2 * 3600_000).toISOString(), endsAt: new Date(far.getTime() + 3 * 3600_000).toISOString(), groupSize: 2 }, ana);
    assert.equal(rental[0].teacher_id, t.id, 'la reserva queda a nombre del profesor');
    // La asistencia solo en sus clases
    assert.equal((await call('POST', '/attendance/scan', { clientId: s.clientId, academyId: s.academyA.id, siteId: s.siteA1.id }, ana)).body.code, 'NOT_YOUR_CLASS');
    assert.equal((await call('POST', '/attendance/scan', { clientId: s.clientId, academyId: s.academyA.id, siteId: s.siteA1.id, bookingId: s.session.id }, ana)).body.code, 'NOT_YOUR_CLASS');

    // Cancela sus sesiones con la anticipacion definida (48 h); las ajenas no
    await ok('PUT', '/settings', { teacherCancelHours: 48 }, s.admin);
    assert.equal((await ok('GET', '/settings', undefined, s.admin)).teacherCancelHours, 48);
    assert.equal((await call('POST', `/bookings/${soon.id}/cancel`, {}, ana)).body.code, 'CANCEL_DEADLINE');
    assert.equal((await call('POST', `/bookings/${s.session.id}/cancel`, {}, ana)).body.code, 'NOT_YOUR_CLASS');
    await ok('POST', `/bookings/${mine.sessions[0].id}/cancel`, {}, ana);
    // El personal cancela por el y marca que el profesor no pudo asistir
    await ok('POST', `/bookings/${soon.id}/cancel`, { reason: 'other' }, s.admin);

    // Reporte del profesor: solo el suyo
    const from = new Date(Date.now() + OFFSET_MS).toISOString().slice(0, 10);
    const to = new Date(far.getTime() + OFFSET_MS + 86400_000).toISOString().slice(0, 10);
    const rep = await ok('GET', `/reports/teacher?from=${from}&to=${to}&teacherId=${s.teacherIn.id}`, undefined, ana);
    assert.equal(rep.teacher.id, t.id, 'el profesor solo ve su reporte');
    assert.equal(rep.summary.absent, 1);
    assert.equal(rep.summary.cancelled, 1);
    assert.ok(rep.sessions.every((x: any) => 'occupancy' in x && 'attendees' in x && 'capacity' in x));
    assert.equal((await call('GET', `/reports/teacher?from=${from}&to=${to}`, undefined, s.admin)).status, 400);
    const pedro = await ok('GET', `/reports/teacher?from=${from}&to=${to}&teacherId=${s.teacherIn.id}`, undefined, s.admin);
    assert.equal(pedro.teacher.full_name, 'Pedro Interno');
    assert.equal((await call('GET', `/reports/teacher?teacherId=${t.id}`, undefined, s.client)).status, 403);

    // Desactivar al profesor desactiva su usuario
    await ok('PUT', `/teachers/${t.id}`, { fullName: 'Ana Profe', kind: 'internal', siteIds: [s.siteA1.id], active: false }, s.admin);
    assert.equal((await call('GET', '/me', undefined, ana)).status, 401);
  });
  it('el administrador general administra cualquier organizacion: usuarios, clientes y sus parametros (RQ70)', async () => {
    const root = (await ok('POST', '/auth/login', { username: 'admin', password: 'Bogota.2027' })).token;
    const org = (await ok('GET', '/me', undefined, s.admin)).tenant;
    // Solo el administrador general entra a otras organizaciones
    assert.equal((await call('POST', `/platform/tenants/${org.id}/enter`, {}, s.admin)).status, 403);
    const entered = await ok('POST', `/platform/tenants/${org.id}/enter`, {}, root);
    const acting = entered.token;
    assert.equal(entered.user.actingAs.tenantId, org.id);
    assert.equal(entered.user.role, 'admin');
    const me = await ok('GET', '/me', undefined, acting);
    assert.equal(me.tenant.id, org.id);
    assert.ok(me.permissions.includes('notifications') && me.permissions.includes('booking_rules'));
    assert.equal((await call('POST', `/platform/tenants/${org.id}/enter`, {}, acting)).body.code, 'ALREADY_ACTING');

    // Ve y gestiona los usuarios y clientes de esa organizacion
    const staff = await ok('GET', '/users', undefined, acting);
    assert.ok(staff.some((u: any) => u.username === 'admin.uno'));
    const clients = await ok('GET', '/clients?q=Carlos', undefined, acting);
    assert.equal(clients[0].id, s.clientId);
    const prefs = await ok('PUT', `/users/${s.clientId}/notifications`, { dayBefore: false, hoursBefore: true, plan: true }, acting);
    assert.equal(prefs.dayBefore, false);
    assert.equal((await ok('GET', '/me/notifications', undefined, s.client)).dayBefore, false, 'el cliente ve el cambio');
    await ok('PUT', '/settings', { teacherCancelHours: 12 }, acting);
    assert.equal((await ok('GET', '/settings', undefined, s.admin)).teacherCancelHours, 12);
    // Con permiso de clientes se cambian los de un cliente, no los del personal
    const portero = (await ok('POST', '/auth/login', { username: 'portero', password: 'Clave.12345' })).token;
    const adminUno = staff.find((u: any) => u.username === 'admin.uno');
    assert.equal((await call('PUT', `/users/${adminUno.id}/notifications`, { dayBefore: true, hoursBefore: true, plan: true }, portero)).status, 403);
    // Su propia sesion sigue en su organizacion
    assert.equal((await ok('GET', '/me', undefined, root)).actingAs, null);
  });
});
