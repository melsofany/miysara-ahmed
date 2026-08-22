import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import api, { errMsg, fmt } from '../api.js';
import { useAuth } from '../App.jsx';
import { Modal, ErrorBox, Field } from '../components/UI.jsx';
import Receipt from '../components/Receipt.jsx';

const PAYMENTS = [['cash', 'نقدي'], ['card', 'بطاقة'], ['bank_transfer', 'تحويل بنكي'], ['wallet', 'محفظة إلكترونية']];

export default function PosScreen() {
  const { user, has } = useAuth();
  const [posList, setPosList] = useState([]);
  const [posId, setPosId] = useState(null);
  const [shift, setShift] = useState(null);
  const [filters, setFilters] = useState({ q: '', category_id: '', season_id: '', supplier_id: '', manufacturer_id: '', size: '', color: '', in_stock: '' });
  const [meta, setMeta] = useState({ categories: [], seasons: [], suppliers: [], manufacturers: [] });
  const [results, setResults] = useState([]);
  const [cart, setCart] = useState([]);
  const [selected, setSelected] = useState({});
  const [payment, setPayment] = useState('cash');
  const [paid, setPaid] = useState('');
  const [discount, setDiscount] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [openShiftModal, setOpenShiftModal] = useState(false);
  const [openingCash, setOpeningCash] = useState('');
  const scanRef = useRef(null);
  const debRef = useRef(null);

  useEffect(() => {
    api.get('/pos-locations').then(r => {
      setPosList(r.data.filter(p => p.is_active));
      const def = r.data.find(p => p.is_active && (!user.posIds?.length || user.posIds.includes(p.id)));
      if (def) setPosId(def.id);
    });
    Promise.all(['/categories', '/seasons', '/suppliers', '/manufacturers'].map(u => api.get(u).then(r => r.data).catch(() => [])))
      .then(([categories, seasons, suppliers, manufacturers]) => setMeta({ categories, seasons, suppliers, manufacturers }));
  }, []);

  useEffect(() => {
    if (!posId) return;
    api.get('/shifts/current', { params: { pos_location_id: posId } }).then(r => setShift(r.data));
  }, [posId]);

  const search = (f = filters) => {
    if (!posId) return;
    const params = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '' && v != null));
    api.get(`/pos/${posId}/search`, { params }).then(r => setResults(r.data)).catch(() => {});
  };
  useEffect(() => { search(); }, [posId]);
  useEffect(() => {
    clearTimeout(debRef.current);
    debRef.current = setTimeout(() => search(), 300);
  }, [filters]);

  // ماسح الباركود: Enter يضيف مباشرة
  const onScan = async (e) => {
    if (e.key !== 'Enter') return;
    const code = filters.q.trim();
    if (!code) return;
    try {
      const { data } = await api.get(`/pos/${posId}/scan/${encodeURIComponent(code)}`);
      addToCart(data, 1);
      setFilters({ ...filters, q: '' });
      setError('');
    } catch { setError('لم يتم العثور على منتج بهذا الباركود'); }
  };

  const addToCart = (item, qty) => {
    setCart(c => {
      const ex = c.find(x => x.variant_id === item.variant_id);
      if (ex) return c.map(x => x.variant_id === item.variant_id ? { ...x, quantity: x.quantity + qty } : x);
      return [...c, { ...item, quantity: qty, discount: 0 }];
    });
  };

  const addSelected = () => {
    const ids = Object.keys(selected).filter(k => selected[k].on);
    for (const id of ids) {
      const item = results.find(r => r.variant_id === Number(id));
      if (item) addToCart(item, Number(selected[id].qty) || 1);
    }
    setSelected({});
  };

  const subtotal = useMemo(() => cart.reduce((s, x) => s + x.quantity * x.selling_price - (x.discount || 0), 0), [cart]);
  const total = Math.max(0, subtotal - (Number(discount) || 0));
  const change = (Number(paid) || 0) - total;

  const checkout = async () => {
    if (!shift) { setError('يجب فتح شفت أولًا'); setOpenShiftModal(true); return; }
    if (!cart.length) return setError('الفاتورة فارغة');
    setBusy(true); setError('');
    try {
      const { data } = await api.post('/invoices', {
        pos_location_id: posId, payment_method: payment,
        paid_amount: Number(paid) || total, discount: Number(discount) || 0,
        items: cart.map(x => ({ variant_id: x.variant_id, quantity: x.quantity, discount: x.discount || 0 })),
      });
      const pr = await api.get(`/invoices/${data.invoiceId}/print`);
      setReceipt(pr.data);
      setCart([]); setPaid(''); setDiscount(0);
      search();
      api.get('/shifts/current', { params: { pos_location_id: posId } }).then(r => setShift(r.data));
    } catch (e) { setError(errMsg(e)); }
    setBusy(false);
  };

  const openShift = async () => {
    setBusy(true); setError('');
    try {
      await api.post('/shifts/open', { pos_location_id: posId, opening_cash: Number(openingCash) || 0 });
      const { data } = await api.get('/shifts/current', { params: { pos_location_id: posId } });
      setShift(data); setOpenShiftModal(false);
    } catch (e) { setError(errMsg(e)); }
    setBusy(false);
  };

  if (!posList.length) return <div className="card p-8 text-center text-slate-500">لا توجد نقاط بيع متاحة لك — تواصل مع الإدارة</div>;

  return (
    <div className="grid lg:grid-cols-[1fr_420px] gap-4 items-start">
      {/* عمود البحث */}
      <div>
        <div className="card p-4 mb-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[220px]">
              <label className="label"><Icon name="search" size={15} className="inline-block align-[-2px]" /> بحث / باركود (Enter للإضافة الفورية)</label>
              <input ref={scanRef} autoFocus className="input !text-lg !py-3" placeholder="امسح الباركود أو اكتب اسم / SKU / موديل…"
                value={filters.q} onChange={e => setFilters({ ...filters, q: e.target.value })} onKeyDown={onScan} />
            </div>
            <div className="min-w-[180px]">
              <label className="label">نقطة البيع</label>
              <select className="input" value={posId || ''} onChange={e => setPosId(Number(e.target.value))}>
                {posList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2">
            <select className="input" value={filters.category_id} onChange={e => setFilters({ ...filters, category_id: e.target.value })}>
              <option value="">كل التصنيفات</option>
              {meta.categories.map(c => <option key={c.id} value={c.id}>{c.parent_id ? '— ' : ''}{c.name}</option>)}
            </select>
            <select className="input" value={filters.season_id} onChange={e => setFilters({ ...filters, season_id: e.target.value })}>
              <option value="">كل المواسم</option>
              {meta.seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select className="input" value={filters.supplier_id} onChange={e => setFilters({ ...filters, supplier_id: e.target.value })}>
              <option value="">كل الموردين</option>
              {meta.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select className="input" value={filters.manufacturer_id} onChange={e => setFilters({ ...filters, manufacturer_id: e.target.value })}>
              <option value="">كل الماركات</option>
              {meta.manufacturers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <input className="input" placeholder="المقاس" value={filters.size} onChange={e => setFilters({ ...filters, size: e.target.value })} />
            <input className="input" placeholder="اللون" value={filters.color} onChange={e => setFilters({ ...filters, color: e.target.value })} />
            <label className="input flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={filters.in_stock === '1'} onChange={e => setFilters({ ...filters, in_stock: e.target.checked ? '1' : '' })} />
              <span className="text-sm font-semibold">المتوفر فقط</span>
            </label>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <div className={`text-sm font-bold ${shift ? 'text-emerald-600' : 'text-rose-600'}`}>
              {shift ? ` شفت مفتوح #${shift.id} — فكة: ${fmt(shift.opening_cash)} — مبيعات نقدية: ${fmt(shift.cash_sales)}` : ' لا يوجد شفت مفتوح'}
            </div>
            {!shift && <button className="btn-success !py-1.5" onClick={() => setOpenShiftModal(true)}>فتح شفت</button>}
            {Object.values(selected).some(s => s.on) && (
              <button className="btn-primary !py-1.5" onClick={addSelected}><Icon name="plus" size={15} className="inline-block align-[-2px]" /> إضافة المحدد ({Object.values(selected).filter(s => s.on).length})</button>
            )}
          </div>
        </div>

        {/* نتائج البحث */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-[62vh] overflow-y-auto pe-1">
          {results.map(r => {
            const sel = selected[r.variant_id] || {};
            const out = r.pos_stock <= 0;
            return (
              <div key={r.variant_id} className={`card p-3 flex items-center gap-3 transition ${sel.on ? 'ring-2 ring-brand-500' : ''} ${out ? 'opacity-60' : ''}`}>
                <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={!!sel.on}
                  onChange={e => setSelected({ ...selected, [r.variant_id]: { ...sel, on: e.target.checked, qty: sel.qty || 1 } })} />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm truncate">{r.product_name}</div>
                  <div className="text-xs text-slate-500">{r.size} • {r.color} • {r.sku}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="font-extrabold text-brand-700">{fmt(r.selling_price)}</span>
                    <span className={`badge ${out ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>{out ? 'غير متوفر' : `متوفر ${fmt(r.pos_stock)}`}</span>
                  </div>
                </div>
                {sel.on && (
                  <input type="number" min="1" className="input !w-16 !px-2 text-center" value={sel.qty || 1}
                    onChange={e => setSelected({ ...selected, [r.variant_id]: { ...sel, qty: e.target.value } })} />
                )}
                <button disabled={out} className="btn-primary !px-3 !py-2 text-lg" onClick={() => addToCart(r, 1)}><Icon name="plus" size={20} /></button>
              </div>
            );
          })}
          {!results.length && <div className="col-span-full py-14 text-center text-slate-400">لا نتائج — جرّب فلاتر أخرى</div>}
        </div>
      </div>

      {/* الفاتورة */}
      <div className="card p-4 lg:sticky lg:top-4">
        <h3 className="font-extrabold text-lg mb-3"><Icon name="receipt" size={15} className="inline-block align-[-2px]" /> الفاتورة الحالية</h3>
        <ErrorBox error={error} />
        <div className="space-y-2 max-h-[38vh] overflow-y-auto">
          {cart.map((x, i) => (
            <div key={x.variant_id} className="rounded-xl bg-slate-50 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-sm truncate">{x.product_name}</div>
                  <div className="text-xs text-slate-500">{x.size} • {x.color}</div>
                </div>
                <button className="text-rose-500 font-bold px-2" onClick={() => setCart(cart.filter((_, j) => j !== i))}><Icon name="trash" size={15} className="inline-block align-[-2px]" /></button>
              </div>
              <div className="mt-2 flex items-center gap-2 text-sm">
                <button className="btn-secondary !px-2.5 !py-1" onClick={() => setCart(cart.map((c, j) => j === i ? { ...c, quantity: Math.max(1, c.quantity - 1) } : c))}>−</button>
                <input type="number" min="1" className="input !w-16 !py-1 text-center" value={x.quantity}
                  onChange={e => setCart(cart.map((c, j) => j === i ? { ...c, quantity: Math.max(1, Number(e.target.value) || 1) } : c))} />
                <button className="btn-secondary !px-2.5 !py-1" onClick={() => setCart(cart.map((c, j) => j === i ? { ...c, quantity: c.quantity + 1 } : c))}><Icon name="plus" size={20} /></button>
                <span className="text-slate-400">×</span>
                <span className="font-bold">{fmt(x.selling_price)}</span>
                <input type="number" min="0" placeholder="خصم" title="خصم البند" className="input !w-20 !py-1 text-center"
                  value={x.discount || ''} onChange={e => setCart(cart.map((c, j) => j === i ? { ...c, discount: Number(e.target.value) || 0 } : c))} />
                <span className="me-auto font-extrabold text-brand-700">{fmt(x.quantity * x.selling_price - (x.discount || 0))}</span>
              </div>
            </div>
          ))}
          {!cart.length && <div className="py-10 text-center text-slate-400 text-sm">امسح باركود أو اختر منتجات لإضافتها</div>}
        </div>

        <div className="mt-3 border-t border-dashed pt-3 space-y-2 text-sm">
          <div className="flex justify-between"><span>الإجمالي الفرعي</span><b>{fmt(subtotal)}</b></div>
          <div className="flex justify-between items-center"><span>خصم الفاتورة</span>
            <input type="number" min="0" className="input !w-24 !py-1 text-center" value={discount || ''} onChange={e => setDiscount(e.target.value)} /></div>
          <div className="flex justify-between text-lg"><span className="font-bold">الإجمالي</span><b className="text-brand-700 text-2xl">{fmt(total)}</b></div>
          <div className="grid grid-cols-4 gap-1.5 pt-1">
            {PAYMENTS.map(([k, l]) => (
              <button key={k} onClick={() => setPayment(k)}
                className={`rounded-xl py-2 text-xs font-bold border transition ${payment === k ? 'bg-brand-600 text-white border-brand-600' : 'bg-white border-slate-300'}`}>{l}</button>
            ))}
          </div>
          <div className="flex justify-between items-center"><span>المدفوع</span>
            <input type="number" min="0" className="input !w-28 !py-1.5 text-center font-bold" value={paid} onChange={e => setPaid(e.target.value)} placeholder={fmt(total)} /></div>
          <div className={`flex justify-between font-bold ${change < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
            <span>الباقي للعميل</span><span>{fmt(Math.max(0, paid === '' ? 0 : change))}</span>
          </div>
          <button disabled={busy || !cart.length} onClick={checkout} className="btn-success w-full !py-3.5 !text-lg mt-1">
            {busy ? 'جارٍ الحفظ…' : ` إتمام البيع — ${fmt(total)}`}
          </button>
        </div>
      </div>

      {/* فتح شفت */}
      <Modal open={openShiftModal} onClose={() => setOpenShiftModal(false)} title=" فتح شفت جديد">
        <ErrorBox error={error} />
        <Field label="الفكة الافتتاحية (Opening Cash)">
          <input autoFocus type="number" min="0" className="input !text-xl text-center font-bold" value={openingCash} onChange={e => setOpeningCash(e.target.value)} placeholder="2000" />
        </Field>
        <button disabled={busy} onClick={openShift} className="btn-success w-full mt-4 !py-3">فتح الشفت</button>
      </Modal>

      {/* إيصال الطباعة */}
      <Modal open={!!receipt} onClose={() => setReceipt(null)} title=" تم البيع بنجاح">
        {receipt && <Receipt data={receipt} />}
        <div className="mt-4 flex gap-2">
          <button className="btn-primary flex-1" onClick={() => window.print()}><Icon name="print" size={15} className="inline-block align-[-2px]" /> طباعة الإيصال</button>
          <button className="btn-secondary flex-1" onClick={() => { setReceipt(null); scanRef.current?.focus(); }}>فاتورة جديدة</button>
        </div>
      </Modal>
    </div>
  );
}
