import db, { getSetting, nextNumber } from '../db.js';

export class InventoryError extends Error {
  constructor(msg, code = 400) { super(msg); this.code = code; }
}

const getStock = db.prepare('SELECT * FROM stock_levels WHERE location_type=? AND location_id=? AND variant_id=?');
const insStock = db.prepare('INSERT INTO stock_levels(location_type,location_id,variant_id,quantity,avg_cost) VALUES (?,?,?,?,?)');
const updQty = db.prepare('UPDATE stock_levels SET quantity=? WHERE id=?');
const updQtyCost = db.prepare('UPDATE stock_levels SET quantity=?, avg_cost=? WHERE id=?');
const insMovement = db.prepare(`INSERT INTO inventory_movements
  (movement_number,user_id,variant_id,quantity,cost_price,source_type,source_id,dest_type,dest_id,movement_type,document_number,notes)
  VALUES (@movement_number,@user_id,@variant_id,@quantity,@cost_price,@source_type,@source_id,@dest_type,@dest_id,@movement_type,@document_number,@notes)`);

export function allowNegative() { return getSetting('allow_negative_stock', '0') === '1'; }

function ensureRow(locType, locId, variantId) {
  let row = getStock.get(locType, locId, variantId);
  if (!row) {
    const info = insStock.run(locType, locId, variantId, 0, 0);
    row = { id: info.lastInsertRowid, location_type: locType, location_id: locId, variant_id: variantId, quantity: 0, avg_cost: 0 };
  }
  return row;
}

// إخراج كمية من موقع
export function decreaseStock(locType, locId, variantId, qty) {
  if (qty <= 0) throw new InventoryError('الكمية يجب أن تكون أكبر من صفر');
  const row = ensureRow(locType, locId, variantId);
  const next = row.quantity - qty;
  if (next < 0 && !allowNegative()) throw new InventoryError('الكمية غير متوفرة في المخزون (سيصبح الرصيد سالبًا)');
  updQty.run(next, row.id);
  return { prev: row.quantity, next, avg_cost: row.avg_cost };
}

// إدخال كمية إلى موقع مع تحديث متوسط التكلفة
export function increaseStock(locType, locId, variantId, qty, cost) {
  if (qty <= 0) throw new InventoryError('الكمية يجب أن تكون أكبر من صفر');
  const row = ensureRow(locType, locId, variantId);
  const next = row.quantity + qty;
  // متوسط مرجح: لا يُخفَّض عند وصول تكلفة صفرية (مثل مرتجع بدون تكلفة)
  let avg = row.avg_cost;
  if (cost > 0) {
    avg = next > 0 ? ((row.quantity * row.avg_cost) + (qty * cost)) / next : cost;
  } else if (avg === 0) {
    avg = 0;
  }
  updQtyCost.run(next, avg, row.id);
  return { prev: row.quantity, next, avg_cost: avg };
}

export function recordMovement({ userId, variantId, quantity, costPrice = 0, sourceType = null, sourceId = null, destType = null, destId = null, movementType, documentNumber = null, notes = null, movementNumber = null }) {
  insMovement.run({
    movement_number: movementNumber || nextNumber('MOV'),
    user_id: userId, variant_id: variantId, quantity,
    cost_price: costPrice, source_type: sourceType, source_id: sourceId,
    dest_type: destType, dest_id: destId, movement_type: movementType,
    document_number: documentNumber, notes,
  });
}

export function getVariantCost(variantId, locType = null, locId = null) {
  if (locType && locId) {
    const r = getStock.get(locType, locId, variantId);
    if (r && r.avg_cost > 0) return r.avg_cost;
  }
  const v = db.prepare('SELECT cost_price FROM product_variants WHERE id=?').get(variantId);
  return v?.cost_price ?? 0;
}

// تحويل بين موقعين (مخزن↔مخزن، مخزن→POS، POS→مخزن) داخل المعاملة الحالية
export function transferStock({ userId, variantId, qty, from, to, movementType, documentNumber, notes }) {
  const out = decreaseStock(from.type, from.id, variantId, qty);
  const cost = out.avg_cost > 0 ? out.avg_cost : getVariantCost(variantId, from.type, from.id);
  increaseStock(to.type, to.id, variantId, qty, cost);
  recordMovement({
    userId, variantId, quantity: qty, costPrice: cost,
    sourceType: from.type, sourceId: from.id, destType: to.type, destId: to.id,
    movementType, documentNumber, notes,
  });
  return cost;
}

export const tx = (fn) => db.transaction(fn);
