import { Router } from 'express';
import db, { nextNumber } from '../db.js';
import { requirePermission } from '../middleware/auth.js';
import { audit, badRequest, notFound, validate } from '../middleware/audit.js';
import { tx, transferStock, increaseStock, decreaseStock, recordMovement, InventoryError, getVariantCost } from './inventory-core.js';

const router = Router();

function checkWarehouseScope(req, res, wid) {
  if (!req.user.canAccessWarehouse(wid)) { res.status(403).json({ error: 'غير مصرح لك بهذا المخزن' }); return false; }
  return true;
}
function checkPosScope(req, res, pid) {
  if (!req.user.canAccessPos(pid)) { res.status(403).json({ error: 'غير مصرح لك بنقطة البيع هذه' }); return false; }
  return true;
}
function locationOf(type, id) {
  if (type === 'warehouse') {
    const w = db.prepare('SELECT * FROM warehouses WHERE id=?').get(id);
    if (!w || !w.is_active) throw new InventoryError('المخزن غير موجود أو معطّل');
  } else {
    const p = db.prepare('SELECT * FROM pos_locations WHERE id=?').get(id);
    if (!p || !p.is_active) throw new InventoryError('نقطة البيع غير موجودة أو معطّلة');
  }
}

// ---------- المخازن ----------
router.get('/warehouses', requirePermission('inventory.view', 'warehouses.manage', 'pos.sell'), (req, res) => {
  let rows = db.prepare('SELECT * FROM warehouses ORDER BY id').all();
  if (req.user.warehouseIds.length) rows = rows.filter(w => req.user.warehouseIds.includes(w.id));
  res.json(rows);
});
router.post('/warehouses', requirePermission('warehouses.manage'), (req, res) => {
  const { errors, data } = validate(req.body, {
    name: { required: true, label: 'اسم المخزن', maxLen: 150 },
    code: { required: true, label: 'الكود', maxLen: 30 },
    address: { maxLen: 255, default: '' },
  });
  if (errors.length) return badRequest(res, errors.join('، '));
  try {
    const info = db.prepare('INSERT INTO warehouses(name,code,address) VALUES (?,?,?)').run(data.name, data.code, data.address);
    audit(req, { action: 'create', entity: 'warehouses', entityId: info.lastInsertRowid, newData: data });
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return badRequest(res, 'كود المخزن مستخدم من قبل');
    throw e;
  }
});
router.put('/warehouses/:id', requirePermission('warehouses.manage'), (req, res) => {
  const old = db.prepare('SELECT * FROM warehouses WHERE id=?').get(req.params.id);
  if (!old) return notFound(res, 'المخزن غير موجود');
  const { errors, data } = validate(req.body, {
    name: { required: true, label: 'اسم المخزن', maxLen: 150 },
    code: { required: true, label: 'الكود', maxLen: 30 },
    address: { maxLen: 255, default: old.address ?? '' },
    is_active: { type: 'boolean', default: old.is_active },
  });
  if (errors.length) return badRequest(res, errors.join('، '));
  try {
    db.prepare('UPDATE warehouses SET name=?, code=?, address=?, is_active=? WHERE id=?').run(data.name, data.code, data.address, data.is_active, old.id);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return badRequest(res, 'كود المخزن مستخدم من قبل');
    throw e;
  }
  audit(req, { action: 'update', entity: 'warehouses', entityId: old.id, oldData: old, newData: data });
  res.json({ ok: true });
});

// ---------- المخزون الحالي ----------
router.get('/stock', requirePermission('inventory.view', 'pos.sell'), (req, res) => {
  const { location_type, location_id, q, low, out } = req.query;
  if (!['warehouse', 'pos'].includes(location_type) || !location_id) return badRequest(res, 'حدد الموقع');
  if (location_type === 'warehouse' && !checkWarehouseScope(req, res, location_id)) return;
  if (location_type === 'pos' && !checkPosScope(req, res, location_id)) return;
  let sql = `SELECT sl.location_type, sl.location_id, sl.quantity, sl.avg_cost,
      v.id AS variant_id, v.sku, v.barcode, v.size, v.color, v.selling_price, v.cost_price, v.min_stock,
      p.id AS product_id, p.name AS product_name, c.name AS category_name
    FROM stock_levels sl
    JOIN product_variants v ON v.id = sl.variant_id
    JOIN products p ON p.id = v.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE sl.location_type=? AND sl.location_id=?`;
  const args = [location_type, location_id];
  if (q) { sql += ' AND (p.name LIKE ? OR v.sku LIKE ? OR v.barcode LIKE ?)'; const like = `%${q}%`; args.push(like, like, like); }
  if (low === '1') sql += ' AND sl.quantity <= v.min_stock AND sl.quantity > 0';
  if (out === '1') sql += ' AND sl.quantity <= 0';
  sql += ' ORDER BY p.name LIMIT 1000';
  let rows = db.prepare(sql).all(...args);
  if (!req.user.has('cost.view')) rows = rows.map(({ avg_cost, cost_price, ...r }) => r);
  res.json(rows);
});

