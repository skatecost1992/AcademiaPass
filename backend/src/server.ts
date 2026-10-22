import { createApp } from './app.ts';
import { openDb } from './db.ts';

const db = await openDb();
const port = Number(process.env.PORT ?? 8080);
createApp(db).listen(port, () => {
  console.log(`AcademiaPass API en http://localhost:${port} (${process.env.DATABASE_URL ? 'PostgreSQL' : 'PGlite local'})`);
});
