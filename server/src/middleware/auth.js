import jwt from 'jsonwebtoken';
import db from '../db.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'miysara-dev-secret-change-me-in-production';
const TOKEN_TTL = process.env.TOKEN_TTL || '12h';

export function signToken(user) {
  return jwt.sign({ uid: user.id, username: user.username }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

const userQuery = db.prepare(`
  SELECT u.id, u.username, u.full_name, u.phone, u.email, u.is_active, u.role_id, r.name AS role_name, r.name_ar AS role_name_ar
  FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`);
const permsQuery = db.prepare(`
  SELECT p.code FROM permissions p
  JOIN role_permissions rp ON rp.permission_id = p.id
  WHERE rp.role_id = ?`);
const userWarehousesQuery = db.prepare('SELECT warehouse_id FROM user_warehouses WHERE user_id=?');
const userPosQuery = db.prepare('SELECT pos_location_id FROM user_pos_locations WHERE user_id=?');

export function loadUser(id) {
  const user = userQuery.get(id);
  if (!user || !user.is_active) return null;
  user.permissions = new Set(permsQuery.all(user.role_id).map(r => r.code));
  // القوائم الفارغة تعني: وصول غير مقيد (مديرون). الربط يقيّد المستخدم بالمواقع المحددة فقط.
  user.warehouseIds = userWarehousesQuery.all(user.id).map(r => r.warehouse_id);
  user.posIds = userPosQuery.all(user.id).map(r => r.pos_location_id);
  user.has = (code) => user.permissions.has(code);
  user.canAccessWarehouse = (wid) => user.warehouseIds.length === 0 || user.warehouseIds.includes(Number(wid));
  user.canAccessPos = (pid) => user.posIds.length === 0 || user.posIds.includes(Number(pid));
  return user;
}

export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'مطلوب تسجيل الدخول' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = loadUser(payload.uid);
    if (!user) return res.status(401).json({ error: 'الحساب غير موجود أو معطّل' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'جلسة غير صالحة، سجّل الدخول مجددًا' });
  }
}

export function requirePermission(...codes) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'مطلوب تسجيل الدخول' });
    if (codes.some(c => req.user.has(c))) return next();
    return res.status(403).json({ error: 'ليس لديك صلاحية لتنفيذ هذه العملية' });
  };
}
