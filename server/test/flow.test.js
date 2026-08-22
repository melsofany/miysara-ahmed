/**
 * اختبار السيناريوهات الكاملة على API حقيقي (متكامل مع تدفق النظام).
 * node test/flow.test.js
 */
const BASE = process.env.BASE || 'http://localhost:12001/api';
let token = '';
let passed = 0, failed = 0;
const ok = (cond, name) => { cond ? passed++ : failed++; console.log((cond ? '  ✓ ' : '  ✗ ') + name); };
const get = (p) => req(p);
const post = (p, b) => req(p, 'POST', b);
const put = (p, b) => req(p, 'PUT', b);
async function req(p, m = 'GET', b) {
  const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: b ? JSON.stringify(b) : undefined });
  let d = null;
  try { d = await r.json(); } catch {}
  return { status: r.status, data: d };
}

console.log('===== 1) تسجيل الدخول =====');
const login = await post('/auth/login', { username: 'admin', password: 'admin123' });
ok(login.data?.token, 'login');
token = login.data.token;

console.log('===== 2) إنشاء منتج + Variants =====');
const cat = await post('/categories', { name: 'أطفال ' + Date.now() });
const supplier = await post('/suppliers', { name: 'مورد اختبار', phone: '0100' });
const season = (await get('/seasons')).data[0];
const uniq = 'T' + Date.now().toString(36);
const prod = await post('/products', {
  sku: 'TST-' + uniq, name: 'تيشيرت أطفال T100', category_id: cat.data.id, supplier_id: supplier.data.id,
  season_id: season?.id, cost_price: 50, selling_price: 120, min_stock: 3,
  variants: [
    { sku: 'V' + uniq + 'R', barcode: 'BC' + uniq + 'R', size: '4 سنوات', color: 'أحمر', cost_price: 50, selling_price: 120 },
    { sku: 'V' + uniq + 'B', barcode: 'BC' + uniq + 'B', size: '6 سنوات', color: 'أزرق', cost_price: 50, selling_price: 120 },
  ],
});
if (!(prod.status === 201 && prod.data.variants?.length === 2)) console.log('   DEBUG:', JSON.stringify(prod).slice(0, 500));
ok(prod.status === 201 && prod.data.variants?.length === 2, 'منتج بمتغيرين');
const vId = prod.data?.variants?.[0]?.id;
const vId2 = prod.data?.variants?.[1]?.id;

console.log('===== 3) منع تكرار SKU =====');
const dup = await post('/products', { sku: 'TST-' + Date.now(), name: 'x', variants: [{ sku: 'TST-R4' }] });
ok([400, 409].includes(dup.status), 'رفع التكرار');

console.log('===== 4) المخزن واستلام =====');
const wh = (await get('/inventory/warehouses')).data[0];
const rcv = await post('/inventory/receive', { warehouse_id: wh.id, supplier_id: supplier.data.id, items: [{ variant_id: vId, quantity: 10, cost_price: 50 }] });
ok(rcv.status === 201, 'استلام 10 — ' + (rcv.data?.document_number || rcv.data?.error));

console.log('===== 5) منع البيع بدون رصيد =====');
let posId = (await get('/pos-locations')).data[0]?.id;
if (!posId) posId = (await post('/pos-locations', { name: 'نقطة اختبار', code: 'PT' + Date.now() })).data.id;
const neg = await post('/invoices', { pos_location_id: posId, paid_amount: 999, payment_method: 'cash', items: [{ variant_id: vId2, quantity: 1 }] });
ok(neg.status === 400, 'رفوض المخزون السالب: ' + JSON.stringify(neg.data));

console.log('===== 6) تحويل إلى POS =====');
const trf = await post('/inventory/transfer', { from_type: 'warehouse', from_id: wh.id, to_type: 'pos', to_id: posId, items: [{ variant_id: vId, quantity: 6 }] });
ok(trf.status === 201, 'تحويل 6');
const stockRow = (await get(`/inventory/stock?location_type=pos&location_id=${posId}`)).data.find(s => s.variant_id === vId);
ok(stockRow?.quantity === 6, 'رصيد POS = 6');

console.log('===== 7) فتح شفت =====');
const shift = await post('/shifts/open', { pos_location_id: posId, opening_cash: 500 });
const shiftId = shift.data?.id || (await get('/shifts?status=open&pos_location_id=' + posId)).data[0]?.id;
ok((shift.status === 201 || shiftId), 'شفت مفتوح #' + (shiftId || JSON.stringify(shift.data)));
const dupShift = await post('/shifts/open', { pos_location_id: posId, opening_cash: 100 });
ok(dupShift.status === 400, 'منع شفت مزدوج');