// ---------- حركات المخزون ----------
router.get('/movements', requirePermission('inventory.view', 'pos.manage'), (req, res) => {
  const { location_type, location_id, variant_id, type, from, to } = req.query;
  let sql = `SELECT im.*, v.sku, v.barcode, v.size, v.color, p.name AS product_name, u.full_name AS user_name
    FROM inventory_movements im
    JOIN product_variants v ON v.id = im.variant_id
    JOIN products p ON p.id = v.product_id
    LEFT JOIN users u ON u.id = im.user_id WHERE 1=1`;
  const args = [];
  if (location_type && location_id) {
    sql += ' AND ((im.source_type=? AND im.source_id=?) OR (im.dest_type=? AND im.dest_id=?))';
    args.push(location_type, location_id, location_type, location_id);
  }
  if (variant_id) { sql += ' AND im.variant_id=?'; args.push(variant_id); }
  if (type) { sql += ' AND im.movement_type=?'; args.push(type); }
  if (from) { sql += ' AND im.created_at >= ?'; args.push(from + ' 00:00:00'); }
  if (to) { sql += ' AND im.created_at <= ?'; args.push(to + ' 23:59:59'); }
  sql += ' ORDER BY im.id DESC LIMIT 500';
  const rows = db.prepare(sql).all(...args);
  if (!req.user.has('cost.view')) rows.forEach(r => delete r.cost_price);
  res.json(rows);
});

// استلام من مورد / إضافة مخزون
router.post('/receive', requirePermission('inventory.receive'), (req, res) => {
  const { errors, data } = validate(req.body, {
    warehouse_id: { required: true, type: 'int', label: 'المخزن' },
    supplier_id: { type: 'int', label: 'المورد' },
    document_number: { maxLen: 60, default: '' },
    notes: { maxLen: 500, default: '' },
    type: { default: 'RECEIVE_SUPPLIER', enum: ['RECEIVE_SUPPLIER', 'ADD'], label: 'نوع الحركة' },
  });
  if (errors.length) return badRequest(res, errors.join('، '));
  if (!checkWarehouseScope(req, res, data.warehouse_id)) return;
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) return badRequest(res, 'أضف صنفًا واحدًا على الأقل');
  const docNo = data.document_number || nextNumber(data.type === 'ADD' ? 'ADD' : 'RCV');
  try {
    tx(() => {
      for (const [i, item] of items.entries()) {
        const qty = Number(item.quantity), cost = Number(item.cost_price ?? 0);
        if (!Number.isFinite(qty) || qty <= 0) throw new InventoryError(`سطر ${i + 1}: كمية غير صالحة`);
        if (!Number.isFinite(cost) || cost < 0) throw new InventoryError(`سطر ${i + 1}: تكلفة غير صالحة`);
        const v = db.prepare('SELECT id FROM product_variants WHERE id=? AND is_active=1').get(item.variant_id);
        if (!v) throw new InventoryError(`سطر ${i + 1}: المتغير غير موجود`);
        increaseStock('warehouse', data.warehouse_id, v.id, qty, cost);
        recordMovement({
          userId: req.user.id, variantId: v.id, quantity: qty, costPrice: cost,
          sourceType: data.type === 'RECEIVE_SUPPLIER' ? 'supplier' : 'external',
          sourceId: data.supplier_id ?? null, destType: 'warehouse', destId: data.warehouse_id,
          movementType: data.type, documentNumber: docNo, notes: data.notes,
        });
      }
    })();
  } catch (e) {
    if (e instanceof InventoryError) return badRequest(res, e.message);
    throw e;
  }
  audit(req, { action: data.type, entity: 'inventory_movements', entityId: docNo, newData: { warehouse_id: data.warehouse_id, items: items.length } });
  res.status(201).json({ document_number: docNo });
});

