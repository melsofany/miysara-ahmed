import { Router } from 'express';
import db from '../db.js';
import { requirePermission } from '../middleware/auth.js';
import { audit, badRequest, notFound, validate } from '../middleware/audit.js';

const router = Router();

// إخفاء التكلفة عمّن لا يملك صلاحية cost.view
function maskCost(req, row) {
  if (req.user.has('cost.view')) return row;
  const { cost_price, avg_cost, ...rest } = row;
  return rest;
}

// ---------- CRUD عام للبيانات الأساسية ----------
function simpleCrud(pathName, table, label, extraFields = []) {
  router.get(`/${pathName}`, requirePermission('products.view', 'catalog.manage'), (req, res) => {
    res.json(db.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
  });
  router.post(`/${pathName}`, requirePermission('catalog.manage'), (req, res) => {
    const rules = { name: { required: true, label: 'الاسم', maxLen: 150 } };
    for (const f of extraFields) rules[f] = { maxLen: 255, default: '' };
    const { errors, data } = validate(req.body, rules);
    if (errors.length) return badRequest(res, errors.join('، '));
    try {
      const cols = ['name', ...extraFields];
      const info = db.prepare(`INSERT INTO ${table}(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
        .run(...cols.map(c => data[c]));
      audit(req, { action: 'create', entity: table, entityId: info.lastInsertRowid, newData: data });
      res.status(201).json({ id: info.lastInsertRowid });
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return badRequest(res, `${label} موجود من قبل`);
      throw e;
    }
  });
  router.put(`/${pathName}/:id`, requirePermission('catalog.manage'), (req, res) => {
    const old = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.id);
    if (!old) return notFound(res);
    const rules = { name: { required: true, label: 'الاسم', maxLen: 150 } };
    for (const f of extraFields) rules[f] = { maxLen: 255, default: old[f] ?? '' };
    if (table === 'suppliers' || table === 'categories') rules.is_active = { type: 'boolean', default: old.is_active };
    const { errors, data } = validate(req.body, rules);
    if (errors.length) return badRequest(res, errors.join('، '));
    const cols = ['name', ...extraFields, ...(rules.is_active ? ['is_active'] : [])];
    try {
      db.prepare(`UPDATE ${table} SET ${cols.map(c => `${c}=?`).join(',')} WHERE id=?`).run(...cols.map(c => data[c]), old.id);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return badRequest(res, `${label} موجود من قبل`);
      throw e;
    }
    audit(req, { action: 'update', entity: table, entityId: old.id, oldData: old, newData: data });
    res.json({ ok: true });
  });
}

simpleCrud('seasons', 'seasons', 'الموسم');
simpleCrud('manufacturers', 'manufacturers', 'الماركة/الشركة المصنعة');
simpleCrud('suppliers', 'suppliers', 'المورد', ['contact_person', 'phone', 'email', 'address']);

// التصنيفات (تدعم تصنيفات فرعية)
router.get('/categories', requirePermission('products.view', 'catalog.manage'), (req, res) => {
  res.json(db.prepare('SELECT * FROM categories ORDER BY parent_id NULLS FIRST, name').all());
});
router.post('/categories', requirePermission('catalog.manage'), (req, res) => {
  const { errors, data } = validate(req.body, {
    name: { required: true, label: 'اسم التصنيف', maxLen: 150 },
    parent_id: { type: 'int', label: 'التصنيف الأب' },
  });
  if (errors.length) return badRequest(res, errors.join('، '));
  if (data.parent_id && !db.prepare('SELECT id FROM categories WHERE id=? AND parent_id IS NULL').get(data.parent_id))
    return badRequest(res, 'التصنيف الأب غير موجود');
  try {
    const info = db.prepare('INSERT INTO categories(name, parent_id) VALUES (?,?)').run(data.name, data.parent_id ?? null);
    audit(req, { action: 'create', entity: 'categories', entityId: info.lastInsertRowid, newData: data });
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return badRequest(res, 'التصنيف موجود من قبل');
    throw e;
  }
});
router.put('/categories/:id', requirePermission('catalog.manage'), (req, res) => {
  const old = db.prepare('SELECT * FROM categories WHERE id=?').get(req.params.id);
  if (!old) return notFound(res);
  const { errors, data } = validate(req.body, {
    name: { required: true, label: 'اسم التصنيف', maxLen: 150 },
    is_active: { type: 'boolean', default: old.is_active },
  });
  if (errors.length) return badRequest(res, errors.join('، '));
  db.prepare('UPDATE categories SET name=?, is_active=? WHERE id=?').run(data.name, data.is_active, old.id);
  audit(req, { action: 'update', entity: 'categories', entityId: old.id, oldData: old, newData: data });
  res.json({ ok: true });
});

// ---------- المنتجات والـ Variants ----------
const PRODUCT_SELECT = `
  SELECT p.*, c.name AS category_name, pc.name AS parent_category_name, s.name AS season_name,
         sup.name AS supplier_name, m.name AS manufacturer_name
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN categories pc ON pc.id = c.parent_id
  LEFT JOIN seasons s ON s.id = p.season_id
  LEFT JOIN suppliers sup ON sup.id = p.supplier_id
  LEFT JOIN manufacturers m ON m.id = p.manufacturer_id`;

router.get('/products', requirePermission('products.view'), (req, res) => {
  const { q, category_id, season_id, supplier_id, manufacturer_id, active } = req.query;
  let sql = PRODUCT_SELECT + ' WHERE 1=1';
  const args = [];
  if (q) { sql += ' AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR p.model_number LIKE ? OR p.description LIKE ?)'; const like = `%${q}%`; args.push(like, like, like, like, like); }
  if (category_id) { sql += ' AND (p.category_id=? OR c.parent_id=?)'; args.push(category_id, category_id); }
  if (season_id) { sql += ' AND p.season_id=?'; args.push(season_id); }
  if (supplier_id) { sql += ' AND p.supplier_id=?'; args.push(supplier_id); }
  if (manufacturer_id) { sql += ' AND p.manufacturer_id=?'; args.push(manufacturer_id); }
  if (active !== undefined && active !== '') { sql += ' AND p.is_active=?'; args.push(active === '1' ? 1 : 0); }
  sql += ' ORDER BY p.id DESC LIMIT 500';
  res.json(db.prepare(sql).all(...args).map(r => maskCost(req, r)));
});

router.get('/products/:id', requirePermission('products.view'), (req, res) => {
  const p = db.prepare(PRODUCT_SELECT + ' WHERE p.id=?').get(req.params.id);
  if (!p) return notFound(res, 'المنتج غير موجود');
  const variants = db.prepare('SELECT * FROM product_variants WHERE product_id=? ORDER BY id').all(p.id);
  res.json({ ...maskCost(req, p), variants: variants.map(v => maskCost(req, v)) });
});

const productRules = {
  sku: { required: true, label: 'SKU', maxLen: 60 },
  barcode: { maxLen: 60 },
  name: { required: true, label: 'اسم المنتج', maxLen: 200 },
  description: { maxLen: 2000, default: '' },
  category_id: { type: 'int', label: 'التصنيف' },
  season_id: { type: 'int', label: 'الموسم' },
  supplier_id: { type: 'int', label: 'المورد' },
  manufacturer_id: { type: 'int', label: 'الماركة' },
  model_number: { maxLen: 100, default: '' },
  cost_price: { type: 'number', min: 0, default: 0, label: 'سعر التكلفة' },
  selling_price: { type: 'number', min: 0, default: 0, label: 'سعر البيع' },
  min_stock: { type: 'number', min: 0, default: 0, label: 'حد الطلب' },
  image: { maxLen: 500, default: '' },
};

const variantRules = {
  sku: { required: true, label: 'SKU المتغير', maxLen: 60 },
  barcode: { maxLen: 60 },
  size: { maxLen: 50, default: '' },
  color: { maxLen: 50, default: '' },
  cost_price: { type: 'number', min: 0, default: 0, label: 'سعر التكلفة' },
  selling_price: { type: 'number', min: 0, default: 0, label: 'سعر البيع' },
  min_stock: { type: 'number', min: 0, default: 0, label: 'حد الطلب' },
};

function validateVariants(raw) {
  if (!Array.isArray(raw)) return { errors: [], variants: [] };
  const errors = [];
  const variants = [];
  const seenSku = new Set(), seenBc = new Set();
  raw.forEach((v, i) => {
    const { errors: e, data } = validate(v, variantRules);
    if (e.length) { errors.push(`متغير ${i + 1}: ${e.join('، ')}`); return; }
    if (seenSku.has(data.sku)) { errors.push(`SKU مكرر داخل المتغيرات: ${data.sku}`); return; }
    if (data.barcode && seenBc.has(data.barcode)) { errors.push(`باركود مكرر داخل المتغيرات: ${data.barcode}`); return; }
    seenSku.add(data.sku); if (data.barcode) seenBc.add(data.barcode);
    variants.push(data);
  });
  return { errors, variants };
}

router.post('/products', requirePermission('products.create'), (req, res) => {
  const { errors, data } = validate(req.body, productRules);
  const { errors: vErr, variants } = validateVariants(req.body.variants);
  if (errors.length || vErr.length) return badRequest(res, [...errors, ...vErr].join(' | '));
  const tx = db.transaction(() => {
    const info = db.prepare(`INSERT INTO products(sku,barcode,name,description,category_id,season_id,supplier_id,manufacturer_id,model_number,cost_price,selling_price,min_stock,image)
      VALUES (@sku,@barcode,@name,@description,@category_id,@season_id,@supplier_id,@manufacturer_id,@model_number,@cost_price,@selling_price,@min_stock,@image)`)
      .run({ barcode: null, category_id: null, season_id: null, supplier_id: null, manufacturer_id: null, ...data });
    const pid = info.lastInsertRowid;
    const insV = db.prepare(`INSERT INTO product_variants(product_id,sku,barcode,size,color,cost_price,selling_price,min_stock)
      VALUES (@product_id,@sku,@barcode,@size,@color,@cost_price,@selling_price,@min_stock)`);
    for (const v of variants) insV.run({ product_id: pid, barcode: null, ...v });
    return pid;
  });
  try {
    const pid = tx();
    audit(req, { action: 'create', entity: 'products', entityId: pid, newData: { ...data, variants } });
    res.status(201).json({ id: pid, variants: db.prepare('SELECT * FROM product_variants WHERE product_id=?').all(pid) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return badRequest(res, 'SKU أو Barcode مستخدم من قبل');
    throw e;
  }
});

router.put('/products/:id', requirePermission('products.edit'), (req, res) => {
  const old = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  if (!old) return notFound(res, 'المنتج غير موجود');
  const { errors, data } = validate(req.body, { ...productRules, is_active: { type: 'boolean', default: old.is_active } });
  if (errors.length) return badRequest(res, errors.join('، '));
  try {
    db.prepare(`UPDATE products SET sku=@sku,barcode=@barcode,name=@name,description=@description,category_id=@category_id,
      season_id=@season_id,supplier_id=@supplier_id,manufacturer_id=@manufacturer_id,model_number=@model_number,
      cost_price=@cost_price,selling_price=@selling_price,min_stock=@min_stock,image=@image,is_active=@is_active WHERE id=@id`)
      .run({ ...old, ...data, id: old.id });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return badRequest(res, 'SKU أو Barcode مستخدم من قبل');
    throw e;
  }
  audit(req, { action: 'update', entity: 'products', entityId: old.id, oldData: old, newData: data, reason: req.body.reason });
  res.json({ ok: true });
});

router.delete('/products/:id', requirePermission('products.delete'), (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  if (!p) return notFound(res, 'المنتج غير موجود');
  const used = db.prepare(`SELECT (SELECT COUNT(*) FROM invoice_items ii JOIN product_variants v ON v.id=ii.variant_id WHERE v.product_id=?)
    + (SELECT COUNT(*) FROM inventory_movements im JOIN product_variants v ON v.id=im.variant_id WHERE v.product_id=?) AS c`)
    .get(p.id, p.id).c;
  if (used > 0) {
    db.prepare('UPDATE products SET is_active=0 WHERE id=?').run(p.id);
    audit(req, { action: 'deactivate', entity: 'products', entityId: p.id, reason: 'له حركات مسجلة — تم التعطيل بدلاً من الحذف' });
    return res.json({ ok: true, deactivated: true });
  }
  db.prepare('DELETE FROM products WHERE id=?').run(p.id);
  audit(req, { action: 'delete', entity: 'products', entityId: p.id, oldData: p });
  res.json({ ok: true });
});

// ---------- Variants ----------
router.post('/products/:id/variants', requirePermission('products.create', 'products.edit'), (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  if (!p) return notFound(res, 'المنتج غير موجود');
  const { errors, data } = validate(req.body, variantRules);
  if (errors.length) return badRequest(res, errors.join('، '));
  try {
    const info = db.prepare(`INSERT INTO product_variants(product_id,sku,barcode,size,color,cost_price,selling_price,min_stock)
      VALUES (@product_id,@sku,@barcode,@size,@color,@cost_price,@selling_price,@min_stock)`)
      .run({ product_id: p.id, barcode: null, ...data });
    audit(req, { action: 'create', entity: 'product_variants', entityId: info.lastInsertRowid, newData: { ...data, product_id: p.id } });
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return badRequest(res, 'SKU أو Barcode مستخدم من قبل');
    throw e;
  }
});

router.put('/variants/:id', requirePermission('products.edit'), (req, res) => {
  const old = db.prepare('SELECT * FROM product_variants WHERE id=?').get(req.params.id);
  if (!old) return notFound(res, 'المتغير غير موجود');
  const { errors, data } = validate(req.body, { ...variantRules, is_active: { type: 'boolean', default: old.is_active } });
  if (errors.length) return badRequest(res, errors.join('، '));
  try {
    db.prepare(`UPDATE product_variants SET sku=@sku,barcode=@barcode,size=@size,color=@color,cost_price=@cost_price,
      selling_price=@selling_price,min_stock=@min_stock,is_active=@is_active WHERE id=@id`)
      .run({ ...old, ...data, id: old.id });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return badRequest(res, 'SKU أو Barcode مستخدم من قبل');
    throw e;
  }
  audit(req, { action: 'update', entity: 'product_variants', entityId: old.id, oldData: old, newData: data, reason: req.body.reason });
  res.json({ ok: true });
});

export default router;
