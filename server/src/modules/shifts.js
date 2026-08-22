import { Router } from 'express';
import db from '../db.js';
import { requirePermission } from '../middleware/auth.js';
import { audit, badRequest, notFound, validate } from '../middleware/audit.js';
import { tx } from './inventory-core.js';

const router = Router();

// فتح شفت
router.post('/shifts/open', requirePermission('shifts.open'), (req, res) => {
  const { errors, data } = validate(req.body, {
    pos_location_id: { required: true, type: 'int', label: 'نقطة البيع' },
    opening_cash: { required: true, type: 'number', min: 0, label: 'الفكة الافتتاحية' },
    notes: { maxLen: 500, default: '' },
  });
  if (errors.length) return badRequest(res, errors.join('، '));
  if (!req.user.canAccessPos(data.pos_location_id)) return res.status(403).json({ error: 'غير مصرح لك بنقطة البيع هذه' });
  const pos = db.prepare('SELECT * FROM pos_locations WHERE id=? AND is_active=1').get(data.pos_location_id);
  if (!pos) return badRequest(res, 'نقطة البيع غير موجودة أو معطلة');
  const existing = db.prepare(`SELECT * FROM shifts WHERE cashier_id=? AND pos_location_id=? AND status='open'`).get(req.user.id, data.pos_location_id);
  if (existing) return badRequest(res, `لديك شفت مفتوح بالفعل (#${existing.id}) — أغلقه أولًا`);
  try {
    const info = db.prepare('INSERT INTO shifts(pos_location_id,cashier_id,opening_cash,notes) VALUES (?,?,?,?)')
      .run(data.pos_location_id, req.user.id, data.opening_cash, data.notes);
    audit(req, { action: 'open', entity: 'shifts', entityId: info.lastInsertRowid, newData: data });
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return badRequest(res, 'لديك شفت مفتوح بالفعل');
    throw e;
  }
});

// الشفت الحالي للكاشير
router.get('/shifts/current', requirePermission('shifts.open', 'pos.sell'), (req, res) => {
  const posId = Number(req.query.pos_location_id);
  if (!posId) return badRequest(res, 'حدد نقطة البيع');
  const shift = db.prepare(`SELECT s.*, pl.name AS pos_name FROM shifts s JOIN pos_locations pl ON pl.id=s.pos_location_id
    WHERE s.cashier_id=? AND s.pos_location_id=? AND s.status='open'`).get(req.user.id, posId);
  res.json(shift || null);
});

// مصروف نقدي من الدرج
router.post('/shifts/:id/expense', requirePermission('expenses.manage', 'shifts.close'), (req, res) => {
  const shift = db.prepare('SELECT * FROM shifts WHERE id=?').get(req.params.id);
  if (!shift || shift.status !== 'open') return badRequest(res, 'الشفت غير مفتوح');
  if (shift.cashier_id !== req.user.id && !req.user.has('shifts.manage')) return res.status(403).json({ error: 'غير مصرح' });
  const { errors, data } = validate(req.body, {
    amount: { required: true, type: 'number', min: 0.01, label: 'المبلغ' },
    notes: { required: true, label: 'البيان', maxLen: 500 },
  });
  if (errors.length) return badRequest(res, errors.join('، '));
  tx(() => {
    db.prepare(`INSERT INTO cash_movements(shift_id,type,amount,payment_method,notes) VALUES (?,?,?,'cash',?)`)
      .run(shift.id, 'expense', data.amount, data.notes);
    db.prepare('UPDATE shifts SET expenses = expenses + ? WHERE id=?').run(data.amount, shift.id);
  })();
  audit(req, { action: 'expense', entity: 'shifts', entityId: shift.id, newData: data });
  res.status(201).json({ ok: true });
});