console.log('===== 8) البحث بالباركود =====');
const scan = await get(`/pos/${posId}/scan/${'BC' + uniq + 'R'}`);
ok(scan.status === 200, 'باركود → نتيجة: ' + JSON.stringify(scan.data).slice(0, 120));

console.log('===== 9) البحث المتقدم =====');
const adv = await get(`/pos/${posId}/search?sku=${encodeURIComponent(uniq)}&size=${encodeURIComponent('4 سنوات')}`);
ok(adv.status === 200 && adv.data.length === 1, 'SKU + مقاس → نتائج: ' + adv.data.length);

console.log('===== 10) بيع =====');
const sale = await post('/invoices', { pos_location_id: posId, discount: 0, paid_amount: 240, payment_method: 'cash', items: [{ variant_id: vId, quantity: 2, discount: 0 }] });
ok(sale.status === 201, 'فاتورة — ' + (sale.data?.invoice_number || JSON.stringify(sale.data)));
const invId = sale.data?.invoiceId;

console.log('===== 11) دور + كاشير محدود الصلاحيات =====');
const role = await post('/roles', { name: 't_c_' + Date.now(), name_ar: 'كاشير اختبار', permissions: ['pos.sell', 'invoices.view', 'invoices.print', 'shifts.open', 'shifts.view', 'shifts.close'] });
const usr = await post('/users', { username: 'cash_' + uniq, password: '123456', full_name: 'كاشير', role_id: role.data.id, pos_ids: [posId] });
ok(usr.status === 201, 'إنشاء كاشير ' + JSON.stringify(usr.data).slice(0, 80));
const cT = (await post('/auth/login', { username: 'cash_' + uniq, password: '123456' })).data.token;
const deniedProd = await fetch(BASE + '/products/1', { headers: { Authorization: 'Bearer ' + cT } });
ok(deniedProd.status === 403, 'المنع بدون products.view');
const meData = (await (await fetch(BASE + '/auth/me', { headers: { Authorization: 'Bearer ' + cT } })).json());
ok(!meData.user?.permissions?.includes('cost.view'), 'بدون cost.view');

console.log('===== 12) طباعة =====');
const prn = await get(`/invoices/${invId}/print`);
ok(prn.status === 200 && prn.data?.invoice?.items?.length === 1, 'إيصال');

console.log('===== 13) تعديل الفاتورة =====');
const ed = await put(`/invoices/${invId}`, { discount: 10, reason: 'خصم', items: [{ variant_id: vId, quantity: 2 }] });
ok(ed.status === 200, 'تعديل بصلاحية');
const edDeny = await fetch(BASE + `/invoices/${invId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cT }, body: JSON.stringify({ discount: 1, reason: 'x', items: [] }) });
ok(edDeny.status === 403, 'منع بدون invoices.edit');

console.log('===== 14) مرتجع جزئي =====');
const invDetail = (await get(`/invoices/${invId}`)).data;
const invItemId = invDetail?.items?.[0]?.id;
const ret = await post('/returns', { invoice_id: invId, reason: 'عيب', items: [{ invoice_item_id: invItemId, quantity: 1 }] });
ok(ret.status === 201, 'مرتجع — ' + (ret.data?.returnNumber || ret.data?.error));
const stockA = (await get(`/inventory/stock?location_type=pos&location_id=${posId}`)).data.find(s => s.variant_id === vId);
ok(stockA?.quantity === 5, 'المخزون يعود 5, الفعلي: ' + stockA?.quantity);

console.log('===== 15) إغلاق الشفت =====');
const openShift = (await get('/shifts?status=open&pos_location_id=' + posId)).data[0];
const close = await post(`/shifts/${openShift.id}/close`, { actual_cash: 1030 });
ok(close.status === 200, 'إغلاق');
ok(typeof close.data.expected_cash === 'number', `متوقع ${close.data.expected_cash}`);
ok(typeof close.data.difference === 'number', `فرق ${close.data.difference}`);

console.log('===== 16) التقارير والـ Audit =====');
for (const p of ['/reports/sales?group_by=pos', '/reports/inventory?type=best', '/dashboard']) {
  ok((await get(p)).status === 200, p);
}
const logs = await get('/system/audit-logs?entity=returns');
ok(logs.status === 200 && logs.data.length > 0, 'Audit Log');

console.log(`\n===== ${passed} ناجح / ${failed} فاشل =====`);
process.exit(failed ? 1 : 0);
