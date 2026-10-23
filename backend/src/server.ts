import { createApp } from './app.ts';
import { ensureAdmin } from './bootstrap.ts';
import { dialect, openDb } from './db.ts';
import { dispatchNotifications } from './lib/notifications.ts';
import { settleMissedReservations } from './lib/scheduling.ts';

const db = await openDb();
await ensureAdmin(db);
// RQ52: cada 5 minutos se descuentan del plan los cupos reservados y no tomados de clases ya terminadas
const settle = () => settleMissedReservations(db).catch((e) => console.error('Liquidacion de inasistencias:', e));
void settle();
setInterval(settle, 5 * 60_000).unref();
// RQ63, RQ64: cada 5 minutos se envian los recordatorios y los avisos de vencimiento de plan pendientes
const notify = () => dispatchNotifications(db).catch((e) => console.error('Correos automaticos:', e));
void notify();
setInterval(notify, 5 * 60_000).unref();
const port = Number(process.env.PORT ?? 8080);
createApp(db).listen(port, () => {
  console.log(`AcademiaPass API en http://localhost:${port} (${dialect === 'mssql' ? 'SQL Server' : process.env.DATABASE_URL ? 'PostgreSQL' : 'PGlite local'})`);
});
