import { Router } from 'express';
import db, { nextNumber, getSetting } from '../db.js';
import { requirePermission } from '../middleware/auth.js';
import { audit, badRequest, notFound, validate } from '../middleware/audit.js';
import { tx, decreaseStock, increaseStock, recordMovement, InventoryError, getVariantCost } from './inventory-core.js';

const router = Router();

const PAYMENT_METHODS = ['cash', 'bank_transfer', 'card', 'wallet'];

function openShift(cashierId, posId) {
  return db.prepare(`SELECT * FROM shifts WHERE cashier_id=? AND pos_location_id=? AND status='open'`).get(cashierId, posId);
}

function addCashMovement(shiftId, type, amount, method, referenceId, notes) {
  db.prepare('INSERT INTO cash_movements(shift_id,type,amount,payment_method,reference_id,notes) VALUES (?,?,?,?,?,?)')
    .run(shiftId, type, amount, method, referenceId, notes);
  const col = { cash: 'cash_sales', card: 'card_sales', wallet: 'wallet_sales', bank_transfer: 'transfer_sales' }[method];
  if (type === 'sale' && col) db.prepare(`UPDATE shifts SET ${col} = ${col} + ? WHERE id=?`).run(amount, shiftId);
  if (type === 'refund') db.prepare('UPDATE shifts SET refunds = refunds + ? WHERE id=?').run(amount, shiftId);
  if (type === 'expense') db.prepare('UPDATE shifts SET expenses = expenses + ? WHERE id=?').run(amount, shiftId);
}

function loadInvoice(id) {
  const inv = db.prepare(`SELECT i.*, u.full_name AS cashier_name, pl.name AS pos_name, pl.code AS pos_code
    FROM invoices i JOIN users u ON u.id=i.cashier_id JOIN pos_locations pl ON pl.id=i.pos_location_id WHERE i.id=?`).get(id);
  if (!inv) return null;
  inv.items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=?').all(id);
  inv.returns = db.prepare('SELECT * FROM returns WHERE invoice_id=? ORDER BY id').all(id);
  return inv;
}

function canSeeInvoice(req, inv) {
  return req.user.canAccessPos(inv.pos_location_id);
}

