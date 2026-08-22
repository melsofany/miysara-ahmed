#!/usr/bin/env python3
"""إرسال المبيعات المستوردة إلى خادم الإنتاج عبر نقطة الاستيراد المؤقتة."""
import json, sqlite3, urllib.request, sys, time

BASE = 'https://miysara-ahmed.onrender.com'
ADMIN_KEY = sys.argv[1] if len(sys.argv) > 1 else ''
if not ADMIN_KEY:
    print('مطلوب مفتاح الإدارة: python3 push_sales.py <ADMIN_PASSWORD>'); sys.exit(1)

db = sqlite3.connect('server/data/miysara.db')
invs = db.execute("""SELECT id, invoice_number, created_at, pos_location_id, cashier_id, shift_id,
    subtotal, discount, total, payment_method, paid_amount, change_amount, status, notes
    FROM invoices WHERE invoice_number LIKE 'OLD-%' ORDER BY id""").fetchall()
items = db.execute("""SELECT invoice_id, variant_id, product_name, size, color, quantity,
    unit_price, cost_price, discount, total FROM invoice_items
    WHERE invoice_id IN (SELECT id FROM invoices WHERE invoice_number LIKE 'OLD-%')""").fetchall()
db.close()

print(f'فواتير: {len(invs)} | بنود: {len(items)}')

def post(payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(BASE + '/api/admin/import-sales', data=data,
        headers={'Content-Type': 'application/json', 'x-admin-key': ADMIN_KEY}, method='POST')
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read())
        except Exception as e:
            print(f'  محاولة {attempt+1} فشلت: {e}')
            time.sleep(5 * (attempt + 1))
    raise SystemExit('فشل الإرسال')

# مجزأة: دفعات من 2000 فاتورة مع بنودها
CHUNK = 2000
id_of = {r[0]: i for i, r in enumerate(invs)}
items_by_inv = {}
for it in items:
    items_by_inv.setdefault(it[0], []).append(it)

first = True
for s in range(0, len(invs), CHUNK):
    part = invs[s:s + CHUNK]
    inv_payload = []
    it_payload = []
    for r in part:
        temp_id = id_of[r[0]]
        inv_payload.append({'temp_id': temp_id, 'invoice_number': r[1], 'created_at': r[2],
            'pos_location_id': r[3], 'cashier_id': r[4], 'shift_id': r[5], 'subtotal': r[6],
            'discount': r[7], 'total': r[8], 'payment_method': r[9], 'paid_amount': r[10],
            'change_amount': r[11], 'status': r[12], 'notes': r[13]})
        for it in items_by_inv.get(r[0], []):
            it_payload.append({'invoice_temp_id': temp_id, 'variant_id': it[1], 'product_name': it[2],
                'size': it[3], 'color': it[4], 'quantity': it[5], 'unit_price': it[6],
                'cost_price': it[7], 'discount': it[8], 'total': it[9]})
    res = post({'wipe': first, 'invoices': inv_payload, 'items': it_payload})
    print(f'  دفعة {s}-{s+len(part)}: {res}')
    first = False
    time.sleep(8)  # تفادي حد المعدل
print('تم!')