// إغلاق شفت
router.post('/shifts/:id/close', requirePermission('shifts.close'), (req, res) => {
  const shift = db.prepare('SELECT * FROM shifts WHERE id=?').get(req.params.id);
  if (!shift) return notFound(res, 'الشفت غير موجود');
  if (shift.status !== 'open') return badRequest(res, 'الشفت مغلق بالفعل');
  if (shift.cashier_id !== req.user.id && !req.user.has('shifts.manage')) return res.status(403).json({ error: 'غير مصرح — الشفت لكاشير آخر' });
  const { errors, data } = validate(req.body, {
    actual_cash: { required: true, type: 'number', min: 0, label: 'النقدية الفعلية' },
    notes: { maxLen: 500, default: '' },
  });
  if (errors.length) return badRequest(res, errors.join('، '));
  const expected = shift.opening_cash + shift.cash_sales - shift.refunds - shift.expenses;
  const difference = Math.round((data.actual_cash - expected) * 100) / 100;
  tx(() => {
    db.prepare(`UPDATE shifts SET closed_at=datetime('now','localtime'), expected_cash=?, actual_cash=?, difference=?, status='closed', notes=? WHERE id=?`)
      .run(expected, data.actual_cash, difference, data.notes || shift.notes, shift.id);
  })();
  audit(req, { action: 'close', entity: 'shifts', entityId: shift.id, newData: { expected_cash: expected, actual_cash: data.actual_cash, difference } });
  res.json({ ok: true, expected_cash: expected, actual_cash: data.actual_cash, difference, status: difference > 0 ? 'زيادة' : difference < 0 ? 'عجز' : 'مطابق' });
});

// قائمة الشفتات
router.get('/shifts', requirePermission('shifts.manage', 'shifts.open', 'shifts.close'), (req, res) => {
  const { from, to, cashier_id, pos_location_id, status } = req.query;
  let sql = `SELECT s.*, u.full_name AS cashier_name, pl.name AS pos_name
    FROM shifts s JOIN users u ON u.id=s.cashier_id JOIN pos_locations pl ON pl.id=s.pos_location_id WHERE 1=1`;
  const args = [];
  // الكاشير يرى شفتاته فقط إلا إذا كان لديه صلاحية الإدارة
  if (!req.user.has('shifts.manage')) { sql += ' AND s.cashier_id=?'; args.push(req.user.id); }
  if (req.user.posIds.length) { sql += ` AND s.pos_location_id IN (${req.user.posIds.map(() => '?').join(',')})`; args.push(...req.user.posIds); }
  if (from) { sql += ' AND s.opened_at >= ?'; args.push(from + ' 00:00:00'); }
  if (to) { sql += ' AND s.opened_at <= ?'; args.push(to + ' 23:59:59'); }
  if (cashier_id) { sql += ' AND s.cashier_id=?'; args.push(cashier_id); }
  if (pos_location_id) { sql += ' AND s.pos_location_id=?'; args.push(pos_location_id); }
  if (status) { sql += ' AND s.status=?'; args.push(status); }
  sql += ' ORDER BY s.id DESC LIMIT 300';
  res.json(db.prepare(sql).all(...args));
});

// تفاصيل شفت مع حركات النقدية
router.get('/shifts/:id', requirePermission('shifts.manage', 'shifts.open', 'shifts.close'), (req, res) => {
  const shift = db.prepare(`SELECT s.*, u.full_name AS cashier_name, pl.name AS pos_name
    FROM shifts s JOIN users u ON u.id=s.cashier_id JOIN pos_locations pl ON pl.id=s.pos_location_id WHERE s.id=?`).get(req.params.id);
  if (!shift) return notFound(res, 'الشفت غير موجود');
  if (!req.user.has('shifts.manage') && shift.cashier_id !== req.user.id) return res.status(403).json({ error: 'غير مصرح' });
  shift.movements = db.prepare('SELECT * FROM cash_movements WHERE shift_id=? ORDER BY id').all(shift.id);
  shift.invoices_count = db.prepare('SELECT COUNT(*) c FROM invoices WHERE shift_id=?').get(shift.id).c;
  res.json(shift);
});

export default router;
