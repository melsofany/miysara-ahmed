#!/usr/bin/env python3
"""إعادة استيراد الفواتير فقط (البنود ما زالت موجودة في invoice_items).
يربط البنود اليتيمة بالفواتير الجديدة عبر invoice_id القديم المحفوظ."""
import json, sqlite3

DB = 'server/data/miysara.db'
H = json.load(open('old_data/table_Posted_Daily_Trans_Header.json'))
D = json.load(open('old_data/table_Posted_Daily_Trans_Details.json'))

db = sqlite3.connect(DB)
db.execute('PRAGMA foreign_keys = OFF')

var_by_barcode = {}
for r in db.execute("SELECT id, barcode FROM product_variants WHERE barcode IS NOT NULL AND barcode!=''"):
    var_by_barcode.setdefault(r[1], r[0])
suffix_index = {r[1].split('~', 1)[1]: r[0] for r in db.execute("SELECT id, sku FROM product_variants WHERE sku LIKE '%~%'")}

details_by_header = {}
for d in D: details_by_header.setdefault(d['Header_Id'], []).append(d)

def parse_date(h):
    ds = str(h.get('Transaction_Date') or '')
    if len(ds) != 8 or not ds.isdigit(): return None
    y, m, dd = int(ds[:4]), int(ds[4:6]), int(ds[6:8])
    if not (2015 <= y <= 2026): return None
    hh, mm, ss = 12, 0, 0
    t = str(h.get('Transaction_Time') or '')
    try:
        p = t.split(' ')[1].split(':'); hh, mm, ss = int(p[0]), int(p[1]), int(p[2])
        if t.endswith('م') and hh != 12: hh += 12
        if t.endswith('ص') and hh == 12: hh = 0
    except Exception: pass
    return f'{y:04d}-{m:02d}-{dd:02d} {hh:02d}:{mm:02d}:{ss:02d}'

# البنود اليتيمة: مجموعة حسب invoice_id القديم
orphan = {}
for r in db.execute("SELECT id, invoice_id, variant_id FROM invoice_items"):
    orphan.setdefault(r[1], []).append(r[0])

# احذف البنود اليتيمة لإعادة الربط من الصفر (أسهل)
db.execute("DELETE FROM invoice_items")
db.commit()

ins_inv = db.cursor(); ins_item = db.cursor()
prod_name = {r[0]: r[1] for r in db.execute("SELECT id, name FROM products")}
var_prod = {r[0]: r[1] for r in db.execute("SELECT id, product_id FROM product_variants")}
var_size = {r[0]: r[1] for r in db.execute("SELECT id, size FROM product_variants")}
avg_cost = {r[0]: r[1] for r in db.execute("SELECT variant_id, MAX(avg_cost) FROM stock_levels GROUP BY variant_id")}

n_inv = n_items = 0
db.execute('BEGIN')
for h in H:
    created = parse_date(h)
    if not created: continue
    det = details_by_header.get(h['Header_Id'], [])
    subtotal = sum((d.get('Price') or 0) * (d.get('Qty') or 0) for d in det)
    total = h.get('Net_Transaction_Value') or h.get('Transaction_Value') or subtotal
    disc = h.get('Discount_Value') or 0
    paid = h.get('Payed_Value') if h.get('Payed_Value') is not None else total
    num = int(h.get('Sales_No') or 0)
    cur = ins_inv.execute(
        "INSERT INTO invoices (invoice_number, created_at, pos_location_id, cashier_id, shift_id, subtotal, discount, total, payment_method, paid_amount, change_amount, status, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (f'OLD-{num}-{h["Header_Id"][:12]}', created, 1, 1, None, round(subtotal, 2), round(disc, 2),
         round(total, 2), 'cash', round(paid, 2), round(max(paid - total, 0), 2),
         'completed', 'فاتورة منقولة من النظام القديم'))
    iid = cur.lastrowid
    n_inv += 1
    for d in det:
        bc = (d.get('ItemBarCode') or '').strip()
        vid = var_by_barcode.get(bc) or suffix_index.get(str(int(d.get('Item_Package_Id') or 0)))
        if vid is None: continue
        pid = var_prod.get(vid)
        price, qty = d.get('Price') or 0, d.get('Qty') or 0
        netval, org = d.get('ItemNetVal') or 0, d.get('Org_Price') or 0
        if price > 100000 or qty > 1000:
            qty = qty if 0 < qty <= 1000 else 1
            price = org if 0 < org <= 100000 else (netval / qty if qty else netval)
        ins_item.execute(
            "INSERT INTO invoice_items (invoice_id, variant_id, product_name, size, color, quantity, unit_price, cost_price, discount, total, returned_qty) VALUES (?,?,?,?,?,?,?,?,?,?,0)",
            (iid, vid, prod_name.get(pid, ''), var_size.get(vid), None, qty, price,
             round(avg_cost.get(vid) or 0, 3), 0, round(price * qty, 2)))
        n_items += 1
db.commit()
print(f'فواتير: {n_inv} | بنود: {n_items}')
print('إجمالي:', round(db.execute("SELECT SUM(total) FROM invoices").fetchone()[0], 2))
db.close()
