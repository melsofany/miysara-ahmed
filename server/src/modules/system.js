import { Router } from 'express';
import db, { getSetting, setSetting } from '../db.js';
import { requirePermission } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';

const router = Router();

const EDITABLE_SETTINGS = ['store_name', 'receipt_footer', 'currency', 'allow_negative_stock'];

router.get('/settings', requirePermission('settings.manage'), (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

router.put('/settings', requirePermission('settings.manage'), (req, res) => {
  const changes = {};
  for (const key of EDITABLE_SETTINGS) {
    if (req.body[key] !== undefined) {
      const old = getSetting(key);
      setSetting(key, req.body[key]);
      changes[key] = { old, new: String(req.body[key]) };
    }
  }
  audit(req, { action: 'update', entity: 'settings', newData: changes });
  res.json({ ok: true });
});

router.get('/audit-logs', requirePermission('audit.view'), (req, res) => {
  const { entity, entity_id, user_id, from, to, action } = req.query;
  let sql = `SELECT a.*, u.full_name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE 1=1`;
  const args = [];
  if (entity) { sql += ' AND a.entity=?'; args.push(entity); }
  if (entity_id) { sql += ' AND a.entity_id=?'; args.push(entity_id); }
  if (user_id) { sql += ' AND a.user_id=?'; args.push(user_id); }
  if (action) { sql += ' AND a.action=?'; args.push(action); }
  if (from) { sql += ' AND a.created_at >= ?'; args.push(from + ' 00:00:00'); }
  if (to) { sql += ' AND a.created_at <= ?'; args.push(to + ' 23:59:59'); }
  sql += ' ORDER BY a.id DESC LIMIT 500';
  res.json(db.prepare(sql).all(...args));
});

export default router;
