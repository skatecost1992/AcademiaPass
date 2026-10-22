/**
 * Adaptador de SQL Server (base local). Expone la misma interfaz `Db` que PostgreSQL.
 *
 * El SQL de las rutas esta escrito en un subconjunto comun a PostgreSQL y T-SQL. Lo poco que cambia se traduce
 * aqui antes de enviarlo:
 *   $1 -> @p1 · casts ::tipo -> se quitan · RETURNING -> OUTPUT INSERTED · LIMIT n -> OFFSET/FETCH
 *   true/false -> 1/0 · now() -> SYSDATETIMEOFFSET() · ILIKE -> LIKE
 * Y al leer: DATE -> 'YYYY-MM-DD' y las columnas JSON (opening_hours, permissions) -> objetos.
 *
 * Conexion (variables de entorno, nunca en archivos):
 *   ACADEMIAPASS_SQL_SERVER    servidor (por defecto el nombre del equipo)
 *   ACADEMIAPASS_DB_NAME       base (por defecto AcademiaPass)
 *   ACADEMIAPASS_APP_USER      login (por defecto academiapass_app)
 *   ACADEMIAPASS_APP_PASSWORD  clave del login
 *   ACADEMIAPASS_SQL_PORT      puerto TCP (por defecto 1433)
 */
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import sql from 'mssql';
import type { Db } from './db.ts';

const JSON_COLUMNS = new Set(['opening_hours', 'permissions']);

export const MSSQL_SCHEMA = () => readFileSync(join(import.meta.dirname, '..', 'sql', 'sqlserver', '02_esquema.sql'), 'utf8');

/** Prefija con INSERTED. la lista de columnas de un RETURNING */
const outputList = (cols: string) =>
  cols.split(',').map((c) => {
    const t = c.trim();
    return t === '*' ? 'INSERTED.*' : `INSERTED.${t}`;
  }).join(', ');

export function translate(text: string) {
  let s = text
    .replace(/::[a-z_][a-z0-9_]*(\[\])?/gi, '')
    .replace(/\$(\d+)/g, '@p$1')
    .replace(/\bnow\(\)/gi, 'SYSDATETIMEOFFSET()')
    .replace(/\bILIKE\b/gi, 'LIKE')
    .replace(/\btrue\b/gi, '1')
    .replace(/\bfalse\b/gi, '0')
    .replace(/\bLIMIT\s+(\d+)\s*$/i, 'OFFSET 0 ROWS FETCH NEXT $1 ROWS ONLY');

  const ret = s.match(/\s+RETURNING\s+([\s\S]+?)\s*$/i);
  if (ret) {
    const output = ` OUTPUT ${outputList(ret[1])} `;
    s = s.slice(0, ret.index);
    if (/^\s*INSERT/i.test(s)) {
      // INSERT INTO t (cols) OUTPUT ... VALUES/SELECT ...
      s = s.replace(/^(\s*INSERT\s+INTO\s+[\w.]+\s*\([^)]*\))\s*/i, `$1${output}`);
    } else if (/^\s*UPDATE/i.test(s)) {
      // UPDATE t SET ... OUTPUT ... WHERE ...
      const w = s.search(/\sWHERE\s/i);
      s = w >= 0 ? s.slice(0, w) + output + s.slice(w) : s + output;
    } else if (/^\s*DELETE/i.test(s)) {
      s = s.replace(/^(\s*DELETE\s+FROM\s+[\w.]+)\s*/i, `$1 OUTPUT ${outputList(ret[1]).replace(/INSERTED\./g, 'DELETED.')} `);
    }
  }
  return s;
}

function bind(req: sql.Request, params: unknown[]) {
  params.forEach((v, i) => {
    const name = `p${i + 1}`;
    if (v === undefined || v === null) req.input(name, sql.NVarChar, null);
    else if (Array.isArray(v) || (typeof v === 'object' && !(v instanceof Date))) req.input(name, sql.NVarChar(sql.MAX), JSON.stringify(v));
    else if (typeof v === 'number') req.input(name, Number.isInteger(v) ? sql.Int : sql.Float, v);
    else if (typeof v === 'boolean') req.input(name, sql.Bit, v);
    else if (v instanceof Date) req.input(name, sql.DateTimeOffset, v);
    else req.input(name, sql.NVarChar(sql.MAX), v);
  });
}

function normalize(result: sql.IResult<any>) {
  const rows = result.recordset ?? [];
  if (!rows.length) return [];
  const cols = (rows as any).columns as Record<string, { type: unknown }> | undefined;
  const dateCols = cols ? Object.keys(cols).filter((k) => cols[k].type === sql.Date) : [];
  for (const r of rows) {
    for (const k of dateCols) if (r[k] instanceof Date) r[k] = (r[k] as Date).toISOString().slice(0, 10);
    for (const k of JSON_COLUMNS) if (typeof r[k] === 'string') r[k] = JSON.parse(r[k]);
  }
  return rows;
}

export async function createMssql(): Promise<Db> {
  const password = process.env.ACADEMIAPASS_APP_PASSWORD;
  if (!password) throw new Error('Define ACADEMIAPASS_APP_PASSWORD (clave del login de SQL Server de la aplicacion)');
  const pool = await new sql.ConnectionPool({
    server: process.env.ACADEMIAPASS_SQL_SERVER || hostname(),
    port: Number(process.env.ACADEMIAPASS_SQL_PORT ?? 1433),
    database: process.env.ACADEMIAPASS_DB_NAME || 'AcademiaPass',
    user: process.env.ACADEMIAPASS_APP_USER || 'academiapass_app',
    password,
    options: { encrypt: true, trustServerCertificate: true, useUTC: true },
    pool: { max: 10 },
  }).connect();

  const wrap = (newReq: () => sql.Request, tx: sql.Transaction | null): Db => ({
    async query(text, params = []) {
      const req = newReq();
      bind(req, params);
      const t = translate(text);
      try {
        return normalize(await req.query(t));
      } catch (e) {
        if (process.env.SQL_DEBUG) console.error(`SQL Server rechazo:
${t}
`);
        throw e;
      }
    },
    async exec(text) {
      await newReq().batch(text);
    },
    async tx(fn) {
      if (tx) return fn(wrap(newReq, tx));
      const t = new sql.Transaction(pool);
      await t.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
      try {
        const r = await fn(wrap(() => new sql.Request(t), t));
        await t.commit();
        return r;
      } catch (e) {
        await t.rollback().catch(() => {});
        throw e;
      }
    },
    close: () => pool.close(),
  });
  return wrap(() => pool.request(), null);
}
