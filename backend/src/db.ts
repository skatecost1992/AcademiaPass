/**
 * Acceso a la base de datos PostgreSQL.
 *
 * - Con DATABASE_URL (nube: Neon, Render, Supabase...) usa el driver `pg`.
 * - Sin DATABASE_URL usa PGlite, un PostgreSQL embebido que guarda los datos en `.data/` (o en memoria con
 *   PGLITE_DIR=memory://). Sirve para desarrollar y para las pruebas sin instalar PostgreSQL.
 *
 * Las dos variantes exponen la misma interfaz `Db` y ejecutan exactamente el mismo SQL.
 */
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import { SCHEMA } from './schema.ts';

export interface Db {
  /** Ejecuta una consulta parametrizada ($1, $2...) y devuelve las filas */
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Ejecuta varias sentencias sin parametros (esquema) */
  exec(sql: string): Promise<void>;
  /** Ejecuta `fn` dentro de una transaccion: si lanza un error se revierte todo */
  tx<R>(fn: (q: Db) => Promise<R>): Promise<R>;
  close(): Promise<void>;
}

// Las fechas sin hora (date) se devuelven como texto 'YYYY-MM-DD' para no depender de la zona horaria
const DATE_OID = 1082;
const NUMERIC_OID = 1700;
const INT8_OID = 20;

async function createPg(url: string): Promise<Db> {
  pg.types.setTypeParser(DATE_OID, (v) => v);
  pg.types.setTypeParser(NUMERIC_OID, (v) => Number(v));
  pg.types.setTypeParser(INT8_OID, (v) => Number(v));
  const ssl = /localhost|127\.0\.0\.1/.test(url) || process.env.PGSSL === 'off' ? undefined : { rejectUnauthorized: false };
  const pool = new pg.Pool({ connectionString: url, ssl, max: Number(process.env.PG_POOL_MAX ?? 5) });

  const wrap = (client: pg.Pool | pg.PoolClient): Db => ({
    async query(sql, params = []) {
      return (await client.query(sql, params as any[])).rows;
    },
    async exec(sql) {
      await client.query(sql);
    },
    async tx(fn) {
      if (client !== pool) return fn(wrap(client)); // ya estamos en una transaccion
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const r = await fn(wrap(c));
        await c.query('COMMIT');
        return r;
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    },
    close: () => pool.end(),
  });
  return wrap(pool);
}

async function createPglite(dir: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (!dir.includes('://')) mkdirSync(dir, { recursive: true });
  const parsers = {
    [DATE_OID]: (v: string) => v,
    [NUMERIC_OID]: (v: string) => Number(v),
    [INT8_OID]: (v: string) => Number(v),
  };
  const lite = await PGlite.create(dir, { parsers });

  type Q = { query: typeof lite.query; exec: typeof lite.exec };
  const wrap = (client: Q, inTx: boolean): Db => ({
    async query(sql, params = []) {
      return (await client.query(sql, params as any[])).rows as any[];
    },
    async exec(sql) {
      await client.exec(sql);
    },
    async tx(fn) {
      if (inTx) return fn(wrap(client, true));
      return lite.transaction((t) => fn(wrap(t as unknown as Q, true)));
    },
    close: () => lite.close(),
  });
  return wrap(lite, false);
}

export type Dialect = 'postgres' | 'mssql';
/** Motor en uso. Casi todo el SQL es comun; las pocas diferencias las resuelve createMssql al traducir */
export let dialect: Dialect = 'postgres';

/** Motor y ubicacion de la base para mostrar en la app (nunca usuario ni clave) */
export let dbInfo: { engine: string; provider: string; host: string; database: string } = { engine: 'PostgreSQL', provider: 'PGlite', host: 'local', database: '' };

export function describePg(url: string) {
  try {
    const u = new URL(url);
    const provider = /neon\.tech$/.test(u.hostname) ? 'Neon' : /render\.com$|^dpg-/.test(u.hostname) ? 'Render' : /supabase/.test(u.hostname) ? 'Supabase' : 'PostgreSQL';
    return { engine: 'PostgreSQL', provider, host: u.hostname, database: u.pathname.replace(/^\//, '') };
  } catch {
    return { engine: 'PostgreSQL', provider: 'PostgreSQL', host: '', database: '' };
  }
}

/**
 * Motor elegido por variables de entorno:
 *  - DB_CLIENT=mssql      -> SQL Server (base local, ver sql/sqlserver/ y docs/SERVIDORES_Y_BASE_LOCAL.md)
 *  - DATABASE_URL=...     -> PostgreSQL (nube)
 *  - ninguna              -> PGlite en PGLITE_DIR
 */
export async function openDb(): Promise<Db> {
  if ((process.env.DB_CLIENT ?? '').toLowerCase() === 'mssql') {
    dialect = 'mssql';
    const { createMssql, MSSQL_SCHEMA } = await import('./db-mssql.ts');
    const db = await createMssql();
    await db.exec(MSSQL_SCHEMA());
    dbInfo = {
      engine: 'SQL Server', provider: 'SQL Server',
      host: process.env.ACADEMIAPASS_SQL_SERVER || (await import('node:os')).hostname(),
      database: process.env.ACADEMIAPASS_DB_NAME || 'AcademiaPass',
    };
    return db;
  }
  dialect = 'postgres';
  const url = process.env.DATABASE_URL;
  dbInfo = url ? describePg(url) : { engine: 'PostgreSQL', provider: 'PGlite', host: 'local', database: process.env.PGLITE_DIR ?? './.data/pglite' };
  const db = url ? await createPg(url) : await createPglite(process.env.PGLITE_DIR ?? './.data/pglite');
  await db.exec(SCHEMA);
  return db;
}
