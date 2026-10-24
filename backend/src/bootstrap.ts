/**
 * Usuario administrador inicial. Al arrancar, si la tabla `users` no tiene el usuario `admin`, se crea con su
 * organizacion, una academia y una sede, y la clave inicial guardada como hash bcrypt (igual que cualquier otro
 * usuario). Es el usuario con el que se configura la conexion de la app (pantalla Servidor) y se cambia su clave
 * desde la app en Mi perfil.
 *
 * Variables de entorno opcionales:
 *   ADMIN_USERNAME          por defecto admin
 *   ADMIN_INITIAL_PASSWORD  clave al crearlo (minimo 8 caracteres). Sin ella se genera una al azar y se escribe una
 *                           sola vez en el registro del servidor. No hay clave por defecto: es el administrador general
 *   ADMIN_ORG_NAME          por defecto "Mi organizacion"
 */
import { randomBytes } from 'node:crypto';
import { CONSENT_VERSION, checkPassword, hashPassword } from './auth.ts';
import type { Db } from './db.ts';
import { joinCode } from './lib/util.ts';
import { upsertPerson } from './routes/auth.ts';

/** Clave que traian las versiones anteriores; si el admin aun la usa se avisa en cada arranque */
const OLD_DEFAULT_PASSWORD = 'Bogota.2027';

function initialPassword() {
  const env = process.env.ADMIN_INITIAL_PASSWORD;
  if (env) {
    if (env.length < 8) throw new Error('ADMIN_INITIAL_PASSWORD debe tener al menos 8 caracteres');
    return { password: env, generated: false };
  }
  return { password: randomBytes(12).toString('base64url'), generated: true };
}

export async function ensureAdmin(db: Db) {
  const username = (process.env.ADMIN_USERNAME ?? 'admin').toLowerCase();
  const [exists] = await db.query(`SELECT id, password_hash FROM users WHERE username = $1`, [username]);
  if (exists) {
    // RQ58: el usuario base es el administrador general (activa las organizaciones nuevas)
    await db.query(`UPDATE users SET is_superadmin = true WHERE id = $1`, [exists.id]);
    if (await checkPassword(OLD_DEFAULT_PASSWORD, exists.password_hash)) {
      console.warn(`ATENCION: el usuario "${username}" (administrador general) aun tiene la clave por defecto de versiones anteriores. Cambiala ya en la app: Mi perfil -> Contraseña.`);
    }
    return false;
  }
  const { password, generated } = initialPassword();
  const org = process.env.ADMIN_ORG_NAME ?? 'Mi organización';
  await db.tx(async (q) => {
    const personId = await upsertPerson(q, `ADMIN-${username}`, 'Administrador');
    const [t] = await q.query(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [org]);
    await q.query(
      `INSERT INTO users (tenant_id, person_id, username, password_hash, full_name, role, consent_at, consent_version, is_superadmin)
       VALUES ($1, $2, $3, $4, $5, 'admin', $6, $7, true)`,
      [t.id, personId, username, await hashPassword(password), 'Administrador', new Date(), CONSENT_VERSION],
    );
    const [a] = await q.query(`INSERT INTO academies (tenant_id, name, join_code) VALUES ($1, $2, $3) RETURNING id`, [t.id, 'Academia principal', joinCode()]);
    await q.query(`INSERT INTO sites (tenant_id, academy_id, name) VALUES ($1, $2, $3)`, [t.id, a.id, 'Sede principal']);
  });
  console.log(generated
    ? `Usuario administrador "${username}" creado con la clave inicial: ${password}  (se muestra solo esta vez; cambiala en la app: Mi perfil)`
    : `Usuario administrador "${username}" creado con la clave de ADMIN_INITIAL_PASSWORD (cambiala en la app: Mi perfil)`);
  return true;
}
