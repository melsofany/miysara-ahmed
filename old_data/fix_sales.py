#!/usr/bin/env python3
"""تصحيح بنود المبيعات المستوردة: الأسعار/الكميات الفاسدة (ضجيج raw bytes)
تُصلح باستخدام ItemNetVal و Org_Price من المصدر."""
import json, sqlite3

H = json.load(open('old_data/table_Posted_Daily_Trans_Header.json'))
D = json.load(open('old_data/table_Posted_Daily_Trans_Details.json'))
db = sqlite3.connect('server/data/miysara.db')

# ربط فاتورة بـ Sales_No + بصمة
inv_no = {f"OLD-{int(h.get('Sales_No') or 0)}-{h['Header_Id'][:12]}": h for h in H}
inv_id = {r[0]: r[1] for r in db.execute("SELECT id, invoice_number FROM invoices WHERE invoice_number LIKE 'OLD-%'")}
det_by_header = {}
for d in D: det_by_header.setdefault(d['Header_Id'], []).append(d)

suffix_index = {r[1].split('~', 1)[1]: r[0] for r in db.execute("SELECT id, sku FROM product_variants WHERE sku LIKE '%~%'")}
var_by_barcode = {}
for r in db.execute("SELECT id, barcode FROM product_variants WHERE barcode IS NOT NULL AND barcode!=''"):
    var_by_barcode.setdefault(r[1], r[0])

fixed = 0
db.execute('BEGIN')
for num, hid_key in inv_no.items():
    iid = inv_id.get(num)
    if iid is None: continue
    hid = next((h['Header_Id'] for h in [inv_no[num]] if h), None)
    for d in det_by_header.get(hid, []):
        bc = (d.get('ItemBarCode') or '').strip()
        vid = var_by_barcode.get(bc) or suffix_index.get(str(int(d.get('Item_Package_Id') or 0)))
        if vid is None: continue
        price, qty = d.get('Price') or 0, d.get('Qty') or 0
        netval = d.get('ItemNetVal') or 0
        org = d.get('Org_Price') or 0
        # فساد: سعر أو كمية > 100000
        if price > 100000 or qty > 1000:
            new_qty = qty if 0 < qty <= 1000 else 1
            new_price = org if 0 < org <= 100000 else (netval / new_qty if new_qty else netval)
            db.execute("""UPDATE invoice_items SET quantity=?, unit_price=?, total=?
                WHERE invoice_id=? AND variant_id=? AND (unit_price>100000 OR quantity>1000)""",
                (new_qty, round(new_price, 2), round(new_price * new_qty, 2), iid, vid))
            fixed += db.total_changes and 1 or 0
db.commit()
print('بنود تم تصحيحها (تقريبي):', fixed)
print('بنود فاسدة متبقية:', db.execute("SELECT COUNT(*) FROM invoice_items WHERE unit_price>100000 OR quantity>1000").fetchone()[0])
print('إجمالي البنود:', round(db.execute("SELECT SUM(total) FROM invoice_items").fetchone()[0], 2))
print('إجمالي الفواتير:', round(db.execute("SELECT SUM(total) FROM invoices").fetchone()[0], 2))
db.close()