// ---------- إنشاء فاتورة (بيع) ----------
router.post('/invoices', requirePermission('pos.sell'), (req, res) => {
  const { errors, data } = validate(req.body, {
    pos_location_id: { required: true, type: 'int', label: 'نقطة البيع' },
    discount: { type: 'number', min: 0, default: 0, label: 'الخصم' },
    payment_method: { required: true, enum: PAYMENT_METHODS, label: 'طريقة الدفع' },
    paid_amount: { required: true, type: 'number', min: 0, label: 'المبلغ المدفوع' },
    notes: { maxLen: 500, default: '' },
  });
  if (errors.length) return badRequest(res, errors.join('، '));
  if (!req.user.canAccessPos(data.pos_location_id)) return res.status(403).json({ error: 'غير مصرح لك بنقطة البيع هذه' });
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) return badRequest(res, 'الفاتورة فارغة');

  const shift = openShift(req.user.id, data.pos_location_id);
  if (!shift) return badRequest(res, 'يجب فتح شفت أولًا قبل البيع');

  try {
    const result = tx(() => {
      const pos = db.prepare('SELECT * FROM pos_locations WHERE id=? AND is_active=1').get(data.pos_location_id);
      if (!pos) throw new InventoryError('نقطة البيع غير موجودة أو معطلة');

      let subtotal = 0;
      const lines = [];
      for (const [i, item] of items.entries()) {
        const qty = Number(item.quantity);
        if (!Number.isFinite(qty) || qty <= 0) throw new InventoryError(`سطر ${i + 1}: كمية غير صالحة`);
        const v = db.prepare(`SELECT v.*, p.name AS product_name, p.is_active AS p_active FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.id=?`).get(item.variant_id);
        if (!v || !v.is_active || !v.p_active) throw new InventoryError(`سطر ${i + 1}: المنتج غير متاح`);
        // السعر يُؤخذ من قاعدة البيانات وليس من العميل — منع التلاعب بالأسعار
        const unitPrice = v.selling_price;
        const lineDiscount = Math.min(Number(item.discount ?? 0), qty * unitPrice);
        if (lineDiscount < 0) throw new InventoryError(`سطر ${i + 1}: خصم غير صالح`);
        const lineTotal = qty * unitPrice - lineDiscount;
        subtotal += lineTotal;
        const cost = getVariantCost(v.id, 'pos', data.pos_location_id);
        lines.push({ v, qty, unitPrice, lineDiscount, lineTotal, cost });
      }
      const total = subtotal - data.discount;
      if (total < 0) throw new InventoryError('الإجمالي لا يمكن أن يكون سالبًا');
      const paid = data.paid_amount;
      const change = paid - total;
      if (change < -0.0001) throw new InventoryError('المبلغ المدفوع أقل من الإجمالي');

      const invoiceNumber = nextNumber('INV');
      const info = db.prepare(`INSERT INTO invoices(invoice_number,pos_location_id,cashier_id,shift_id,subtotal,discount,total,payment_method,paid_amount,change_amount,notes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(invoiceNumber, data.pos_location_id, req.user.id, shift.id, subtotal, data.discount, total, data.payment_method, paid, Math.max(0, change), data.notes);
      const invoiceId = info.lastInsertRowid;

      const insItem = db.prepare(`INSERT INTO invoice_items(invoice_id,variant_id,product_name,size,color,quantity,unit_price,cost_price,discount,total)
        VALUES (?,?,?,?,?,?,?,?,?,?)`);
      for (const l of lines) {
        insItem.run(invoiceId, l.v.id, l.v.product_name, l.v.size, l.v.color, l.qty, l.unitPrice, l.cost, l.lineDiscount, l.lineTotal);
        decreaseStock('pos', data.pos_location_id, l.v.id, l.qty);
        recordMovement({
          userId: req.user.id, variantId: l.v.id, quantity: l.qty, costPrice: l.cost,
          sourceType: 'pos', sourceId: data.pos_location_id, destType: 'customer', destId: null,
          movementType: 'SALE', documentNumber: invoiceNumber,
        });
      }
      addCashMovement(shift.id, 'sale', total, data.payment_method, invoiceId, `فاتورة ${invoiceNumber}`);
      return { invoiceId, invoiceNumber, total, change: Math.max(0, change) };
    })();
    audit(req, { action: 'create', entity: 'invoices', entityId: result.invoiceId, newData: { invoice_number: result.invoiceNumber, total: result.total } });
    res.status(201).json(result);
  } catch (e) {
    if (e instanceof InventoryError) return badRequest(res, e.message);
    throw e;
  }
});

// ---------- البحث في الفواتير ----------
router.get('/invoices', requirePermission('invoices.view'), (req, res) => {
  const { number, from, to, cashier_id, pos_location_id, barcode, product, status } = req.query;
  let sql = `SELECT DISTINCT i.*, u.full_name AS cashier_name, pl.name AS pos_name
    FROM invoices i JOIN users u ON u.id=i.cashier_id JOIN pos_locations pl ON pl.id=i.pos_location_id
    LEFT JOIN invoice_items ii ON ii.invoice_id=i.id
    LEFT JOIN product_variants v ON v.id=ii.variant_id
    WHERE 1=1`;
  const args = [];
  if (req.user.posIds.length) { sql += ` AND i.pos_location_id IN (${req.user.posIds.map(() => '?').join(',')})`; args.push(...req.user.posIds); }
  if (number) { sql += ' AND i.invoice_number LIKE ?'; args.push(`%${number}%`); }
  if (from) { sql += ' AND i.created_at >= ?'; args.push(from + ' 00:00:00'); }
  if (to) { sql += ' AND i.created_at <= ?'; args.push(to + ' 23:59:59'); }
  if (cashier_id) { sql += ' AND i.cashier_id=?'; args.push(cashier_id); }
  if (pos_location_id) { sql += ' AND i.pos_location_id=?'; args.push(pos_location_id); }
  if (barcode) { sql += ' AND v.barcode=?'; args.push(barcode); }
  if (product) { sql += ' AND ii.product_name LIKE ?'; args.push(`%${product}%`); }
  if (status) { sql += ' AND i.status=?'; args.push(status); }
  sql += ' ORDER BY i.id DESC LIMIT 300';
  const rows = db.prepare(sql).all(...args);
  if (!req.user.has('cost.view')) rows.forEach(r => { delete r.cost; });
  res.json(rows);
});

router.get('/invoices/:id', requirePermission('invoices.view'), (req, res) => {
  const inv = loadInvoice(req.params.id);
  if (!inv) return notFound(res, 'الفاتورة غير موجودة');
  if (!canSeeInvoice(req, inv)) return res.status(403).json({ error: 'غير مصرح لك بمشاهدة هذه الفاتورة' });
  if (!req.user.has('cost.view')) inv.items.forEach(i => delete i.cost_price);
  res.json(inv);
});

// ---------- تعديل فاتورة ----------
router.put('/invoices/:id', requirePermission('invoices.edit'), (req, res) => {
  const inv = loadInvoice(req.params.id);
  if (!inv) return notFound(res, 'الفاتورة غير موجودة');
  if (!canSeeInvoice(req, inv)) return res.status(403).json({ error: 'غير مصرح لك بهذه الفاتورة' });
  if (inv.status === 'cancelled') return badRequest(res, 'لا يمكن تعديل فاتورة ملغاة');
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return badRequest(res, 'سبب التعديل مطلوب');
  const { errors, data } = validate(req.body, {
    discount: { type: 'number', min: 0, default: inv.discount, label: 'الخصم' },
    payment_method: { enum: PAYMENT_METHODS, default: inv.payment_method, label: 'طريقة الدفع' },
    paid_amount: { type: 'number', min: 0, default: inv.paid_amount, label: 'المدفوع' },
    notes: { maxLen: 500, default: inv.notes ?? '' },
  });
  if (errors.length) return badRequest(res, errors.join('، '));
  const items = Array.isArray(req.body.items) ? req.body.items : null;

  try {
    tx(() => {
      const oldSnapshot = { ...inv };
      // عكس حركات المخزون القديمة
      for (const it of inv.items) {
        const remaining = it.quantity - it.returned_qty;
        if (remaining > 0) {
          increaseStock('pos', inv.pos_location_id, it.variant_id, remaining, it.cost_price);
          recordMovement({ userId: req.user.id, variantId: it.variant_id, quantity: remaining, costPrice: it.cost_price, destType: 'pos', destId: inv.pos_location_id, movementType: 'SALE_EDIT_REVERSE', documentNumber: inv.invoice_number, notes: `عكس للتعديل: ${reason}` });
        }
      }
      const shift = inv.shift_id ? db.prepare('SELECT * FROM shifts WHERE id=?').get(inv.shift_id) : null;
      if (shift && shift.status === 'open') {
        addCashMovement(shift.id, 'refund', inv.total, inv.payment_method, inv.id, `عكس فاتورة ${inv.invoice_number} للتعديل`);
      }

      let lines = [];
      let subtotal = 0;
      const newItems = items ?? inv.items.map(i => ({ variant_id: i.variant_id, quantity: i.quantity, discount: i.discount, returned_qty: i.returned_qty }));
      for (const [i, item] of newItems.entries()) {
        const qty = Number(item.quantity);
        if (!Number.isFinite(qty) || qty <= 0) throw new InventoryError(`سطر ${i + 1}: كمية غير صالحة`);
        const v = db.prepare(`SELECT v.*, p.name AS product_name FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.id=?`).get(item.variant_id);
        if (!v) throw new InventoryError(`سطر ${i + 1}: المنتج غير موجود`);
        const unitPrice = v.selling_price;
        const lineDiscount = Math.min(Number(item.discount ?? 0), qty * unitPrice);
        const lineTotal = qty * unitPrice - lineDiscount;
        subtotal += lineTotal;
        lines.push({ v, qty, unitPrice, lineDiscount, lineTotal, cost: getVariantCost(v.id, 'pos', inv.pos_location_id), returned_qty: Number(item.returned_qty ?? 0) });
      }
      const total = subtotal - data.discount;
      if (total < 0) throw new InventoryError('الإجمالي لا يمكن أن يكون سالبًا');
      const change = data.paid_amount - total;
      if (change < -0.0001) throw new InventoryError('المبلغ المدفوع أقل من الإجمالي');

      db.prepare('DELETE FROM invoice_items WHERE invoice_id=?').run(inv.id);
      const insItem = db.prepare(`INSERT INTO invoice_items(invoice_id,variant_id,product_name,size,color,quantity,unit_price,cost_price,discount,total,returned_qty)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
      for (const l of lines) {
        insItem.run(inv.id, l.v.id, l.v.product_name, l.v.size, l.v.color, l.qty, l.unitPrice, l.cost, l.lineDiscount, l.lineTotal, l.returned_qty);
        const sellQty = l.qty - l.returned_qty;
        if (sellQty > 0) {
          decreaseStock('pos', inv.pos_location_id, l.v.id, sellQty);
          recordMovement({ userId: req.user.id, variantId: l.v.id, quantity: sellQty, costPrice: l.cost, sourceType: 'pos', sourceId: inv.pos_location_id, destType: 'customer', movementType: 'SALE_EDIT_APPLY', documentNumber: inv.invoice_number, notes: `تطبيق بعد التعديل: ${reason}` });
        }
      }
      db.prepare(`UPDATE invoices SET subtotal=?, discount=?, total=?, payment_method=?, paid_amount=?, change_amount=?, notes=?, status='edited' WHERE id=?`)
        .run(subtotal, data.discount, total, data.payment_method, data.paid_amount, Math.max(0, change), data.notes, inv.id);
      if (shift && shift.status === 'open') {
        addCashMovement(shift.id, 'sale', total, data.payment_method, inv.id, `فاتورة ${inv.invoice_number} بعد التعديل`);
      }
      audit(req, { action: 'edit', entity: 'invoices', entityId: inv.id, oldData: oldSnapshot, newData: { ...data, items: newItems }, reason });
    })();
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof InventoryError) return badRequest(res, e.message);
    throw e;
  }
});

