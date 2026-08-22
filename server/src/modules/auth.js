import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import db from '../db.js';
import { signToken, authRequired, loadUser } from '../middleware/auth.js';
import { audit, badRequest } from '../middleware/audit.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'محاولات كثيرة، حاول لاحقًا' },
});

router.post('/login', loginLimiter, (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username || !password) return badRequest(res, 'اسم المستخدم وكلمة المرور مطلوبان');

  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
  }
  if (!user.is_active) return res.status(403).json({ error: 'الحساب معطّل، تواصل مع الإدارة' });

  req.user = loadUser(user.id);
  audit(req, { action: 'login', entity: 'users', entityId: user.id });
  const token = signToken(user);
  const { password_hash, ...safe } = req.user;
  safe.permissions = [...req.user.permissions];
  res.json({ token, user: { ...safe, warehouseIds: req.user.warehouseIds, posIds: req.user.posIds } });
});

router.get('/me', authRequired, (req, res) => {
  const { ...u } = req.user;
  u.permissions = [...req.user.permissions];
  res.json({ user: u });
});

router.post('/change-password', authRequired, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!new_password || String(new_password).length < 6) return badRequest(res, 'كلمة المرور الجديدة 6 أحرف على الأقل');
  const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(String(current_password || ''), row.password_hash)) return badRequest(res, 'كلمة المرور الحالية غير صحيحة');
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(String(new_password), 10), req.user.id);
  audit(req, { action: 'change_password', entity: 'users', entityId: req.user.id });
  res.json({ ok: true });
});

export default router;