// صرف من المخزن (للمورد أو تالف...)
router.post('/issue', requirePermission('inventory.adjust', 'inventory.receive'), (req, res) => {
  const { errors, data } = validate(req.body, {
    warehouse_id: { required: true, type: 'int', label: 'المخزن' },
    supplier_id: { type: 'int', label: 'المورد' },
    document_number: { maxLen: 60, default: '' },
    notes: { maxLen: 500, default: '' },
  });
  if (errors.length) return badRequest(res, errors.join('، '));
  if (!checkWarehouseScope(req, res, data.warehouse_id)) return;
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) return badRequest(res, 'أضف صنفًا واحدًا على الأقل');
  const docNo = data.document_number || nextNumber('ISS');
  try {
    tx(() => {
      for (const [i, item] of items.entries()) {
        const qty = Number(item.quantity);
        if (!Number.isFinite(qty) || qty <= 0) throw new InventoryError(`سطر ${i + 1}: كمية غير صالحة`);
        const out = decreaseStock('warehouse', data.warehouse_id, Number(item.variant_id), qty);
        recordMovement({
          userId: req.user.id, variantId: Number(item.variant_id), quantity: qty, costPrice: out.avg_cost,
          sourceType: 'warehouse', sourceId: data.warehouse_id,
          destType: data.supplier_id ? 'supplier' : 'external', destId: data.supplier_id ?? null,
          movementType: 'ISSUE', documentNumber: docNo, notes: data.notes,
        });
      }
    })();
  } catch (e) {
    if (e instanceof InventoryError) return badRequest(res, e.message);
    throw e;
  }
  audit(req, { action: 'ISSUE', entity: 'inventory_movements', entityId: docNo });
  res.status(201).json({ document_number: docNo });
});

// تحويل (مخزن↔مخزن، مخزن→POS، POS→مخزن مرتجع)
router.post('/transfer', requirePermission('inventory.transfer'), (req, res) => {
  const { errors, data } = validate(req.body, {
    from_type: { required: true, enum: ['warehouse', 'pos'], label: 'نوع المصدر' },
    from_id: { required: true, type: 'int', label: 'المصدر' },
    to_type: { required: true, enum: ['warehouse', 'pos'], label: 'نوع الوجهة' },
    to_id: { required: true, type: 'int', label: 'الوجهة' },
    notes: { maxLen: 500, default: '' },
  });
  if (errors.length) return badRequest(res, errors.join('، '));
  if (data.from_type === data.to_type && data.from_id === data.to_id) return badRequest(res, 'المصدر والوجهة متماثلان');
  if (data.from_type === 'warehouse' && !checkWarehouseScope(req, res, data.from_id)) return;
  if (data.from_type === 'pos' && !checkPosScope(req, res, data.from_id)) return;
  if (data.to_type === 'warehouse' && !checkWarehouseScope(req, res, data.to_id)) return;
  if (data.to_type === 'pos' && !checkPosScope(req, res, data.to_id)) return;
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) return badRequest(res, 'أضف صنفًا واحدًا على الأقل');
  const docNo = nextNumber('TRF');
  const mType = data.to_type === 'pos' ? 'TRANSFER_TO_POS' : (data.from_type === 'pos' ? 'POS_RETURN' : 'TRANSFER');
  try {
    tx(() => {
      locationOf(data.from_type, data.from_id);
      locationOf(data.to_type, data.to_id);
      for (const [i, item] of items.entries()) {
        const qty = Number(item.quantity);
        if (!Number.isFinite(qty) || qty <= 0) throw new InventoryError(`سطر ${i + 1}: كمية غير صالحة`);
        transferStock({
          userId: req.user.id, variantId: Number(item.variant_id), qty,
          from: { type: data.from_type, id: data.from_id }, to: { type: data.to_type, id: data.to_id },
          movementType: mType, documentNumber: docNo, notes: data.notes,
        });
      }
    })();
  } catch (e) {
    if (e instanceof InventoryError) return badRequest(res, e.message);
    throw e;
  }
  audit(req, { action: mType, entity: 'inventory_movements', entityId: docNo, newData: { ...data, items: items.length } });
  res.status(201).json({ document_number: docNo });
});

// تسوية مخزون (+/−)
router.post('/adjust', requirePermission('inventory.adjust'), (req, res) => {
  const { errors, data } = validate(req.body, {
    location_type: { required: true, enum: ['warehouse', 'pos'], label: 'نوع الموقع' },
    location_id: { required: true, type: 'int', label: 'الموقع' },
    variant_id: { required: true, type: 'int', label: 'الصنف' },
    quantity: { required: true, type: 'number', label: 'الكمية (موجبة أو سالبة)' },
    reason: { required: true, label: 'سبب التسوية', maxLen: 500 },
  });
  if (errors.length) return badRequest(res, errors.join('، '));
  if (data.quantity === 0) return badRequest(res, 'الكمية لا يمكن أن تكون صفرًا');
  if (data.location_type === 'warehouse' && !checkWarehouseScope(req, res, data.location_id)) return;
  if (data.location_type === 'pos' && !checkPosScope(req, res, data.location_id)) return;
  const docNo = nextNumber('ADJ');
  try {
    tx(() => {
      if (data.quantity > 0) {
        const cost = getVariantCost(data.variant_id, data.location_type, data.location_id);
        increaseStock(data.location_type, data.location_id, data.variant_id, data.quantity, cost);
        recordMovement({ userId: req.user.id, variantId: data.variant_id, quantity: data.quantity, costPrice: cost, destType: data.location_type, destId: data.location_id, movementType: 'ADJUSTMENT', documentNumber: docNo, notes: data.reason });
      } else {
        const out = decreaseStock(data.location_type, data.location_id, data.variant_id, Math.abs(data.quantity));
        recordMovement({ userId: req.user.id, variantId: data.variant_id, quantity: Math.abs(data.quantity), costPrice: out.avg_cost, sourceType: data.location_type, sourceId: data.location_id, movementType: 'ADJUSTMENT', documentNumber: docNo, notes: data.reason });
      }
    })();
  } catch (e) {
    if (e instanceof InventoryError) return badRequest(res, e.message);
    throw e;
  }
  audit(req, { action: 'ADJUSTMENT', entity: 'inventory_movements', entityId: docNo, newData: data, reason: data.reason });
  res.status(201).json({ document_number: docNo });
});