// ---------- إلغاء فاتورة ----------
router.post('/invoices/:id/cancel', requirePermission('invoices.cancel'), (req, res) => {
  const inv = loadInvoice(req.params.id);
  if (!inv) return notFound(res, 'الفاتورة غير موجودة');
  if (!canSeeInvoice(req, inv)) return res.status(403).json({ error: 'غير مصرح لك بهذه الفاتورة' });
  if (inv.status === 'cancelled') return badRequest(res, 'الفاتورة ملغاة بالفعل');
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return badRequest(res, 'سبب الإلغاء مطلوب');
  try {
    tx(() => {
      for (const it of inv.items) {
        const remaining = it.quantity - it.returned_qty;
        if (remaining > 0) {
          increaseStock('pos', inv.pos_location_id, it.variant_id, remaining, it.cost_price);
          recordMovement({ userId: req.user.id, variantId: it.variant_id, quantity: remaining, costPrice: it.cost_price, destType: 'pos', destId: inv.pos_location_id, movementType: 'CANCEL_REVERSE', documentNumber: inv.invoice_number, notes: `إلغاء فاتورة: ${reason}` });
        }
      }
      const refundDue = inv.total - db.prepare('SELECT COALESCE(SUM(total_refund),0) t FROM returns WHERE invoice_id=?').get(inv.id).t;
      const shift = inv.shift_id ? db.prepare('SELECT * FROM shifts WHERE id=?').get(inv.shift_id) : null;
      if (shift && shift.status === 'open' && refundDue > 0) {
        addCashMovement(shift.id, 'refund', refundDue, inv.payment_method, inv.id, `إلغاء فاتورة ${inv.invoice_number}`);
      }
      db.prepare(`UPDATE invoices SET status='cancelled' WHERE id=?`).run(inv.id);
      audit(req, { action: 'cancel', entity: 'invoices', entityId: inv.id, oldData: inv, reason });
    })();
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof InventoryError) return badRequest(res, e.message);
    throw e;
  }
});

