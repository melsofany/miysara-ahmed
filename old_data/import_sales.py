#!/usr/bin/env python3
"""استيراد مبيعات النظام القديم (Posted_Daily_Trans) إلى قاعدة ميسرة."""
import json, sqlite3

DB = 'server/data/miysara.db'
H = json.load(open('old_data/table_Posted_Daily_Trans_Header.json'))
D = json.load(open('old_data/table_Posted_Daily_Trans_Details.json'))

db = sqlite3.connect(DB)
db.execute('PRAGMA foreign_keys = OFF')

var_by_sku = {r[1]: r[0] for r in db.execute("SELECT id, sku FROM product_variants")}
var_by_barcode = {}
for r in db.execute("SELECT id, barcode FROM product_variants WHERE barcode IS NOT NULL AND barcode!=''"):
    var_by_barcode.setdefault(r[1], r[0])
prod_name = {r[0]: r[1] for r in db.execute("SELECT id, name FROM products")}
var_prod = {r[0]: r[1] for r in db.execute("SELECT id, product_id FROM product_variants")}
var_size = {r[0]: r[1] for r in db.execute("SELECT id, size FROM product_variants")}
avg_cost = {r[0]: r[1] for r in db.execute(
    "SELECT variant_id, MAX(avg_cost) FROM stock_levels GROUP BY variant_id")}

suffix_index = {}
for sku, vid in var_by_sku.items():
    if '~' in sku:
        suffix_index[sku.split('~', 1)[1]] = vid

details_by_header = {}
for d in D:
    details_by_header.setdefault(d['Header_Id'], []).append(d)

def parse_date(h):
    ds = str(h.get('Transaction_Date') or '')
    if len(ds) != 8 or not ds.isdigit(): return None
    y, m, dd = int(ds[:4]), int(ds[4:6]), int(ds[6:8])
    if not (2015 <= y <= 2026 and 1 <= m <= 12 and 1 <= dd <= 31): return None
    hh, mm, ss = 12, 0, 0
    t = str(h.get('Transaction_Time') or '')
    try:
        parts = t.split(' ')[1].split(':')
        hh, mm, ss = int(parts[0]), int(parts[1]), int(parts[2])
        if t.endswith('م') and hh != 12: hh += 12
        if t.endswith('ص') and hh == 12: hh = 0
    except Exception: pass
    return f'{y:04d}-{m:02d}-{dd:02d} {hh:02d}:{mm:02d}:{ss:02d}'

ins_inv = db.cursor()
ins_item = db.cursor()
skipped_date = n_inv = n_items = n_unlinked = 0
db.execute('BEGIN')
for h in H:
    created = parse_date(h)
    if not created: skipped_date += 1; continue
    det = details_by_header.get(h['Header_Id'], [])
    subtotal = sum((d.get('Price') or 0) * (d.get('Qty') or 0) for d in det)
    total = h.get('Net_Transaction_Value') or h.get('Transaction_Value') or subtotal
    disc = h.get('Discount_Value') or 0
    paid = h.get('Payed_Value') if h.get('Payed_Value') is not None else total
    num = int(h.get('Sales_No') or 0)
    # Sales_No يتكرر بين الأيام — نستخدم Header_Id كاملاً لضمان التفرد
    cur = ins_inv.execute(
        "INSERT INTO invoices (invoice_number, created_at, pos_location_id, cashier_id, shift_id, subtotal, discount, total, payment_method, paid_amount, change_amount, status, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (f'OLD-{num}-{h["Header_Id"][:12]}', created, 1, 1, None, round(subtotal, 2), round(disc, 2),
         round(total, 2), 'cash', round(paid, 2), round(max(paid - total, 0), 2),
         'completed', 'فاتورة منقولة من النظام القديم'))
    iid = cur.lastrowid
    n_inv += 1
    for d in det:
        vid = None
        bc = (d.get('ItemBarCode') or '').strip()
        if bc and bc in var_by_barcode: vid = var_by_barcode[bc]
        if vid is None:
            vid = suffix_index.get(str(int(d.get('Item_Package_Id') or 0)))
        if vid is None: n_unlinked += 1; continue
        pid = var_prod.get(vid)
        qty = d.get('Qty') or 0
        price = d.get('Price') or 0
        cost = avg_cost.get(vid) or 0
        ins_item.execute(
            "INSERT INTO invoice_items (invoice_id, variant_id, product_name, size, color, quantity, unit_price, cost_price, discount, total, returned_qty) VALUES (?,?,?,?,?,?,?,?,?,?,0)",
            (iid, vid, prod_name.get(pid, ''), var_size.get(vid), None, qty, price,
             round(cost, 3), 0, round(price * qty, 2)))
        n_items += 1
db.commit()
print(f'فواتير مستوردة: {n_inv} | بنود: {n_items} | بنود بلا صنف: {n_unlinked} | تخطّي تاريخ: {skipped_date}')
print('إجمالي المبيعات:', round(db.execute("SELECT COALESCE(SUM(total),0) FROM invoices").fetchone()[0], 2))
db.close()