// جرد: مطابقة الأرصدة الدفترية بالفعلية
router.post('/stocktake', requirePermission('inventory.stocktake'), (req, res) => {
  const { errors, data } = validate(req.body, {
    location_type: { required: true, enum: ['warehouse', 'pos'], label: 'نوع الموقع' },
    location_id: { required: true, type: 'int', label: 'الموقع' },
    notes: { maxLen: 500, default: '' },
  });
  if (errors.length) return badRequest(res, errors.join('، '));
  if (data.location_type === 'warehouse' && !checkWarehouseScope(req, res, data.location_id)) return;
  if (data.location_type === 'pos' && !checkPosScope(req, res, data.location_id)) return;
  const counts = Array.isArray(req.body.counts) ? req.body.counts : [];
  if (!counts.length) return badRequest(res, 'أرسل نتائج الجرد');
  const docNo = nextNumber('STK');
  const differences = [];
  try {
    tx(() => {
      for (const c of counts) {
        const vid = Number(c.variant_id), actual = Number(c.quantity);
        if (!Number.isFinite(actual) || actual < 0) throw new InventoryError('كمية جرد غير صالحة');
        const row = db.prepare('SELECT * FROM stock_levels WHERE location_type=? AND location_id=? AND variant_id=?')
          .get(data.location_type, data.location_id, vid);
        const book = row?.quantity ?? 0;
        const diff = actual - book;
        if (diff === 0) continue;
        differences.push({ variant_id: vid, book, actual, diff });
        if (diff > 0) {
          const cost = getVariantCost(vid, data.location_type, data.location_id);
          increaseStock(data.location_type, data.location_id, vid, diff, cost);
          recordMovement({ userId: req.user.id, variantId: vid, quantity: diff, costPrice: cost, destType: data.location_type, destId: data.location_id, movementType: 'STOCKTAKE', documentNumber: docNo, notes: `فرق جرد زيادة (${book} → ${actual}) ${data.notes}` });
        } else {
          const out = decreaseStock(data.location_type, data.location_id, vid, Math.abs(diff));
          recordMovement({ userId: req.user.id, variantId: vid, quantity: Math.abs(diff), costPrice: out.avg_cost, sourceType: data.location_type, sourceId: data.location_id, movementType: 'STOCKTAKE', documentNumber: docNo, notes: `فرق جرد عجز (${book} → ${actual}) ${data.notes}` });
        }
      }
    })();
  } catch (e) {
    if (e instanceof InventoryError) return badRequest(res, e.message);
    throw e;
  }
  audit(req, { action: 'STOCKTAKE', entity: 'inventory_movements', entityId: docNo, newData: { differences } });
  res.status(201).json({ document_number: docNo, differences });
});

// تقييم المخزون
router.get('/valuation', requirePermission('inventory.view', 'cost.view'), (req, res) => {
  if (!req.user.has('cost.view')) return res.status(403).json({ error: 'ليس لديك صلاحية مشاهدة التكلفة' });
  const rows = db.prepare(`
    SELECT sl.location_type, sl.location_id,
      CASE sl.location_type WHEN 'warehouse' THEN (SELECT name FROM warehouses WHERE id=sl.location_id)
      ELSE (SELECT name FROM pos_locations WHERE id=sl.location_id) END AS location_name,
      SUM(sl.quantity) AS total_qty,
      SUM(sl.quantity * sl.avg_cost) AS total_cost,
      SUM(sl.quantity * v.selling_price) AS total_selling
    FROM stock_levels sl JOIN product_variants v ON v.id=sl.variant_id
    GROUP BY sl.location_type, sl.location_id`).all();
  res.json(rows);
});

export default router;