// ---------- المرتجعات ----------
router.post('/returns', requirePermission('returns.execute'), (req, res) => {
  const { errors, data } = validate(req.body, {
    invoice_id: { required: true, type: 'int', label: 'الفاتورة' },
    reason: { required: true, label: 'سبب المرتجع', maxLen: 500 },
    refund_method: { enum: PAYMENT_METHODS, default: 'cash', label: 'طريقة الاسترداد' },
  });
  if (errors.length) return badRequest(res, errors.join('، '));
  const inv = loadInvoice(data.invoice_id);
  if (!inv) return notFound(res, 'الفاتورة غير موجودة');
  if (!canSeeInvoice(req, inv)) return res.status(403).json({ error: 'غير مصرح لك بهذه الفاتورة' });
  if (inv.status === 'cancelled') return badRequest(res, 'لا يمكن إرجاع فاتورة ملغاة');
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) return badRequest(res, 'حدد الأصناف المرتجعة');

  try {
    const result = tx(() => {
      let totalRefund = 0;
      const lines = [];
      for (const [i, item] of items.entries()) {
        const qty = Number(item.quantity);
        if (!Number.isFinite(qty) || qty <= 0) throw new InventoryError(`سطر ${i + 1}: كمية غير صالحة`);
        const it = inv.items.find(x => x.id === Number(item.invoice_item_id));
        if (!it) throw new InventoryError(`سطر ${i + 1}: بند غير موجود في الفاتورة`);
        const available = it.quantity - it.returned_qty;
        if (qty > available) throw new InventoryError(`سطر ${i + 1}: الكمية المرتجعة (${qty}) أكبر من المتاح (${available})`);
        const lineTotal = qty * it.unit_price - (it.discount * qty / it.quantity);
        totalRefund += lineTotal;
        lines.push({ it, qty, lineTotal: Math.round(lineTotal * 100) / 100 });
      }
      const returnNumber = nextNumber('RET');
      const isFull = inv.items.every(x => {
        const ret = lines.find(l => l.it.id === x.id);
        return (x.quantity - x.returned_qty) === (ret ? ret.qty : 0);
      });
      const info = db.prepare(`INSERT INTO returns(return_number,invoice_id,user_id,return_type,reason,total_refund,refund_method)
        VALUES (?,?,?,?,?,?,?)`).run(returnNumber, inv.id, req.user.id, isFull ? 'full' : 'partial', data.reason, totalRefund, data.refund_method);
      const returnId = info.lastInsertRowid;
      const insRI = db.prepare('INSERT INTO return_items(return_id,invoice_item_id,variant_id,quantity,unit_price,total) VALUES (?,?,?,?,?,?)');
      for (const l of lines) {
        insRI.run(returnId, l.it.id, l.it.variant_id, l.qty, l.it.unit_price, l.lineTotal);
        db.prepare('UPDATE invoice_items SET returned_qty = returned_qty + ? WHERE id=?').run(l.qty, l.it.id);
        increaseStock('pos', inv.pos_location_id, l.it.variant_id, l.qty, l.it.cost_price);
        recordMovement({
          userId: req.user.id, variantId: l.it.variant_id, quantity: l.qty, costPrice: l.it.cost_price,
          sourceType: 'customer', destType: 'pos', destId: inv.pos_location_id,
          movementType: 'SALE_RETURN', documentNumber: returnNumber, notes: `مرتجع فاتورة ${inv.invoice_number}: ${data.reason}`,
        });
      }
      const newStatus = isFull ? 'returned' : 'partially_returned';
      db.prepare('UPDATE invoices SET status=? WHERE id=?').run(newStatus, inv.id);
      const shift = openShift(req.user.id, inv.pos_location_id);
      if (shift) addCashMovement(shift.id, 'refund', totalRefund, data.refund_method, returnId, `مرتجع ${returnNumber}`);
      return { returnId, returnNumber, totalRefund, status: newStatus };
    })();
    audit(req, { action: 'return', entity: 'returns', entityId: result.returnId, newData: { ...data, total_refund: result.totalRefund }, reason: data.reason });
    res.status(201).json(result);
  } catch (e) {
    if (e instanceof InventoryError) return badRequest(res, e.message);
    throw e;
  }
});

