import { Router } from 'express';
import db from '../db.js';
import { requirePermission } from '../middleware/auth.js';
import { audit, badRequest, notFound, validate } from '../middleware/audit.js';

const router = Router();

// ---------- نقاط البيع ----------
router.get('/pos-locations', requirePermission('pos.manage', 'pos.sell', 'reports.view'), (req, res) => {
  let rows = db.prepare(`
    SELECT pl.*, (SELECT COUNT(*) FROM user_pos_locations up WHERE up.pos_location_id=pl.id) AS users_count
    FROM pos_locations pl ORDER BY pl.id`).all();
  if (req.user.posIds.length && !req.user.has('pos.manage')) rows = rows.filter(p => req.user.posIds.includes(p.id));
  res.json(rows);
});
router.post('/pos-locations', requirePermission('pos.manage'), (req, res) => {
  const { errors, data } = validate(req.body, {
    name: { required: true, label: 'اسم نقطة البيع', maxLen: 150 },
    code: { required: true, label: 'الكود', maxLen: 30 },
    address: { maxLen: 255, default: '' },
  });
  if (errors.length) return badRequest(res, errors.join('، '));
  try {
    const info = db.prepare('INSERT INTO pos_locations(name,code,address) VALUES (?,?,?)').run(data.name, data.code, data.address);
    audit(req, { action: 'create', entity: 'pos_locations', entityId: info.lastInsertRowid, newData: data });
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return badRequest(res, 'كود نقطة البيع مستخدم من قبل');
    throw e;
  }
});
router.put('/pos-locations/:id', requirePermission('pos.manage'), (req, res) => {
  const old = db.prepare('SELECT * FROM pos_locations WHERE id=?').get(req.params.id);
  if (!old) return notFound(res, 'نقطة البيع غير موجودة');
  const { errors, data } = validate(req.body, {
    name: { required: true, label: 'اسم نقطة البيع', maxLen: 150 },
    code: { required: true, label: 'الكود', maxLen: 30 },
    address: { maxLen: 255, default: old.address ?? '' },
    is_active: { type: 'boolean', default: old.is_active },
  });
  if (errors.length) return badRequest(res, errors.join('، '));
  try {
    db.prepare('UPDATE pos_locations SET name=?, code=?, address=?, is_active=? WHERE id=?').run(data.name, data.code, data.address, data.is_active, old.id);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return badRequest(res, 'كود نقطة البيع مستخدم من قبل');
    throw e;
  }
  audit(req, { action: 'update', entity: 'pos_locations', entityId: old.id, oldData: old, newData: data });
  res.json({ ok: true });
});
router.get('/pos-locations/:id/users', requirePermission('pos.manage'), (req, res) => {
  const rows = db.prepare(`SELECT u.id, u.username, u.full_name, u.is_active, r.name_ar AS role_name
    FROM user_pos_locations up JOIN users u ON u.id=up.user_id JOIN roles r ON r.id=u.role_id
    WHERE up.pos_location_id=?`).all(req.params.id);
  res.json(rows);
});

