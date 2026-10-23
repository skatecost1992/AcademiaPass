import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { HttpError, authenticate } from './auth.ts';
import { type Db, dbInfo } from './db.ts';
import { attendanceRoutes } from './routes/attendance.ts';
import { authRoutes } from './routes/auth.ts';
import { bookingRoutes } from './routes/bookings.ts';
import { commerceRoutes } from './routes/commerce.ts';
import { reportRoutes } from './routes/reports.ts';
import { reservationRoutes } from './routes/reservations.ts';
import { setupRoutes } from './routes/setup.ts';

export function createApp(db: Db) {
  const app = express();
  app.set('trust proxy', 1); // detras del proxy de Render/Railway: IP real para el limite de intentos
  app.disable('x-powered-by');
  app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true }));
  app.use(express.json({ limit: '6mb' })); // fotos en Base64 (RQ29)

  app.get('/api/health', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ ok: true, service: 'academiapass', time: new Date().toISOString(), database: dbInfo });
  });

  // Rutas publicas (login y registro) y luego todo lo demas exige sesion
  app.use('/api', authRoutes(db));
  const api = express.Router();
  api.use(authenticate(db));
  api.use(setupRoutes(db), bookingRoutes(db), reservationRoutes(db), commerceRoutes(db), attendanceRoutes(db), reportRoutes(db));
  app.use('/api', api);
  app.use('/api', (_req, _res) => {
    throw new HttpError(404, 'Ruta no encontrada', 'NOT_FOUND');
  });

  // Version web de la app (RQ1): `npm run build:web` en app-android la exporta a backend/public
  const web = join(import.meta.dirname, '..', 'public');
  if (existsSync(web)) {
    app.use(express.static(web, { extensions: ['html'] }));
    app.get(/.*/, (_req, res) => res.sendFile(join(web, 'index.html')));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, code: err.code, ...err.extra });
    }
    const e = err as { type?: string; status?: number; message?: string };
    if (e?.type === 'entity.too.large') return res.status(413).json({ error: 'La información enviada es demasiado grande', code: 'TOO_LARGE' });
    if (e?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido', code: 'BAD_JSON' });
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor', code: 'INTERNAL' });
  });
  return app;
}