router.get('/returns', requirePermission('returns.view'), (req, res) => {
  const { from, to, invoice_number } = req.query;
  let sql = `SELECT r.*, i.invoice_number AS inv_no, u.full_name AS user_name, pl.name AS pos_name
    FROM returns r JOIN invoices i ON i.id=r.invoice_id JOIN users u ON u.id=r.user_id
    JOIN pos_locations pl ON pl.id=i.pos_location_id WHERE 1=1`;
  const args = [];
  if (req.user.posIds.length) { sql += ` AND i.pos_location_id IN (${req.user.posIds.map(() => '?').join(',')})`; args.push(...req.user.posIds); }
  if (from) { sql += ' AND r.created_at >= ?'; args.push(from + ' 00:00:00'); }
  if (to) { sql += ' AND r.created_at <= ?'; args.push(to + ' 23:59:59'); }
  if (invoice_number) { sql += ' AND i.invoice_number LIKE ?'; args.push(`%${invoice_number}%`); }
  sql += ' ORDER BY r.id DESC LIMIT 300';
  res.json(db.prepare(sql).all(...args));
});

router.get('/returns/:id', requirePermission('returns.view'), (req, res) => {
  const r = db.prepare(`SELECT r.*, i.invoice_number AS inv_no, u.full_name AS user_name
    FROM returns r JOIN invoices i ON i.id=r.invoice_id JOIN users u ON u.id=r.user_id WHERE r.id=?`).get(req.params.id);
  if (!r) return notFound(res, 'المرتجع غير موجود');
  r.items = db.prepare(`SELECT ri.*, v.sku, v.size, v.color, p.name AS product_name
    FROM return_items ri JOIN product_variants v ON v.id=ri.variant_id JOIN products p ON p.id=v.product_id
    WHERE ri.return_id=?`).all(r.id);
  res.json(r);
});

// بيانات الطباعة الحرارية
router.get('/invoices/:id/print', requirePermission('invoices.print', 'invoices.view'), (req, res) => {
  const inv = loadInvoice(req.params.id);
  if (!inv) return notFound(res, 'الفاتورة غير موجودة');
  if (!canSeeInvoice(req, inv)) return res.status(403).json({ error: 'غير مصرح لك بهذه الفاتورة' });
  res.json({
    store_name: getSetting('store_name', 'ميسرة أحمد'),
    receipt_footer: getSetting('receipt_footer', ''),
    currency: getSetting('currency', 'EGP'),
    invoice: inv,
  });
});

export default router;