// ---------- بحث POS المتقدم ----------
// يدعم: barcode/sku/اسم/تصنيف/موسم/مورد/ماركة/موديل/وصف/مقاس/لون/سعر — ويعرض رصيد نقطة البيع
router.get('/pos/:id/search', requirePermission('pos.sell'), (req, res) => {
  const posId = Number(req.params.id);
  if (!req.user.canAccessPos(posId)) return res.status(403).json({ error: 'غير مصرح لك بنقطة البيع هذه' });
  const pos = db.prepare('SELECT * FROM pos_locations WHERE id=? AND is_active=1').get(posId);
  if (!pos) return notFound(res, 'نقطة البيع غير موجودة أو معطلة');

  const { q, barcode, sku, name, category_id, season_id, supplier_id, manufacturer_id, model_number, description, size, color, min_price, max_price, in_stock } = req.query;
  let sql = `SELECT v.id AS variant_id, v.sku, v.barcode, v.size, v.color, v.selling_price, v.cost_price,
      p.id AS product_id, p.name AS product_name, p.model_number, p.image,
      c.name AS category_name, pc.name AS parent_category_name, s.name AS season_name,
      sup.name AS supplier_name, m.name AS manufacturer_name,
      COALESCE(sl.quantity, 0) AS pos_stock
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN categories pc ON pc.id = c.parent_id
    LEFT JOIN seasons s ON s.id = p.season_id
    LEFT JOIN suppliers sup ON sup.id = p.supplier_id
    LEFT JOIN manufacturers m ON m.id = p.manufacturer_id
    LEFT JOIN stock_levels sl ON sl.variant_id = v.id AND sl.location_type='pos' AND sl.location_id = ?
    WHERE v.is_active=1 AND p.is_active=1`;
  const args = [posId];
  if (barcode) { sql += ' AND v.barcode = ?'; args.push(String(barcode).trim()); }
  if (sku) { sql += ' AND v.sku LIKE ?'; args.push(`%${String(sku).trim()}%`); }
  if (q) { sql += ' AND (p.name LIKE ? OR v.sku LIKE ? OR v.barcode LIKE ? OR p.model_number LIKE ?)'; const like = `%${q}%`; args.push(like, like, like, like); }
  if (name) { sql += ' AND p.name LIKE ?'; args.push(`%${name}%`); }
  if (category_id) { sql += ' AND (p.category_id=? OR c.parent_id=?)'; args.push(category_id, category_id); }
  if (season_id) { sql += ' AND p.season_id=?'; args.push(season_id); }
  if (supplier_id) { sql += ' AND p.supplier_id=?'; args.push(supplier_id); }
  if (manufacturer_id) { sql += ' AND p.manufacturer_id=?'; args.push(manufacturer_id); }
  if (model_number) { sql += ' AND p.model_number LIKE ?'; args.push(`%${model_number}%`); }
  if (description) { sql += ' AND p.description LIKE ?'; args.push(`%${description}%`); }
  if (size) { sql += ' AND v.size LIKE ?'; args.push(`%${size}%`); }
  if (color) { sql += ' AND v.color LIKE ?'; args.push(`%${color}%`); }
  if (min_price) { sql += ' AND v.selling_price >= ?'; args.push(Number(min_price)); }
  if (max_price) { sql += ' AND v.selling_price <= ?'; args.push(Number(max_price)); }
  if (in_stock === '1') sql += ' AND COALESCE(sl.quantity,0) > 0';
  sql += ' ORDER BY p.name LIMIT 100';
  let rows = db.prepare(sql).all(...args);
  if (!req.user.has('cost.view')) rows = rows.map(({ cost_price, ...r }) => r);
  res.json(rows);
});

// بحث سريع بالباركود (للماسح الضوئي)
router.get('/pos/:id/scan/:barcode', requirePermission('pos.sell'), (req, res) => {
  const posId = Number(req.params.id);
  if (!req.user.canAccessPos(posId)) return res.status(403).json({ error: 'غير مصرح لك بنقطة البيع هذه' });
  const row = db.prepare(`SELECT v.id AS variant_id, v.sku, v.barcode, v.size, v.color, v.selling_price,
      p.id AS product_id, p.name AS product_name, COALESCE(sl.quantity,0) AS pos_stock
    FROM product_variants v JOIN products p ON p.id=v.product_id
    LEFT JOIN stock_levels sl ON sl.variant_id=v.id AND sl.location_type='pos' AND sl.location_id=?
    WHERE (v.barcode=? OR v.sku=? OR p.barcode=?) AND v.is_active=1 AND p.is_active=1 LIMIT 1`)
    .get(posId, req.params.barcode, req.params.barcode, req.params.barcode);
  if (!row) return notFound(res, 'المنتج غير موجود');
  res.json(row);
});

export default router;
