import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import zlib from 'zlib';
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
app.use('/api/admin/migrate', express.text({ type: () => true, limit: '50mb' }));
app.use(express.json({ limit: '2mb' }));

app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false, message: { error: 'طلبات كثيرة، انتظر قليلًا' } }));

app.get('/api/health', (req, res) => res.json({ ok: true, name: 'MIYSARA Ahmed API' }));

// نقطة نقل بيانات مؤقتة (محمية بمفتاح الإدارة) — تُستخدم لاستيراد المبيعات التاريخية
app.post('/api/admin/import-sales', express.json({ limit: '50mb' }), (req, res) => {
  const key = req.get('x-admin-key') || '';
  if (!process.env.ADMIN_PASSWORD || key !== process.env.ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'غير مصرح' });
  }
  const { invoices = [], items = [], wipe = false } = req.body || {};
  const t = db.transaction(() => {
    if (wipe) {
      db.exec("DELETE FROM invoice_items; DELETE FROM invoices;");
    }
    // INSERT OR IGNORE: idempotent — الدفعة المعاد إرسالها لا تفشل
    const insInv = db.prepare(`INSERT OR IGNORE INTO invoices (invoice_number, created_at, pos_location_id, cashier_id, shift_id, subtotal, discount, total, payment_method, paid_amount, change_amount, status, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const findInv = db.prepare(`SELECT id FROM invoices WHERE invoice_number=?`);
    const delItems = db.prepare(`DELETE FROM invoice_items WHERE invoice_id=?`);
    const insItem = db.prepare(`INSERT INTO invoice_items (invoice_id, variant_id, product_name, size, color, quantity, unit_price, cost_price, discount, total, returned_qty) VALUES (?,?,?,?,?,?,?,?,?,?,0)`);
    const idMap = new Map();
    for (const v of invoices) {
      const cur = insInv.run(v.invoice_number, v.created_at, v.pos_location_id, v.cashier_id, v.shift_id, v.subtotal, v.discount, v.total, v.payment_method, v.paid_amount, v.change_amount, v.status, v.notes);
      const iid = cur.changes ? cur.lastInsertRowid : findInv.get(v.invoice_number)?.id;
      if (iid) { idMap.set(v.temp_id, iid); delItems.run(iid); }
    }
    for (const it of items) {
      const iid = idMap.get(it.invoice_temp_id);
      if (!iid) continue;
      insItem.run(iid, it.variant_id, it.product_name, it.size, it.color, it.quantity, it.unit_price, it.cost_price, it.discount, it.total);
    }
    return { invoices: invoices.length, items: items.length };
  });
  try {
    const r = t();
    res.json({ ok: true, ...r, total_invoices: db.prepare('SELECT COUNT(*) c FROM invoices').get().c });
  } catch (e) {
    res.status(500).json({ error: e.message.slice(0, 300) });
  }
});

// استعادة البيانات القديمة لمرة واحدة عند أول تشغيل (تُعاد بعد كل نشر إن لم تُنقل)
async function restoreLegacy() {
  const count = db.prepare('SELECT COUNT(*) c FROM products').get().c;
  if (count > 0) return;
  const sqlPath = new URL('../../old_data/migration.sql', import.meta.url);
  const gzPath = new URL('../../old_data/migration.sql.gz', import.meta.url);
  try {
    let text;
    if (fs.existsSync(gzPath)) text = zlib.gunzipSync(fs.readFileSync(gzPath)).toString('utf8');
    else if (fs.existsSync(sqlPath)) text = fs.readFileSync(sqlPath, 'utf8');
    else return;
    db.exec(text);
    const c = db.prepare('SELECT COUNT(*) c FROM products').get().c;
    console.log(`✔ تمت استعادة البيانات القديمة: ${c} منتجًا`);
  } catch (e) {
    console.error('فشلت استعادة البيانات القديمة:', e.message.slice(0, 200));
  }
}
await restoreLegacy();
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
