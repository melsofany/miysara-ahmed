# معرفة المشروع — MIYSARA Ahmed

## تشغيل سريع
- API: `cd server && npm start` → http://localhost:12001 (الصحة: `/api/health`)
- الواجهة (تطوير): `cd client && npm run dev` → http://localhost:12000 (proxy لـ /api)
- الواجهة (إنتاج): `cd client && npm run build` → `client/dist`
- الـ seed: `cd server && npm run seed` (ينشئ الإدمن `admin/admin123`)
- الاختبار التكاملي: `cd server && node test/flow.test.js` (27 اختبار، كلها تمر)

## البنية الحاسمة
- `server/src/db.js` — SQLite Schema مصحوبة بقيود صارمة (FK/CHECK/UNIQUE + ربط حركات المخزون)
- المخزون = حركات في `inventory_movements`، الرصيد الحالي في `stock_levels` (يتزامن داخل معاملات `inventory-core.js`)
- الصلاحيات بصيغة `مجال.فعل`؛ `requirePermission()` في `server/src/middleware/auth.js`
- الـ API كله تحت `/api`، والواجهة تحت React Routes
- الوإندبوينت `/pos/:id/search` يدعم حقول فيلتر متعددة (لون/مقاس/تصنيف/موسم/مورد/سعر/...) — لا يوجد `/pos/advanced-search`
- البيع يتم عبر `POST /api/invoices` وليس `/sales`
- إنشاء المنتج يعيد `{ id, variants }` (الواجهة تعتمد على وجود variants)

## حيل
- الـ seed يخلق 6 أدوار وقائمة الصلاحيات الافتراضية
- `npm run dev` في client يضبط vite.config: host 0.0.0.0، port 12000، السماح بـ allowedHosts: true

## البيانات القديمة (ESClothes / SQL Server 2000)
- `old_data/old_db.bak` (351 ம) — تم تحليل MTF → TAPE/VOLB/SFMB → صفحات SQL 8KB من offset 0x1a00؛ sysobjects/syscolumns مقروءان
- `extract3.py` يحتوي المنطق السليم: parse_record/parse_table واستنتاج الأعمدة المحذوفة
- المخزون القديم يُحسب من `Trans_Details` مجموعًا ناقص الديلي (لا توجد جردة Current)
- الاستخراج النهائي: `extract_all.py` → table_*.json؛ الترحيل: `migrate.js` (ينظف الترميز ويسطر الأسعار)
- نتيجة الترحيل: 7050 منتج، 6840 variant، ~6543 حركة، ~595k قطعة
