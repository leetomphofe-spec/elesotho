import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { pool } from './db.js';
import { migrate } from './migrate.js';
import { errorHandler, HttpError } from './lib/http.js';
import { loadSession, csrfGuard } from './middleware/auth.js';
import { lazyAutomation, runAutomation, startScheduler } from './lib/automation.js';
import authRoutes from './routes/auth.js';
import catalogueRoutes from './routes/catalogue.js';
import citizenRoutes from './routes/citizen.js';
import applicationRoutes from './routes/applications.js';
import staffRoutes from './routes/staff.js';
import accessRoutes from './routes/access.js';
import auditRoutes from './routes/audit.js';
import adminRoutes from './routes/admin.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.set('trust proxy', 1); // Render sits behind a proxy
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
    },
  },
}));
app.use(express.json({ limit: '6mb' }));
app.use(cookieParser());

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, time: new Date().toISOString() });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.use('/api', loadSession, csrfGuard, lazyAutomation);
app.use('/api/auth', authRoutes);
app.use('/api/catalogue', catalogueRoutes);
app.use('/api/citizen', citizenRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/access-requests', accessRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'This API endpoint does not exist.')));

// Serve the built React app (single Render web service)
const clientDist = path.join(here, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.use(errorHandler);

async function start() {
  await migrate();
  app.listen(config.port, () => console.log(`[server] listening on ${config.port}`));
  runAutomation('startup').then((r) => console.log('[automation] startup', r)).catch(() => {});
  startScheduler();
}

start().catch((err) => {
  console.error('[server] failed to start', err);
  process.exit(1);
});
