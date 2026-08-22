import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import { seed } from './seed.js';
import { authRequired } from './middleware/auth.js';
import authModule from './modules/auth.js';
import usersModule from './modules/users.js';
import catalogModule from './modules/catalog.js';
import inventoryModule from './modules/inventory.js';
import posModule from './modules/pos.js';
import salesModule from './modules/sales.js';
import shiftsModule from './modules/shifts.js';
import reportsModule from './modules/reports.js';
import systemModule from './modules/system.js';

seed();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
    },
  },
}));
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || true, credentials: false }));
app.use(express.json({ limit: '2mb' }));

app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false, message: { error: 'طلبات كثيرة، انتظر قليلًا' } }));

app.get('/api/health', (req, res) => res.json({ ok: true, name: 'MIYSARA Ahmed API' }));
app.use('/api/auth', authModule);
app.use('/api', authRequired, usersModule);
app.use('/api', authRequired, catalogModule);
app.use('/api/inventory', authRequired, inventoryModule);
app.use('/api', authRequired, posModule);
app.use('/api', authRequired, salesModule);
app.use('/api', authRequired, shiftsModule);
app.use('/api', authRequired, reportsModule);
app.use('/api/system', authRequired, systemModule);

app.use('/api', (req, res) => res.status(404).json({ error: 'المسار غير موجود' }));

// خدمة الواجهة المبنية (الإنتاج)
const distPath = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath, { maxAge: '1d', index: false }));
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'حدث خطأ داخلي في الخادم' });
});

const PORT = Number(process.env.PORT || 12001);
app.listen(PORT, '0.0.0.0', () => console.log(`MIYSARA API listening on :${PORT}`));
