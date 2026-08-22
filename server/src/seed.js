import db, { setSetting } from './db.js';
import bcrypt from 'bcryptjs';

export const PERMISSIONS = [
  ['dashboard.view', 'مشاهدة لوحة التحكم', 'لوحة التحكم'],
  ['products.view', 'مشاهدة المنتجات', 'المنتجات'],
  ['products.create', 'إضافة منتجات', 'المنتجات'],
  ['products.edit', 'تعديل المنتجات', 'المنتجات'],
  ['products.delete', 'حذف المنتجات', 'المنتجات'],
  ['catalog.manage', 'إدارة البيانات الأساسية (تصنيفات/موردين/ماركات/مواسم)', 'البيانات الأساسية'],
  ['inventory.view', 'مشاهدة المخزون', 'المخزون'],
  ['inventory.receive', 'استلام بضاعة من المورد', 'المخزون'],
  ['inventory.transfer', 'تحويل مخزون', 'المخزون'],
  ['inventory.adjust', 'تسوية مخزون', 'المخزون'],
  ['inventory.stocktake', 'جرد المخزون', 'المخزون'],
  ['warehouses.manage', 'إدارة المخازن', 'المخزون'],
  ['pos.sell', 'البيع على نقاط البيع', 'نقاط البيع'],
  ['pos.manage', 'إدارة نقاط البيع', 'نقاط البيع'],
  ['invoices.view', 'مشاهدة الفواتير', 'الفواتير'],
  ['invoices.edit', 'تعديل الفواتير', 'الفواتير'],
  ['invoices.cancel', 'إلغاء الفواتير', 'الفواتير'],
  ['invoices.print', 'طباعة الفواتير', 'الفواتير'],
  ['invoices.export', 'تصدير الفواتير', 'الفواتير'],
  ['returns.execute', 'تنفيذ المرتجعات', 'المرتجعات'],
  ['returns.view', 'مشاهدة المرتجعات', 'المرتجعات'],
  ['shifts.open', 'فتح شفت', 'الشفتات'],
  ['shifts.close', 'إغلاق شفت', 'الشفتات'],
  ['shifts.manage', 'إدارة ومراجعة الشفتات', 'الشفتات'],
  ['expenses.manage', 'تسجيل مصروفات نقدية', 'الشفتات'],
  ['reports.view', 'مشاهدة التقارير', 'التقارير'],
  ['reports.export', 'تصدير التقارير', 'التقارير'],
  ['cost.view', 'مشاهدة تكلفة المنتجات', 'المالية'],
  ['profit.view', 'مشاهدة الأرباح', 'المالية'],
  ['users.manage', 'إدارة المستخدمين والأدوار', 'النظام'],
  ['settings.manage', 'إدارة الإعدادات', 'النظام'],
  ['audit.view', 'مشاهدة سجل العمليات', 'النظام'],
];

const ROLES = {
  'super_admin': { ar: 'مدير النظام الأعلى', perms: 'ALL' },
  'system_manager': {
    ar: 'مدير النظام',
    perms: ['dashboard.view', 'products.view', 'products.create', 'products.edit', 'products.delete', 'catalog.manage',
      'inventory.view', 'inventory.receive', 'inventory.transfer', 'inventory.adjust', 'inventory.stocktake', 'warehouses.manage',
      'pos.sell', 'pos.manage', 'invoices.view', 'invoices.edit', 'invoices.cancel', 'invoices.print', 'invoices.export',
      'returns.execute', 'returns.view', 'shifts.open', 'shifts.close', 'shifts.manage', 'expenses.manage',
      'reports.view', 'reports.export', 'cost.view', 'profit.view', 'users.manage', 'settings.manage', 'audit.view'],
  },
  'warehouse_manager': {
    ar: 'مدير مخزن',
    perms: ['dashboard.view', 'products.view', 'products.create', 'products.edit', 'catalog.manage',
      'inventory.view', 'inventory.receive', 'inventory.transfer', 'inventory.adjust', 'inventory.stocktake', 'warehouses.manage',
      'reports.view', 'reports.export', 'cost.view'],
  },
  'warehouse_user': {
    ar: 'مستخدم مخزن',
    perms: ['products.view', 'inventory.view', 'inventory.receive', 'inventory.transfer'],
  },
  'pos_manager': {
    ar: 'مدير نقطة بيع',
    perms: ['dashboard.view', 'products.view', 'inventory.view', 'pos.sell',
      'invoices.view', 'invoices.edit', 'invoices.cancel', 'invoices.print',
      'returns.execute', 'returns.view', 'shifts.open', 'shifts.close', 'shifts.manage', 'expenses.manage',
      'reports.view', 'cost.view'],
  },
  'cashier': {
    ar: 'كاشير',
    perms: ['products.view', 'pos.sell', 'invoices.view', 'invoices.print', 'returns.execute', 'returns.view', 'shifts.open', 'shifts.close'],
  },
};

export function seed() {
  const tx = db.transaction(() => {
    const insPerm = db.prepare('INSERT OR IGNORE INTO permissions(code, name_ar, group_name) VALUES (?,?,?)');
    for (const [code, ar, grp] of PERMISSIONS) insPerm.run(code, ar, grp);

    const insRole = db.prepare('INSERT OR IGNORE INTO roles(name, name_ar, description, is_system) VALUES (?,?,?,1)');
    const getRole = db.prepare('SELECT id FROM roles WHERE name=?');
    const getPerm = db.prepare('SELECT id FROM permissions WHERE code=?');
    const insRP = db.prepare('INSERT OR IGNORE INTO role_permissions(role_id, permission_id) VALUES (?,?)');
    const allPerms = db.prepare('SELECT id FROM permissions').all().map(r => r.id);

    for (const [name, def] of Object.entries(ROLES)) {
      insRole.run(name, def.ar, def.ar);
      const roleId = getRole.get(name).id;
      const ids = def.perms === 'ALL' ? allPerms : def.perms.map(c => getPerm.get(c)?.id).filter(Boolean);
      for (const pid of ids) insRP.run(roleId, pid);
    }

    const admin = db.prepare('SELECT id FROM users WHERE username=?').get('admin');
    if (!admin) {
      const roleId = getRole.get('super_admin').id;
      db.prepare('INSERT INTO users(username, password_hash, full_name, role_id) VALUES (?,?,?,?)')
        .run('admin', bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10), 'مدير النظام الأعلى', roleId);
    }

    const insSeason = db.prepare('INSERT OR IGNORE INTO seasons(name) VALUES (?)');
    for (const s of ['صيفي', 'شتوي', 'جميع المواسم']) insSeason.run(s);

    const insCat = db.prepare('INSERT OR IGNORE INTO categories(name, parent_id) VALUES (?, NULL)');
    for (const c of ['ملابس مواليد', 'ملابس أطفال', 'ملابس داخلية', 'رجالي', 'حريمي', 'رياضية', 'أحذية', 'إكسسوارات']) insCat.run(c);

    const insWh = db.prepare('INSERT OR IGNORE INTO warehouses(name, code) VALUES (?,?)');
    insWh.run('المخزن الرئيسي', 'MAIN');

    setSetting('store_name', 'MIYSARA Ahmed – ميسرة أحمد');
    setSetting('allow_negative_stock', '0');
    setSetting('receipt_footer', 'شكراً لتسوقكم معنا - ميسرة أحمد');
    setSetting('currency', 'EGP');
  });
  tx();
  console.log('Seed completed.');
}

if (import.meta.url === `file://${process.argv[1]}`) seed();
