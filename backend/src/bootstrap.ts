/**
 * Usuario administrador inicial. Al arrancar, si la tabla `users` no tiene el usuario `admin`, se crea con su
 * organizacion, una academia y una sede, y la clave inicial guardada como hash bcrypt (igual que cualquier otro
 * usuario). Es el usuario con el que se configura la conexion de la app (pantalla Servidor) y se cambia su clave
 * desde la app en Mi perfil.
 *
 * Variables de entorno opcionales:
 *   ADMIN_USERNAME          por defecto admin
 *   ADMIN_INITIAL_PASSWORD  por defecto Bogota.2027 (solo se usa al crearlo; cambiarla luego en la app)
 *   ADMIN_ORG_NAME          por defecto "Mi organizacion"
 */
import { CONSENT_VERSION, hashPassword } from './auth.ts';
import type { Db } from './db.ts';
import { joinCode } from './lib/util.ts';
import { upsertPerson } from './routes/auth.ts';

export async function ensureAdmin(db: Db) {
  const username = (process.env.ADMIN_USERNAME ?? 'admin').toLowerCase();
  const [exists] = await db.query(`SELECT id FROM users WHERE username = $1`, [username]);
  if (exists) return false;
  const password = process.env.ADMIN_INITIAL_PASSWORD ?? 'Bogota.2027';
  const org = process.env.ADMIN_ORG_NAME ?? 'Mi organización';
  await db.tx(async (q) => {
    const personId = await upsertPerson(q, `ADMIN-${username}`, 'Administrador');
    const [t] = await q.query(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [org]);
    await q.query(
      `INSERT INTO users (tenant_id, person_id, username, password_hash, full_name, role, consent_at, consent_version)
       VALUES ($1, $2, $3, $4, $5, 'admin', $6, $7)`,
      [t.id, personId, username, await hashPassword(password), 'Administrador', new Date(), CONSENT_VERSION],
    );
    const [a] = await q.query(`INSERT INTO academies (tenant_id, name, join_code) VALUES ($1, $2, $3) RETURNING id`, [t.id, 'Academia principal', joinCode()]);
    await q.query(`INSERT INTO sites (tenant_id, academy_id, name) VALUES ($1, $2, $3)`, [t.id, a.id, 'Sede principal']);
  });
  console.log(`Usuario administrador "${username}" creado en la tabla users (cambia su clave en la app: Mi perfil)`);
  return true;
}
