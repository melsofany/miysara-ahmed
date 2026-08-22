# MIYSARA Ahmed — ميسرة أحمد
## System Architecture & Database Design (المرحلة 1)

نظام متكامل لإدارة محلات الملابس يتكون من ثلاثة أنظمة فرعية:
1. **نظام إدارة المخازن (WMS)**
2. **نظام مدير النظام والإدارة المركزية (Admin)**
3. **نظام نقاط البيع (POS / Cashier)**

---

## 1. Technical Stack

| الطبقة | التقنية |
|---|---|
| Frontend | React 18 + Vite + TailwindCSS (RTL، عربي بالكامل، Touch-friendly) |
| Backend | Node.js + Express (REST API) |
| Database | SQLite (better-sqlite3) — معاملات Atomic متزامنة |
| Auth | JWT + bcrypt |
| Audit | جدول audit_logs مركزي |

البنية **Modular Monolith**: كل وحدة (module) لها routes + service مستقل، قابلة للفصل مستقبلاً إلى microservices.

```
miysara-ahmed/
├── docs/ARCHITECTURE.md
├── server/            # Express API
│   ├── src/
│   │   ├── index.js           # entry
│   │   ├── db.js              # schema + connection
│   │   ├── seed.js            # roles/permissions/admin seed
│   │   ├── middleware/        # auth, permissions, audit, errors
│   │   ├── modules/
│   │   │   ├── auth/  users/  roles/
│   │   │   ├── catalog/       # products, variants, categories, seasons, suppliers, manufacturers
│   │   │   ├── inventory/     # warehouses, movements, stock
│   │   │   ├── pos/           # pos locations, sales screen API
│   │   │   ├── sales/         # invoices, payments, returns
│   │   │   ├── shifts/        # cash drawer & shifts
│   │   │   ├── reports/       # dashboard + reports
│   │   │   └── settings/
│   │   └── utils/
├── client/            # React SPA (RTL)
└── old_data/          # قاعدة البيانات القديمة + الاستيراد
```

---

## 2. Entity Relationship Diagram (نصي)

```
ROLES 1───n ROLE_PERMISSIONS n───1 PERMISSIONS
USERS n───1 ROLES
USERS n───n WAREHOUSES        (user_warehouses)
USERS n───n POS_LOCATIONS     (user_pos_locations)

CATEGORIES 1───n CATEGORIES (parent_id: تصنيفات فرعية)
SUPPLIERS 1───n PRODUCTS
MANUFACTURERS 1───n PRODUCTS
SEASONS 1───n PRODUCTS
CATEGORIES 1───n PRODUCTS
PRODUCTS 1───n PRODUCT_VARIANTS      (Size/Color/SKU/Barcode مستقل)

WAREHOUSES 1───n STOCK_LEVELS (location_type='warehouse')
POS_LOCATIONS 1───n STOCK_LEVELS (location_type='pos')
PRODUCT_VARIANTS 1───n STOCK_LEVELS
PRODUCT_VARIANTS 1───n INVENTORY_MOVEMENTS

POS_LOCATIONS 1───n INVOICES
USERS (cashier) 1───n INVOICES
SHIFTS 1───n INVOICES
INVOICES 1───n INVOICE_ITEMS n───1 PRODUCT_VARIANTS
INVOICES 1───n RETURNS 1───n RETURN_ITEMS

POS_LOCATIONS 1───n SHIFTS
USERS 1───n SHIFTS
SHIFTS 1───n CASH_MOVEMENTS

USERS 1───n AUDIT_LOGS
```

---

## 3. Database Schema

### الأمان والمستخدمون
- **roles**(id, name UNIQUE, name_ar, description, is_system)
- **permissions**(id, code UNIQUE, name_ar, group_name)
- **role_permissions**(role_id, permission_id, PK(role_id,permission_id))
- **users**(id, username UNIQUE, password_hash, full_name, phone, email, role_id→roles, is_active, created_at)
- **user_warehouses**(user_id, warehouse_id)
- **user_pos_locations**(user_id, pos_location_id)

### البيانات الأساسية (Master Data)
- **categories**(id, name, parent_id NULL→categories, is_active)
- **seasons**(id, name)
- **suppliers**(id, name, contact_person, phone, email, address, is_active)
- **manufacturers**(id, name)
- **products**(id, sku UNIQUE, barcode UNIQUE NULL, name, description, category_id, season_id, supplier_id, manufacturer_id, model_number, cost_price, selling_price, min_stock, image, is_active, created_at)
- **product_variants**(id, product_id→products, sku UNIQUE, barcode UNIQUE, size, color, cost_price, selling_price, min_stock, is_active)

### المخازن والمخزون
- **warehouses**(id, name, code UNIQUE, address, is_active)
- **pos_locations**(id, name, code UNIQUE, address, is_active)
- **stock_levels**(id, location_type 'warehouse'|'pos', location_id, variant_id, quantity, avg_cost, UNIQUE(location_type, location_id, variant_id))
- **inventory_movements**(id, movement_number UNIQUE, created_at, user_id, variant_id, quantity, cost_price, source_type, source_id, dest_type, dest_id, movement_type, document_number, notes)

أنواع الحركة `movement_type`:
`RECEIVE_SUPPLIER | ADD | ISSUE | TRANSFER | POS_RECEIVE | POS_RETURN | ADJUSTMENT | STOCKTAKE | SALE | SALE_RETURN`

> المخزون مبني على **الحركات** (append-only) — stock_levels مجرد رصيد مجمّع يُحدَّث داخل نفس المعاملة.

