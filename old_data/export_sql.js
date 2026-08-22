#!/usr/bin/env node
/** تصدير قاعدة SQLite إلى ملف SQL نصي للرفع إلى خادم الإنتاج. */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const db = new Database(path.join(__dirname, '../server/data/miysara.db'), { readonly: true });
const out = fs.createWriteStream(path.join(__dirname, 'migration.sql'), { encoding: 'utf8' });

const esc = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (Buffer.isBuffer(v)) return "X'" + v.toString('hex') + "'";
  return "'" + String(v).replace(/'/g, "''") + "'";
};

const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();

out.write("PRAGMA foreign_keys = OFF;\nBEGIN TRANSACTION;\n");
for (const t of tables) {
  // إعادة إنشاء الجدول
  out.write(`DROP TABLE IF EXISTS "${t.name}";\n${t.sql};\n`);
  const rows = db.prepare(`SELECT * FROM "${t.name}"`).all();
  if (rows.length) {
    const cols = Object.keys(rows[0]);
    const colList = cols.map(c => `"${c}"`).join(',');
    for (const r of rows) {
      out.write(`INSERT INTO "${t.name}" (${colList}) VALUES (${cols.map(c => esc(r[c])).join(',')});\n`);
    }
  }
}
out.write("COMMIT;\nPRAGMA foreign_keys = ON;\n");
out.end(() => {
  const size = fs.statSync(path.join(__dirname, 'migration.sql')).size;
  console.log('تم التصدير:', (size / 1024 / 1024).toFixed(2), 'MB');
});
