import { useEffect, useState } from 'react';
import api, { errMsg, fmt } from '../api.js';
import { useAuth } from '../App.jsx';
import { PageTitle, Modal, Field, ErrorBox, SuccessBox, Table, Badge } from '../components/UI.jsx';
import Receipt from '../components/Receipt.jsx';

const STATUS_AR = { completed: ['مكتملة', 'green'], edited: ['معدّلة', 'amber'], cancelled: ['ملغاة', 'red'], returned: ['مرتجعة كليًا', 'violet'], partially_returned: ['مرتجعة جزئيًا', 'blue'] };
const PAY_AR = { cash: 'نقدي', card: 'بطاقة', bank_transfer: 'تحويل بنكي', wallet: 'محفظة' };

export default function Invoices() {
  const { has, user } = useAuth();
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ number: '', from: '', to: '', pos_location_id: '', barcode: '', product: '', status: '' });
  const [posList, setPosList] = useState([]);
  const [detail, setDetail] = useState(null);
  const [editItems, setEditItems] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [retItems, setRetItems] = useState(null);
  const [retReason, setRetReason] = useState('');

  const load = () => {
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    api.get('/invoices', { params }).then(r => setRows(r.data));
  };
  useEffect(() => { load(); }, [filters]);
  useEffect(() => { api.get('/pos-locations').then(r => setPosList(r.data)); }, []);

  const openDetail = async (id) => {
    const { data } = await api.get(`/invoices/${id}`);
    setDetail(data); setError('');
  };

  const print = async (id) => {
    const { data } = await api.get(`/invoices/${id}/print`);
    setReceipt(data);
    setTimeout(() => window.print(), 300);
  };

  const startEdit = () => {
    setEditForm({ discount: detail.discount, payment_method: detail.payment_method, paid_amount: detail.paid_amount, notes: detail.notes || '' });
    setEditItems(detail.items.map(i => ({ ...i })));
    setReason('');
  };

  const saveEdit = async () => {
    if (!reason.trim()) return setError('سبب التعديل مطلوب');
    setBusy(true); setError('');
    try {
      await api.put(`/invoices/${detail.id}`, {
        ...editForm,
        reason,
        items: editItems.map(i => ({ variant_id: i.variant_id, quantity: Number(i.quantity), discount: Number(i.discount), returned_qty: i.returned_qty })),
      });
      setSuccess('تم تعديل الفاتورة'); setEditItems(null); setDetail(null); load();
    } catch (e) { setError(errMsg(e)); }
    setBusy(false);
  };

  const cancelInvoice = async () => {
    const r = prompt('سبب إلغاء الفاتورة (إلزامي):');
    if (!r?.trim()) return;
    try { await api.post(`/invoices/${detail.id}/cancel`, { reason: r }); setSuccess('تم إلغاء الفاتورة'); setDetail(null); load(); }
    catch (e) { setError(errMsg(e)); }
  };

  const startReturn = () => {
    setRetItems(detail.items.filter(i => i.quantity - i.returned_qty > 0).map(i => ({ ...i, ret_qty: 0 })));
    setRetReason('');
  };

  const saveReturn = async () => {
    const items = retItems.filter(i => Number(i.ret_qty) > 0).map(i => ({ invoice_item_id: i.id, quantity: Number(i.ret_qty) }));
    if (!items.length) return setError('حدد كميات المرتجع');
    if (!retReason.trim()) return setError('سبب المرتجع مطلوب');
    setBusy(true); setError('');
    try {
      const { data } = await api.post('/returns', { invoice_id: detail.id, reason: retReason, items, refund_method: detail.payment_method });
      setSuccess(`تم المرتجع ${data.returnNumber} — استرداد ${fmt(data.totalRefund)}`);
      setRetItems(null); setDetail(null); load();
    } catch (e) { setError(errMsg(e)); }
    setBusy(false);
  };

  return (
    <div>
      <PageTitle title="الفواتير" subtitle="بحث وعرض وتعديل وإلغاء وطباعة الفواتير" />
      <SuccessBox msg={success} /><ErrorBox error={!detail && !editItems && !retItems ? error : ''} />

      <div className="card p-4 mb-4 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2">
        <input className="input" placeholder="رقم الفاتورة" value={filters.number} onChange={e => setFilters({ ...filters, number: e.target.value })} />
        <input type="date" className="input" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} />
        <input type="date" className="input" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} />
        <select className="input" value={filters.pos_location_id} onChange={e => setFilters({ ...filters, pos_location_id: e.target.value })}>
          <option value="">كل النقاط</option>{posList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input className="input" dir="ltr" placeholder="باركود منتج" value={filters.barcode} onChange={e => setFilters({ ...filters, barcode: e.target.value })} />
        <input className="input" placeholder="اسم منتج" value={filters.product} onChange={e => setFilters({ ...filters, product: e.target.value })} />
        <select className="input" value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}>
          <option value="">كل الحالات</option>
          {Object.entries(STATUS_AR).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>

      <Table head={['رقم الفاتورة', 'التاريخ', 'نقطة البيع', 'الكاشير', 'الإجمالي', 'الدفع', 'الحالة', '']}>
        {rows.map(i => (
          <tr key={i.id} className="cursor-pointer hover:bg-brand-50/50" onClick={() => openDetail(i.id)}>
            <td className="td font-bold text-brand-700">{i.invoice_number}</td>
            <td className="td text-slate-500">{i.created_at}</td>
            <td className="td">{i.pos_name}</td>
            <td className="td">{i.cashier_name}</td>
            <td className="td font-extrabold">{fmt(i.total)}</td>
            <td className="td">{PAY_AR[i.payment_method]}</td>
            <td className="td"><Badge color={STATUS_AR[i.status]?.[1]}>{STATUS_AR[i.status]?.[0]}</Badge></td>
            <td className="td" onClick={e => e.stopPropagation()}>
              {has('invoices.print') && <button className="btn-ghost !px-2 !py-1" title="طباعة" onClick={() => print(i.id)}>🖨</button>}
            </td>
          </tr>
        ))}
      </Table>

      {/* تفاصيل الفاتورة */}
      <Modal open={!!detail && !editItems && !retItems} onClose={() => setDetail(null)} title={`🧾 فاتورة ${detail?.invoice_number}`} wide>
        {detail && (
          <div>
            <ErrorBox error={error} />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4">
              <div className="rounded-xl bg-slate-50 p-3"><div className="text-slate-400 text-xs">التاريخ</div><b>{detail.created_at}</b></div>
              <div className="rounded-xl bg-slate-50 p-3"><div className="text-slate-400 text-xs">نقطة البيع</div><b>{detail.pos_name}</b></div>
              <div className="rounded-xl bg-slate-50 p-3"><div className="text-slate-400 text-xs">الكاشير</div><b>{detail.cashier_name}</b></div>
              <div className="rounded-xl bg-slate-50 p-3"><div className="text-slate-400 text-xs">الحالة</div><Badge color={STATUS_AR[detail.status]?.[1]}>{STATUS_AR[detail.status]?.[0]}</Badge></div>
            </div>
            <Table head={['المنتج', 'الكمية', 'السعر', 'الخصم', 'الإجمالي', 'مرتجع']}>
              {detail.items.map(it => (
                <tr key={it.id}>
                  <td className="td font-semibold">{it.product_name} <span className="text-xs text-slate-400">{it.size} / {it.color}</span></td>
                  <td className="td">{fmt(it.quantity)}</td>
                  <td className="td">{fmt(it.unit_price)}</td>
                  <td className="td">{fmt(it.discount)}</td>
                  <td className="td font-bold">{fmt(it.total)}</td>
                  <td className="td">{it.returned_qty > 0 ? <Badge color="violet">{fmt(it.returned_qty)}</Badge> : '—'}</td>
                </tr>
              ))}
            </Table>
            <div className="mt-3 flex flex-wrap justify-between gap-2 text-sm">
              <div>الإجمالي الفرعي: <b>{fmt(detail.subtotal)}</b> — الخصم: <b>{fmt(detail.discount)}</b></div>
              <div className="text-lg">الإجمالي: <b className="text-brand-700">{fmt(detail.total)}</b> — المدفوع: <b>{fmt(detail.paid_amount)}</b> — الباقي: <b>{fmt(detail.change_amount)}</b></div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {has('invoices.print') && <button className="btn-secondary" onClick={() => print(detail.id)}>🖨 طباعة</button>}
              {has('invoices.edit') && !['cancelled', 'returned'].includes(detail.status) && <button className="btn-primary" onClick={startEdit}>✏️ تعديل</button>}
              {has('returns.execute') && !['cancelled', 'returned'].includes(detail.status) && <button className="btn-secondary" onClick={startReturn}>↩️ مرتجع</button>}
              {has('invoices.cancel') && detail.status !== 'cancelled' && <button className="btn-danger" onClick={cancelInvoice}>⛔ إلغاء</button>}
            </div>
          </div>
        )}
      </Modal>

      {/* تعديل الفاتورة */}
      <Modal open={!!editItems} onClose={() => setEditItems(null)} title={`✏️ تعديل فاتورة ${detail?.invoice_number}`} wide>
        <ErrorBox error={error} />
        {editItems && (
          <div>
            <div className="space-y-2">
              {editItems.map((it, i) => (
                <div key={it.id} className="grid grid-cols-[1fr_90px_100px_auto] gap-2 items-center rounded-xl bg-slate-50 p-2 text-sm">
                  <span className="font-semibold">{it.product_name} <span className="text-xs text-slate-400">{it.size}/{it.color} — مرتجع سابق: {fmt(it.returned_qty)}</span></span>
                  <input type="number" min={it.returned_qty || 1} className="input !py-1.5 text-center" value={it.quantity}
                    onChange={e => setEditItems(editItems.map((x, j) => j === i ? { ...x, quantity: Math.max(Number(x.returned_qty) || 1, Number(e.target.value) || 0) } : x))} />
                  <input type="number" min="0" className="input !py-1.5 text-center" placeholder="خصم" value={it.discount}
                    onChange={e => setEditItems(editItems.map((x, j) => j === i ? { ...x, discount: Number(e.target.value) || 0 } : x))} />
                  <button className="text-rose-500" onClick={() => setEditItems(editItems.filter((_, j) => j !== i))}>🗑</button>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <Field label="خصم الفاتورة"><input type="number" min="0" className="input" value={editForm.discount} onChange={e => setEditForm({ ...editForm, discount: Number(e.target.value) || 0 })} /></Field>
              <Field label="المدفوع"><input type="number" min="0" className="input" value={editForm.paid_amount} onChange={e => setEditForm({ ...editForm, paid_amount: Number(e.target.value) || 0 })} /></Field>
              <Field label="طريقة الدفع"><select className="input" value={editForm.payment_method} onChange={e => setEditForm({ ...editForm, payment_method: e.target.value })}>{Object.entries(PAY_AR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
              <Field label="سبب التعديل *"><input className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="إلزامي — يُسجل في سجل العمليات" /></Field>
            </div>
            <button disabled={busy} onClick={saveEdit} className="btn-primary w-full mt-4 !py-3">{busy ? 'جارٍ الحفظ…' : '💾 حفظ التعديل'}</button>
          </div>
        )}
      </Modal>

      {/* مرتجع */}
      <Modal open={!!retItems} onClose={() => setRetItems(null)} title={`↩️ مرتجع من فاتورة ${detail?.invoice_number}`} wide>
        <ErrorBox error={error} />
        {retItems && (
          <div>
            <div className="space-y-2">
              {retItems.map((it, i) => (
                <div key={it.id} className="grid grid-cols-[1fr_110px] gap-2 items-center rounded-xl bg-slate-50 p-2 text-sm">
                  <span className="font-semibold">{it.product_name} <span className="text-xs text-slate-400">{it.size}/{it.color} — متاح للإرجاع: {fmt(it.quantity - it.returned_qty)}</span></span>
                  <input type="number" min="0" max={it.quantity - it.returned_qty} className="input !py-1.5 text-center" value={it.ret_qty}
                    onChange={e => setRetItems(retItems.map((x, j) => j === i ? { ...x, ret_qty: Math.min(it.quantity - it.returned_qty, Math.max(0, Number(e.target.value) || 0)) } : x))} />
                </div>
              ))}
            </div>
            <Field label="سبب المرتجع *"><input className="input mt-2" value={retReason} onChange={e => setRetReason(e.target.value)} /></Field>
            <button disabled={busy} onClick={saveReturn} className="btn-primary w-full mt-4 !py-3">{busy ? 'جارٍ التنفيذ…' : '↩️ تنفيذ المرتجع'}</button>
          </div>
        )}
      </Modal>

      {/* إيصال */}
      <Modal open={!!receipt} onClose={() => setReceipt(null)} title="🖨 معاينة الإيصال">
        {receipt && <Receipt data={receipt} />}
        <button className="btn-primary w-full mt-4" onClick={() => window.print()}>🖨 طباعة</button>
      </Modal>
    </div>
  );
}
