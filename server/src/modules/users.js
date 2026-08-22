import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { requirePermission } from '../middleware/auth.js';
import { audit, badRequest, notFound, validate } from '../middleware/audit.js';

const router = Router();

// ---------- الأدوار والصلاحيات ----------
router.get('/permissions', requirePermission('users.manage'), (req, res) => {
  res.json(db.prepare('SELECT * FROM permissions ORDER BY group_name, id').all());
});

router.get('/roles', requirePermission('users.manage'), (req, res) => {
  const roles = db.prepare('SELECT * FROM roles ORDER BY id').all();
  const perms = db.prepare(`SELECT rp.role_id, p.code FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id`).all();
  const map = {};
  for (const p of perms) (map[p.role_id] ||= []).push(p.code);
  res.json(roles.map(r => ({ ...r, permissions: map[r.id] || [] })));
});

router.post('/roles', requirePermission('users.manage'), (req, res) => {
  const { errors, data } = validate(req.body, {
    name: { required: true, label: 'اسم الدور (إنجليزي)', maxLen: 50 },
    name_ar: { required: true, label: 'اسم الدور', maxLen: 100 },
    description: { maxLen: 255, default: '' },
  });
  if (errors.length) return badRequest(res, errors.join('، '));
  if (!/^[a-z0-9_]+$/.test(data.name)) return badRequest(res, 'اسم الدور الإنجليزي: حروف صغيرة وأرقام و _ فقط');
  const perms = Array.isArray(req.body.permissions) ? req.body.permissions : [];
  try {
    const tx = db.transaction(() => {
      const info = db.prepare('INSERT INTO roles(name,name_ar,description) VALUES (?,?,?)').run(data.name, data.name_ar, data.description);
      const roleId = info.lastInsertRowid;
      const getPerm = db.prepare('SELECT id FROM permissions WHERE code=?');
      const ins = db.prepare('INSERT OR IGNORE INTO role_permissions(role_id,permission_id) VALUES (?,?)');
      for (const code of perms) { const p = getPerm.get(code); if (p) ins.run(roleId, p.id); }
      return roleId;
    });
    const roleId = tx();
    audit(req, { action: 'create', entity: 'roles', entityId: roleId, newData: { ...data, permissions: perms } });
    res.status(201).json({ id: roleId });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return badRequest(res, 'اسم الدور مستخدم من قبل');
    throw e;
  }
});

router.put('/roles/:id', requirePermission('users.manage'), (req, res) => {
  const role = db.prepare('SELECT * FROM roles WHERE id=?').get(req.params.id);
  if (!role) return notFound(res, 'الدور غير موجود');
  const { errors, data } = validate(req.body, {
    name_ar: { required: true, label: 'اسم الدور', maxLen: 100 },
    description: { maxLen: 255, default: '' },
  });
  if (errors.length) return badRequest(res, errors.join('، '));
  const perms = Array.isArray(req.body.permissions) ? req.body.permissions : null;
  const tx = db.transaction(() => {
    db.prepare('UPDATE roles SET name_ar=?, description=? WHERE id=?').run(data.name_ar, data.description, role.id);
    if (perms) {
      db.prepare('DELETE FROM role_permissions WHERE role_id=?').run(role.id);
      const getPerm = db.prepare('SELECT id FROM permissions WHERE code=?');
      const ins = db.prepare('INSERT OR IGNORE INTO role_permissions(role_id,permission_id) VALUES (?,?)');
      for (const code of perms) { const p = getPerm.get(code); if (p) ins.run(role.id, p.id); }
    }
  });
  tx();
  audit(req, { action: 'update', entity: 'roles', entityId: role.id, oldData: role, newData: { ...data, permissions: perms } });
  res.json({ ok: true });
});

router.delete('/roles/:id', requirePermission('users.manage'), (req, res) => {
  const role = db.prepare('SELECT * FROM roles WHERE id=?').get(req.params.id);
  if (!role) return notFound(res, 'الدور غير موجود');
  if (role.is_system) return badRequest(res, 'لا يمكن حذف دور نظام');
  const used = db.prepare('SELECT COUNT(*) c FROM users WHERE role_id=?').get(role.id).c;
  if (used > 0) return badRequest(res, `الدور مرتبط بـ ${used} مستخدم`);
  db.prepare('DELETE FROM roles WHERE id=?').run(role.id);
  audit(req, { action: 'delete', entity: 'roles', entityId: role.id, oldData: role });
  res.json({ ok: true });
});

