import { createApp } from './app.ts';
import { ensureAdmin } from './bootstrap.ts';
import { dialect, openDb } from './db.ts';

const db = await openDb();
await ensureAdmin(db);
const port = Number(process.env.PORT ?? 8080);
createApp(db).listen(port, () => {
  console.log(`AcademiaPass API en http://localhost:${port} (${dialect === 'mssql' ? 'SQL Server' : process.env.DATABASE_URL ? 'PostgreSQL' : 'PGlite local'})`);
});
