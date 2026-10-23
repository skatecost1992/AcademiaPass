import { createApp } from './app.ts';
import { ensureAdmin } from './bootstrap.ts';
import { dialect, openDb } from './db.ts';
import { settleMissedReservations } from './lib/scheduling.ts';

const db = await openDb();
await ensureAdmin(db);
// RQ52: cada 5 minutos se descuentan del plan los cupos reservados y no tomados de clases ya terminadas
const settle = () => settleMissedReservations(db).catch((e) => console.error('Liquidacion de inasistencias:', e));
void settle();
setInterval(settle, 5 * 60_000).unref();
const port = Number(process.env.PORT ?? 8080);
createApp(db).listen(port, () => {
  console.log(`AcademiaPass API en http://localhost:${port} (${dialect === 'mssql' ? 'SQL Server' : process.env.DATABASE_URL ? 'PostgreSQL' : 'PGlite local'})`);
});