// ---------- المستخدمون ----------
router.get('/users', requirePermission('users.manage'), (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.full_name, u.phone, u.email, u.is_active, u.created_at, u.role_id, r.name_ar AS role_name
    FROM users u JOIN roles r ON r.id=u.role_id ORDER BY u.id`).all();
  const wh = db.prepare('SELECT user_id, warehouse_id FROM user_warehouses').all();
  const pos = db.prepare('SELECT user_id, pos_location_id FROM user_pos_locations').all();
  const whMap = {}, posMap = {};
  for (const r of wh) (whMap[r.user_id] ||= []).push(r.warehouse_id);
  for (const r of pos) (posMap[r.user_id] ||= []).push(r.pos_location_id);
  res.json(users.map(u => ({ ...u, warehouse_ids: whMap[u.id] || [], pos_ids: posMap[u.id] || [] })));
});

function saveUserScopes(userId, warehouseIds, posIds) {
  db.prepare('DELETE FROM user_warehouses WHERE user_id=?').run(userId);
  db.prepare('DELETE FROM user_pos_locations WHERE user_id=?').run(userId);
  const insWh = db.prepare('INSERT OR IGNORE INTO user_warehouses(user_id,warehouse_id) VALUES (?,?)');
  const insPos = db.prepare('INSERT OR IGNORE INTO user_pos_locations(user_id,pos_location_id) VALUES (?,?)');
  for (const w of warehouseIds || []) insWh.run(userId, w);
  for (const p of posIds || []) insPos.run(userId, p);
}

router.post('/users', requirePermission('users.manage'), (req, res) => {
  const { errors, data } = validate(req.body, {
    username: { required: true, label: 'اسم المستخدم', maxLen: 50 },
    password: { required: true, label: 'كلمة المرور' },
    full_name: { required: true, label: 'الاسم الكامل', maxLen: 100 },
    phone: { maxLen: 30, default: '' },
    email: { maxLen: 100, default: '' },
    role_id: { required: true, type: 'int', label: 'الدور' },
  });
  if (errors.length) return badRequest(res, errors.join('، '));
  if (String(data.password).length < 6) return badRequest(res, 'كلمة المرور 6 أحرف على الأقل');
  if (!db.prepare('SELECT id FROM roles WHERE id=?').get(data.role_id)) return badRequest(res, 'الدور غير موجود');
  try {
    const tx = db.transaction(() => {
      const info = db.prepare('INSERT INTO users(username,password_hash,full_name,phone,email,role_id) VALUES (?,?,?,?,?,?)')
        .run(data.username, bcrypt.hashSync(String(data.password), 10), data.full_name, data.phone, data.email, data.role_id);
      saveUserScopes(info.lastInsertRowid, req.body.warehouse_ids, req.body.pos_ids);
      return info.lastInsertRowid;
    });
    const id = tx();
    audit(req, { action: 'create', entity: 'users', entityId: id, newData: { ...data, password: undefined } });
    res.status(201).json({ id });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return badRequest(res, 'اسم المستخدم مستخدم من قبل');
    throw e;
  }
});

router.put('/users/:id', requirePermission('users.manage'), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!user) return notFound(res, 'المستخدم غير موجود');
  const { errors, data } = validate(req.body, {
    full_name: { required: true, label: 'الاسم الكامل', maxLen: 100 },
    phone: { maxLen: 30, default: '' },
    email: { maxLen: 100, default: '' },
    role_id: { required: true, type: 'int', label: 'الدور' },
    is_active: { type: 'boolean', default: user.is_active },
  });
  if (errors.length) return badRequest(res, errors.join('، '));
  if (user.username === 'admin' && !data.is_active) return badRequest(res, 'لا يمكن تعطيل حساب المدير الأعلى');
  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET full_name=?, phone=?, email=?, role_id=?, is_active=? WHERE id=?')
      .run(data.full_name, data.phone, data.email, data.role_id, data.is_active, user.id);
    if (req.body.password) {
      if (String(req.body.password).length < 6) throw new Error('كلمة المرور 6 أحرف على الأقل');
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(String(req.body.password), 10), user.id);
    }
    saveUserScopes(user.id, req.body.warehouse_ids, req.body.pos_ids);
  });
  try { tx(); } catch (e) { return badRequest(res, e.message); }
  audit(req, { action: 'update', entity: 'users', entityId: user.id, oldData: { ...user, password_hash: undefined }, newData: { ...data, password: req.body.password ? '***' : undefined } });
  res.json({ ok: true });
});

router.delete('/users/:id', requirePermission('users.manage'), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!user) return notFound(res, 'المستخدم غير موجود');
  if (user.username === 'admin') return badRequest(res, 'لا يمكن حذف حساب المدير الأعلى');
  if (user.id === req.user.id) return badRequest(res, 'لا يمكنك حذف حسابك');
  const hasOps = db.prepare('SELECT (SELECT COUNT(*) FROM invoices WHERE cashier_id=?) + (SELECT COUNT(*) FROM inventory_movements WHERE user_id=?) AS c').get(user.id, user.id).c;
  if (hasOps > 0) {
    db.prepare('UPDATE users SET is_active=0 WHERE id=?').run(user.id);
    audit(req, { action: 'deactivate', entity: 'users', entityId: user.id, reason: 'له عمليات مسجلة — تم التعطيل بدلاً من الحذف' });
    return res.json({ ok: true, deactivated: true });
  }
  db.prepare('DELETE FROM users WHERE id=?').run(user.id);
  audit(req, { action: 'delete', entity: 'users', entityId: user.id, oldData: { ...user, password_hash: undefined } });
  res.json({ ok: true });
});

export default router;