### المبيعات والفواتير
- **invoices**(id, invoice_number UNIQUE, created_at, pos_location_id, cashier_id, shift_id, subtotal, discount, total, payment_method, paid_amount, change_amount, status 'completed'|'edited'|'cancelled'|'returned'|'partially_returned', notes)
- **invoice_items**(id, invoice_id, variant_id, product_name, size, color, quantity, unit_price, cost_price, discount, total)
- **returns**(id, return_number UNIQUE, invoice_id, created_at, user_id, return_type 'full'|'partial', reason, total_refund, refund_method)
- **return_items**(id, return_id, invoice_item_id, variant_id, quantity, unit_price, total)

### الشفتات ودرج النقدية
- **shifts**(id, pos_location_id, cashier_id, opened_at, closed_at, opening_cash, cash_sales, card_sales, wallet_sales, transfer_sales, refunds, expenses, expected_cash, actual_cash, difference, status 'open'|'closed', notes)
- **cash_movements**(id, shift_id, created_at, type 'sale'|'refund'|'expense', amount, payment_method, reference_id, notes)

### النظام
- **audit_logs**(id, user_id, action, entity, entity_id, old_data JSON, new_data JSON, reason, ip, created_at)
- **settings**(key PK, value) — مثل: `allow_negative_stock`, `store_name`, `receipt_footer`

---

## 4. دورة حياة المنتج (Product Lifecycle)

```
إنشاء منتج (Master Data) → إنشاء Variants (Size×Color + Barcode)
→ استلام من المورد في المخزن (RECEIVE_SUPPLIER + تكلفة)
→ متاح للتحويل → بيع → مرتجع → (تسوية/جرد)
```

## 5. دورة حياة المخزون (Inventory Lifecycle)

```
المورد ──RECEIVE_SUPPLIER──▶ المخزن ──TRANSFER──▶ مخزن آخر
   │                            │
   │                            └─TRANSFER_TO_POS─▶ POS ──SALE──▶ العميل
   │                                                   │
   ◀── مرتجع مورد (ISSUE) ─────────── POS_RETURN ◀──SALE_RETURN──┘
```

كل حركة تُسجَّل في `inventory_movements` داخل **معاملة واحدة** مع تحديث `stock_levels` (مصدر −كمية / وجهة +كمية). منع الرصيد السالب إلا بإعداد `allow_negative_stock`. متوسط التكلفة `avg_cost` يُحسب عند الاستلام ويُستخدم في الأرباح.

## 6. دورة حياة الفاتورة (Invoice Lifecycle)

```
مسودة (شاشة POS) → إتمام (completed): خصم المخزون + تسجيل حركة SALE + تسجيل cash_movement في الشفت المفتوح
→ طباعة إيصال
→ تعديل (edited): بصلاحية invoices.edit فقط + Audit Log كامل (old/new + سبب) + عكس وإعادة حركات المخزون
→ إلغاء (cancelled): بصلاحية invoices.cancel + عكس المخزون والنقدية — لا حذف نهائي أبداً
→ مرتجع (partially_returned / returned): عكس جزئي/كامل للمخزون + Refund نقدي
```

## 7. دورة حياة الشفت (Shift Lifecycle)

```
فتح شفت (opening_cash = الفكة) — شفت نشط واحد فقط لكل (كاشير × نقطة بيع)
→ مبيعات/مرتجعات/مصروفات تُسجَّل في cash_movements
→ إغلاق: expected_cash = opening + cash_sales − cash_refunds − expenses
→ الكاشير يدخل actual_cash → difference = actual − expected (زيادة/عجز)
→ مراجعة المدير
```

## 8. نظام الصلاحيات (RBAC)

الصلاحيات بصيغة `module.action`:

| المجموعة | الصلاحيات |
|---|---|
| dashboard | view |
| products | view, create, edit, delete |
| catalog | manage (categories/seasons/suppliers/manufacturers) |
| inventory | view, receive, transfer, adjust, stocktake |
| pos | sell, manage |
| invoices | view, edit, cancel, print, export |
| returns | execute, view |
| shifts | open, close, manage |
| reports | view, export |
| cost | view (رؤية التكلفة) |
| profit | view (رؤية الأرباح) |
| users | manage |
| settings | manage |

الأدوار المبدئية: **Super Admin** (كل شيء) — **System Manager** — **Warehouse Manager** — **Warehouse User** — **POS Manager** — **Cashier** (بيع + مرتجع + شفت فقط، بلا تكلفة/أرباح).

**العزل (Scoping):** المستخدم المرتبط بمخازن/نقاط بيع محددة لا يرى ولا ينفذ إلا عليها. كل API يتحقق من الصلاحية + النطاق.

---

## 9. تدفق البضاعة الكامل

**المورد → المخزن → نقطة البيع → البيع → المرتجع**

| الخطوة | الحركة | الأثر |
|---|---|---|
| استلام من مورد | RECEIVE_SUPPLIER | مخزن +كمية، تحديث avg_cost |
| تحويل لنقطة بيع | TRANSFER_TO_POS + POS_RECEIVE | مخزن −، POS +، التكلفة تنتقل مع البضاعة |
| بيع | SALE | POS −كمية، إيراد + ربح محسوب من avg_cost وقت البيع |
| مرتجع عميل | SALE_RETURN | POS +كمية، Refund، عكس الربح |
| مرتجع من POS للمخزن | POS_RETURN | POS −، مخزن + |

كل عملية مالية/مخزنية = **SQLite Transaction واحدة** (فاتورة + بنود + حركات مخزون + حركة نقدية) — لا يمكن حدوث اختلاف بين الفواتير والمخزون والمدفوعات.
