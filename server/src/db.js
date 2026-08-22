import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'miysara.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  description TEXT,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  group_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS user_warehouses (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, warehouse_id)
);

CREATE TABLE IF NOT EXISTS user_pos_locations (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pos_location_id INTEGER NOT NULL REFERENCES pos_locations(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, pos_location_id)
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (name, parent_id)
);

CREATE TABLE IF NOT EXISTS seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS manufacturers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  barcode TEXT UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  category_id INTEGER REFERENCES categories(id),
  season_id INTEGER REFERENCES seasons(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  manufacturer_id INTEGER REFERENCES manufacturers(id),
  model_number TEXT,
  cost_price REAL NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  selling_price REAL NOT NULL DEFAULT 0 CHECK (selling_price >= 0),
  min_stock REAL NOT NULL DEFAULT 0,
  image TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS product_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku TEXT NOT NULL UNIQUE,
  barcode TEXT UNIQUE,
  size TEXT,
  color TEXT,
  cost_price REAL NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  selling_price REAL NOT NULL DEFAULT 0 CHECK (selling_price >= 0),
  min_stock REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS warehouses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  address TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pos_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  address TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS stock_levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location_type TEXT NOT NULL CHECK (location_type IN ('warehouse','pos')),
  location_id INTEGER NOT NULL,
  variant_id INTEGER NOT NULL REFERENCES product_variants(id),
  quantity REAL NOT NULL DEFAULT 0,
  avg_cost REAL NOT NULL DEFAULT 0,
  UNIQUE (location_type, location_id, variant_id)
);
CREATE INDEX IF NOT EXISTS idx_stock_variant ON stock_levels(variant_id);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  movement_number TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  user_id INTEGER REFERENCES users(id),
  variant_id INTEGER NOT NULL REFERENCES product_variants(id),
  quantity REAL NOT NULL,
  cost_price REAL NOT NULL DEFAULT 0,
  source_type TEXT CHECK (source_type IN ('supplier','warehouse','pos','external','customer') OR source_type IS NULL),
  source_id INTEGER,
  dest_type TEXT CHECK (dest_type IN ('supplier','warehouse','pos','external','customer') OR dest_type IS NULL),
  dest_id INTEGER,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('RECEIVE_SUPPLIER','ADD','ISSUE','TRANSFER','TRANSFER_TO_POS','POS_RECEIVE','POS_RETURN','ADJUSTMENT','STOCKTAKE','SALE','SALE_RETURN','SALE_EDIT_REVERSE','SALE_EDIT_APPLY','CANCEL_REVERSE')),
  document_number TEXT,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_movements_variant ON inventory_movements(variant_id);
CREATE INDEX IF NOT EXISTS idx_movements_date ON inventory_movements(created_at);
CREATE INDEX IF NOT EXISTS idx_movements_type ON inventory_movements(movement_type);

CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pos_location_id INTEGER NOT NULL REFERENCES pos_locations(id),
  cashier_id INTEGER NOT NULL REFERENCES users(id),
  opened_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  closed_at TEXT,
  opening_cash REAL NOT NULL DEFAULT 0,
  cash_sales REAL NOT NULL DEFAULT 0,
  card_sales REAL NOT NULL DEFAULT 0,
  wallet_sales REAL NOT NULL DEFAULT 0,
  transfer_sales REAL NOT NULL DEFAULT 0,
  refunds REAL NOT NULL DEFAULT 0,
  expenses REAL NOT NULL DEFAULT 0,
  expected_cash REAL,
  actual_cash REAL,
  difference REAL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_open_shift ON shifts(cashier_id, pos_location_id) WHERE status='open';

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  pos_location_id INTEGER NOT NULL REFERENCES pos_locations(id),
  cashier_id INTEGER NOT NULL REFERENCES users(id),
  shift_id INTEGER REFERENCES shifts(id),
  subtotal REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','card','bank_transfer','wallet')),
  paid_amount REAL NOT NULL DEFAULT 0,
  change_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','edited','cancelled','returned','partially_returned')),
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(created_at);
CREATE INDEX IF NOT EXISTS idx_invoices_pos ON invoices(pos_location_id);
CREATE INDEX IF NOT EXISTS idx_invoices_cashier ON invoices(cashier_id);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  variant_id INTEGER NOT NULL REFERENCES product_variants(id),
  product_name TEXT NOT NULL,
  size TEXT,
  color TEXT,
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_price REAL NOT NULL CHECK (unit_price >= 0),
  cost_price REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  returned_qty REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_invoice ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_items_variant ON invoice_items(variant_id);

CREATE TABLE IF NOT EXISTS returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_number TEXT NOT NULL UNIQUE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  user_id INTEGER NOT NULL REFERENCES users(id),
  return_type TEXT NOT NULL CHECK (return_type IN ('full','partial')),
  reason TEXT,
  total_refund REAL NOT NULL DEFAULT 0,
  refund_method TEXT NOT NULL DEFAULT 'cash' CHECK (refund_method IN ('cash','card','bank_transfer','wallet'))
);
CREATE INDEX IF NOT EXISTS idx_returns_invoice ON returns(invoice_id);

CREATE TABLE IF NOT EXISTS return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  invoice_item_id INTEGER NOT NULL REFERENCES invoice_items(id),
  variant_id INTEGER NOT NULL REFERENCES product_variants(id),
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_price REAL NOT NULL,
  total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS cash_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id INTEGER NOT NULL REFERENCES shifts(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  type TEXT NOT NULL CHECK (type IN ('sale','refund','expense')),
  amount REAL NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  reference_id INTEGER,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_cash_shift ON cash_movements(shift_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  old_data TEXT,
  new_data TEXT,
  reason TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

export function getSetting(key, def = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? row.value : def;
}
export function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}

let seqStmt = null;
export function nextNumber(prefix) {
  db.prepare(`INSERT INTO settings(key,value) VALUES(?, '0') ON CONFLICT(key) DO NOTHING`).run('seq_' + prefix);
  db.prepare(`UPDATE settings SET value = CAST(CAST(value AS INTEGER)+1 AS TEXT) WHERE key=?`).run('seq_' + prefix);
  const v = db.prepare('SELECT value FROM settings WHERE key=?').get('seq_' + prefix).value;
  return `${prefix}-${String(v).padStart(6, '0')}`;
}

export default db;
