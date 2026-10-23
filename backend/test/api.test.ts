/**
 * Prueba de punta a punta de la API con PGlite en memoria: recorre los requisitos principales.
 * Ejecutar: npm test
 */
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

process.env.PGLITE_DIR = 'memory://';
process.env.JWT_SECRET = 'test-secret';
const { createApp } = await import('../src/app.ts');
const { openDb } = await import('../src/db.ts');
const { ensureAdmin } = await import('../src/bootstrap.ts');
const { describePg } = await import('../src/db.ts');

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

/** Fecha ISO de hoy a la hora local indicada (America/Bogota, UTC-5) */
const todayAt = (h: number, m = 0) => {
  const local = new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
  return new Date(`${local}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-05:00`).toISOString();
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
    assert.equal(h.database.engine, 'PostgreSQL');
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

  it('registra un administrador con su organizacion, academia y sede (RQ23)', async () => {
    const r = await ok('POST', '/auth/register-admin', {
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
    s.teacherIn = await ok('POST', '/teachers', { fullName: 'Pedro Interno', kind: 'internal' }, s.admin);
    s.teacherExt = await ok('POST', '/teachers', { fullName: 'Laura Externa', kind: 'external' }, s.admin);
    s.salsa = await ok('POST', '/classes', { academyId: s.academyA.id, teacherId: s.teacherIn.id, name: 'Salsa', defaultCapacity: 2 }, s.admin);

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
    const other = await ok('POST', '/auth/register-admin', { username: 'admin.dos', password: 'Clave.12345', fullName: 'Beto', document: '5005', organization: 'Org Dos', academyName: 'Box', consent: true });
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
    const site = await ok('POST', '/sites', { academyId: tmp.id, name: 'Sede temporal' }, s.admin);
    const space = await ok('POST', '/spaces', { siteId: site.id, name: 'Sala', maxCapacity: 5 }, s.admin);
    const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    await ok('POST', '/photos', { ownerType: 'site', ownerId: site.id, mime: 'image/png', data: pixel }, s.admin);
    const cls = await ok('POST', '/classes', { academyId: tmp.id, name: 'Clase temporal', defaultCapacity: 3 }, s.admin);
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

  it('el cliente reserva un espacio y ve las reservas ajenas sin datos personales', async () => {
    const start = new Date(Date.now() + 26 * 3600_000);
    start.setUTCHours(15, 0, 0, 0); // 10:00 en Bogota
    const body = { spaceId: s.yogaRoom.id, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3600_000).toISOString(), groupSize: 2 };
    // RQ31: sin un plan de reservas que incluya la sede no puede reservar
    assert.equal((await call('POST', '/me/bookings', body, s.client)).body.code, 'NO_PLAN');
    const planRes = await ok('POST', '/plans', { name: 'Reservas Yoga', kind: 'reservations', units: 4, validityDays: 30, price: 50000, academyIds: [s.academyB.id], allSites: true }, s.admin);
    const mRes = await ok('POST', '/memberships', { clientId: s.clientId, planId: planRes.id }, s.admin);
    const b = await ok('POST', '/me/bookings', body, s.client);
    assert.equal(b.kind, 'rental');
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
    const day = new Date(start.getTime() - 5 * 3600_000).toISOString().slice(0, 10);
    const listAdmin = await ok('GET', `/bookings?from=${day}&to=${day}&spaceId=${s.yogaRoom.id}`, undefined, s.admin);
    assert.equal(listAdmin[0].client_name, 'Carlos Cliente');
    assert.equal(listAdmin[0].paid, 30000);
  });
});
