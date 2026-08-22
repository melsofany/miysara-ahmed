import db from '../db.js';

const insert = db.prepare(`
  INSERT INTO audit_logs(user_id, action, entity, entity_id, old_data, new_data, reason, ip)
  VALUES (@user_id, @action, @entity, @entity_id, @old_data, @new_data, @reason, @ip)`);

export function audit(req, { action, entity, entityId = null, oldData = null, newData = null, reason = null }) {
  insert.run({
    user_id: req.user?.id ?? null,
    action,
    entity,
    entity_id: entityId != null ? String(entityId) : null,
    old_data: oldData != null ? JSON.stringify(oldData) : null,
    new_data: newData != null ? JSON.stringify(newData) : null,
    reason,
    ip: req.ip || req.socket?.remoteAddress || null,
  });
}

export function badRequest(res, msg) { return res.status(400).json({ error: msg }); }
export function notFound(res, msg = 'العنصر غير موجود') { return res.status(404).json({ error: msg }); }

export function validate(body, rules) {
  const errors = [];
  const out = {};
  for (const [field, rule] of Object.entries(rules)) {
    let v = body?.[field];
    if (v === undefined || v === null || v === '') {
      if (rule.required) errors.push(`${rule.label || field} مطلوب`);
      else if (rule.default !== undefined) out[field] = rule.default;
      continue;
    }
    if (rule.type === 'number') {
      v = Number(v);
      if (Number.isNaN(v)) { errors.push(`${rule.label || field} يجب أن يكون رقمًا`); continue; }
      if (rule.min !== undefined && v < rule.min) { errors.push(`${rule.label || field} أقل من الحد الأدنى (${rule.min})`); continue; }
      if (rule.max !== undefined && v > rule.max) { errors.push(`${rule.label || field} أكبر من الحد الأقصى (${rule.max})`); continue; }
    } else if (rule.type === 'int') {
      v = Number(v);
      if (!Number.isInteger(v)) { errors.push(`${rule.label || field} يجب أن يكون رقمًا صحيحًا`); continue; }
    } else if (rule.type === 'boolean') {
      v = v === true || v === 'true' || v === 1 || v === '1' ? 1 : 0;
    } else {
      v = String(v).trim();
      if (rule.maxLen && v.length > rule.maxLen) { errors.push(`${rule.label || field} طويل جدًا`); continue; }
      if (rule.enum && !rule.enum.includes(v)) { errors.push(`${rule.label || field} قيمة غير صالحة`); continue; }
    }
    out[field] = v;
  }
  return { errors, data: out };
}
