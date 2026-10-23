/**
 * Datos de demostracion: `npm run seed`. Crea (si no existe) la organizacion "Academias Demo" usando la propia
 * API, con dos academias, sedes, espacios, clases de hoy, planes y clientes con planes y asistencias.
 *
 *   Administrador: admin.demo   / Demo.2026
 *   Personal:      recepcion.demo / Demo.2026 (registrar asistencias)
 *   Clientes:      cliente.demo / Demo.2026 · cliente2.demo / Demo.2026
 */
import type { AddressInfo } from 'node:net';
import { createApp } from './app.ts';
import { openDb } from './db.ts';

const PASS = 'Demo.2026';
const db = await openDb();
const [exists] = await db.query(`SELECT 1 FROM users WHERE username = 'admin.demo'`);
if (exists) {
  console.log('La organización demo ya existe (usuario admin.demo).');
  await db.close();
  process.exit(0);
}

const server = createApp(db).listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
let token = '';
async function call<T = any>(method: string, path: string, body?: unknown, t = token): Promise<T> {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${data.error}`);
  return data;
}

const allWeek = [1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '05:00', close: '22:00' })).concat([{ day: 0, open: '07:00', close: '14:00' }]);
/** Hoy a la hora local de Bogota indicada */
const at = (h: number, m = 0, dayOffset = 0) => {
  const d = new Date(Date.now() - 5 * 3600_000 + dayOffset * 86400_000).toISOString().slice(0, 10);
  return new Date(`${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-05:00`).toISOString();
};

try {
  await call('POST', '/auth/register-admin', {
    username: 'admin.demo', password: PASS, fullName: 'Administrador Demo', document: 'DEMO-1', email: 'admin@demo.co',
    organization: 'Academias Demo', academyName: 'Danza Urbana', siteName: 'Sede Norte', consent: true,
  }, '');
  // RQ58: la organizacion queda pendiente; el demo la activa directamente en la base
  await db.query(`UPDATE tenants SET status = 'active', reviewed_at = $1 WHERE name = 'Academias Demo'`, [new Date()]);
  const admin = await call('POST', '/auth/login', { username: 'admin.demo', password: PASS }, '');
  token = admin.token;
  const danza = admin.user.academies[0];
  const [norte] = await call('GET', '/sites');
  await call('PUT', `/sites/${norte.id}`, { academyId: danza.id, name: 'Sede Norte', address: 'Calle 140 # 15-20', openingHours: allWeek });
  const sur = await call('POST', '/sites', { academyId: danza.id, name: 'Sede Sur', address: 'Av. 68 # 5-10', openingHours: allWeek });
  const yoga = await call('POST', '/academies', { name: 'Yoga Vital', description: 'Yoga y pilates' });
  const centro = await call('POST', '/sites', { academyId: yoga.id, name: 'Sede Centro', address: 'Cra 7 # 45-12', openingHours: allWeek });

  const salon1 = await call('POST', '/spaces', { siteId: norte.id, name: 'Salón 1', maxCapacity: 20 });
  const cancha = await call('POST', '/spaces', { siteId: norte.id, name: 'Terraza', maxCapacity: 30, allowMultiGroup: true, maxGroups: 2, capacityPerGroup: 15 });
  const salonSur = await call('POST', '/spaces', { siteId: sur.id, name: 'Salón Sur', maxCapacity: 15 });
  const salaYoga = await call('POST', '/spaces', { siteId: centro.id, name: 'Sala Zen', maxCapacity: 12 });

  const pedro = await call('POST', '/teachers', { fullName: 'Pedro Gómez', kind: 'internal', specialty: 'Salsa y bachata', siteIds: [norte.id, sur.id] });
  const laura = await call('POST', '/teachers', { fullName: 'Laura Ríos', kind: 'external', specialty: 'Pilates', siteIds: [norte.id] });
  const ana = await call('POST', '/teachers', { fullName: 'Ana Torres', kind: 'internal', specialty: 'Yoga', siteIds: [centro.id] });

  const salsa = await call('POST', '/classes', { academyId: danza.id, teacherId: pedro.id, spaceId: salon1.id, name: 'Salsa principiantes', defaultCapacity: 15 });
  const urbano = await call('POST', '/classes', { academyId: danza.id, teacherId: pedro.id, spaceId: salonSur.id, name: 'Danza urbana', defaultCapacity: 12 });
  const hatha = await call('POST', '/classes', { academyId: yoga.id, teacherId: ana.id, spaceId: salaYoga.id, name: 'Hatha yoga', defaultCapacity: 10 });

  const now = new Date();
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', hour: '2-digit', hourCycle: 'h23' }).format(now));
  const startH = Math.min(Math.max(h, 6), 20); // una clase "en curso" para probar el escaner
  const [salsaHoy] = await call('POST', '/bookings', { spaceId: salon1.id, kind: 'class', classId: salsa.id, startsAt: at(startH), endsAt: at(startH + 1, 30), repeatWeeks: 4 });
  await call('POST', '/bookings', { spaceId: salonSur.id, kind: 'class', classId: urbano.id, startsAt: at(18, 0, 1), endsAt: at(19, 0, 1), repeatWeeks: 4 });
  const [yogaHoy] = await call('POST', '/bookings', { spaceId: salaYoga.id, kind: 'class', classId: hatha.id, startsAt: at(startH), endsAt: at(startH + 1), repeatWeeks: 4 });
  await call('POST', '/bookings', { spaceId: cancha.id, kind: 'rental', teacherId: laura.id, title: 'Pilates de Laura (externo)', startsAt: at(9, 0, 1), endsAt: at(10, 0, 1), groupSize: 10 });

  const planDanza = await call('POST', '/plans', { name: 'Danza 12 clases', kind: 'classes', units: 12, validityDays: 30, price: 150000, academyIds: [danza.id], allSites: true });
  await call('POST', '/plans', { name: 'Danza Norte 8 clases', kind: 'classes', units: 8, validityDays: 30, price: 110000, academyIds: [danza.id], allSites: false, siteIds: [norte.id] });
  const planCombo = await call('POST', '/plans', { name: 'Combo Danza + Yoga ilimitado', kind: 'mixed', validityDays: 30, price: 260000, academyIds: [danza.id, yoga.id], allSites: true });
  const planYoga = await call('POST', '/plans', { name: 'Yoga 4 clases', kind: 'classes', units: 4, validityDays: 30, price: 60000, academyIds: [yoga.id], allSites: true });

  await call('POST', '/users', { username: 'recepcion.demo', password: PASS, fullName: 'Recepción Norte', document: 'DEMO-2', permissions: ['attendance', 'bookings'] });

  const c1 = await call('POST', '/auth/register-client', { username: 'cliente.demo', password: PASS, fullName: 'Camila Pérez', document: 'DEMO-10', email: 'camila@demo.co', joinCode: danza.join_code, consent: true }, '');
  await call('POST', '/memberships', { clientId: c1.user.id, planId: planDanza.id, payment: { amount: 150000, method: 'nequi' } });
  await call('POST', '/memberships', { clientId: c1.user.id, planId: planYoga.id, payment: { amount: 60000, method: 'efectivo' } });
  const { id: c2 } = await call('POST', '/clients', { username: 'cliente2.demo', password: PASS, fullName: 'Julián Mora', document: 'DEMO-11', academyIds: [danza.id], homeSiteId: norte.id });
  await call('POST', '/memberships', { clientId: c2, planId: planCombo.id, payment: { amount: 200000, method: 'transferencia', reference: 'TRX-1001' } });

  // Ingresos de ejemplo: solo se pueden validar el dia de la clase desde 1 h antes hasta el final (RQ39); fuera
  // de esa ventana (seed corrido de noche) se omiten
  try {
    await call('POST', '/attendance/scan', { clientId: c1.user.id, academyId: danza.id, siteId: norte.id, bookingId: salsaHoy.id });
    await call('POST', '/attendance/scan', { clientId: c1.user.id, academyId: yoga.id, siteId: centro.id, bookingId: yogaHoy.id });
    await call('POST', '/attendance/scan', { clientId: c2, academyId: danza.id, siteId: norte.id, bookingId: salsaHoy.id });
  } catch (e) {
    console.log(`  (Ingresos de ejemplo omitidos: ${(e as Error).message})`);
  }

  console.log('Organización demo creada.');
  console.log(`  admin.demo / ${PASS}   recepcion.demo / ${PASS}   cliente.demo / ${PASS}   cliente2.demo / ${PASS}`);
  console.log(`  Códigos de academia: Danza Urbana ${danza.join_code} · Yoga Vital ${yoga.join_code}`);
} finally {
  server.close();
  await db.close();
}
