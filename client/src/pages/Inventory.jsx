import { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import api, { errMsg, fmt } from '../api.js';
import { useAuth } from '../App.jsx';
import { PageTitle, Modal, Field, ErrorBox, SuccessBox, Table, Badge } from '../components/UI.jsx';

const MOVE_AR = {
  RECEIVE_SUPPLIER: 'استلام من مورد', ADD: 'إضافة مخزون', ISSUE: 'صرف', TRANSFER: 'تحويل بين مخازن',
  TRANSFER_TO_POS: 'تحويل لنقطة بيع', POS_RECEIVE: 'استلام نقطة بيع', POS_RETURN: 'مرتجع للمخزن',
  ADJUSTMENT: 'تسوية', STOCKTAKE: 'جرد', SALE: 'بيع', SALE_RETURN: 'مرتجع بيع',
  SALE_EDIT_REVERSE: 'عكس تعديل', SALE_EDIT_APPLY: 'تطبيق تعديل', CANCEL_REVERSE: 'عكس إلغاء',
};

function VariantPicker({ value, onChange }) {
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState([]);
  useEffect(() => {
    const t = setTimeout(() => {
      api.get('/products', { params: q ? { q } : {} }).then(async r => {
        const all = [];
        for (const p of r.data.slice(0, 10)) {
          const d = await api.get(`/products/${p.id}`).then(x => x.data).catch(() => null);
          if (d) for (const v of d.variants) all.push({ ...v, product_name: p.name });
        }
        setOpts(all);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div>
      <input className="input" placeholder="ابحث عن صنف بالاسم/SKU…" value={q} onChange={e => setQ(e.target.value)} />
      {q && opts.length > 0 && (
        <div className="mt-1 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {opts.map(v => (
            <button key={v.id} type="button" onClick={() => { onChange(v); setQ(`${v.product_name} — ${v.size}/${v.color}`); setOpts([]); }}
              className={`block w-full text-start px-3 py-2 text-sm hover:bg-brand-50 ${value?.id === v.id ? 'bg-brand-50 font-bold' : ''}`}>
              {v.product_name} <span className="text-slate-400">({v.size} / {v.color}) — {v.sku}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Inventory() {
  const { has } = useAuth();
  const [tab, setTab] = useState('stock');
  const [warehouses, setWarehouses] = useState([]);
  const [posList, setPosList] = useState([]);
  const [locType, setLocType] = useState('warehouse');
  const [locId, setLocId] = useState(null);
  const [stock, setStock] = useState([]);
  const [movements, setMovements] = useState([]);
  const [valuation, setValuation] = useState([]);
  const [q, setQ] = useState('');
  const [modal, setModal] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  // receive/issue/transfer
  const [opForm, setOpForm] = useState({ warehouse_id: '', supplier_id: '', from_type: 'warehouse', from_id: '', to_type: 'pos', to_id: '', notes: '', document_number: '' });
  const [lines, setLines] = useState([]);
  const [line, setLine] = useState({ variant: null, quantity: 1, cost_price: 0 });
  const [suppliers, setSuppliers] = useState([]);
  // adjust
  const [adj, setAdj] = useState({ variant: null, quantity: '', reason: '' });
  // stocktake
  const [counts, setCounts] = useState({});

  useEffect(() => {
    api.get('/inventory/warehouses').then(r => { setWarehouses(r.data); if (r.data[0]) setLocId(r.data[0].id); });
    api.get('/pos-locations').then(r => setPosList(r.data)).catch(() => {});
    api.get('/suppliers').then(r => setSuppliers(r.data)).catch(() => {});
    if (has('cost.view')) api.get('/inventory/valuation').then(r => setValuation(r.data)).catch(() => {});
  }, []);

  const loadStock = () => {
    if (!locId) return;
    api.get('/inventory/stock', { params: { location_type: locType, location_id: locId, q } }).then(r => setStock(r.data));
  };
  const loadMovements = () => {
    if (!locId) return;
    api.get('/inventory/movements', { params: { location_type: locType, location_id: locId } }).then(r => setMovements(r.data));
  };
  useEffect(() => { loadStock(); loadMovements(); }, [locType, locId, q]);

  const addLine = () => {
    if (!line.variant) return setError('اختر صنفًا');
    setLines(ls => [...ls, { variant_id: line.variant.id, label: `${line.variant.product_name} (${line.variant.size}/${line.variant.color})`, quantity: Number(line.quantity), cost_price: Number(line.cost_price) || 0 }]);
    setLine({ variant: null, quantity: 1, cost_price: 0 });
  };

  const submitOp = async () => {
    if (!lines.length) return setError('أضف صنفًا واحدًا على الأقل');
    setBusy(true); setError('');
    try {
      let res;
      if (modal === 'receive') res = await api.post('/inventory/receive', { warehouse_id: Number(opForm.warehouse_id || locId), supplier_id: opForm.supplier_id || undefined, notes: opForm.notes, items: lines });
      else if (modal === 'issue') res = await api.post('/inventory/issue', { warehouse_id: Number(opForm.warehouse_id || locId), supplier_id: opForm.supplier_id || undefined, notes: opForm.notes, items: lines });
      else res = await api.post('/inventory/transfer', { from_type: opForm.from_type, from_id: Number(opForm.from_id), to_type: opForm.to_type, to_id: Number(opForm.to_id), notes: opForm.notes, items: lines });
      setSuccess(`تم التنفيذ — مستند ${res.data.document_number}`);
      setModal(''); setLines([]); loadStock(); loadMovements();
    } catch (e) { setError(errMsg(e)); }
    setBusy(false);
  };

  const submitAdjust = async () => {
    if (!adj.variant || !adj.quantity || !adj.reason) return setError('أكمل كل الحقول');
    setBusy(true); setError('');
    try {
      await api.post('/inventory/adjust', { location_type: locType, location_id: locId, variant_id: adj.variant.id, quantity: Number(adj.quantity), reason: adj.reason });
      setSuccess('تمت التسوية'); setModal(''); setAdj({ variant: null, quantity: '', reason: '' }); loadStock(); loadMovements();
    } catch (e) { setError(errMsg(e)); }
    setBusy(false);
  };

  const submitStocktake = async () => {
    const payload = Object.entries(counts).filter(([, v]) => v !== '').map(([vid, v]) => ({ variant_id: Number(vid), quantity: Number(v) }));
    if (!payload.length) return setError('أدخل نتائج الجرد');
    setBusy(true); setError('');
    try {
      const { data } = await api.post('/inventory/stocktake', { location_type: locType, location_id: locId, counts: payload });
      setSuccess(`تم الجرد — ${data.differences.length} فرق مسجل`); setModal(''); setCounts({}); loadStock(); loadMovements();
    } catch (e) { setError(errMsg(e)); }
    setBusy(false);
  };

  const locations = locType === 'warehouse' ? warehouses : posList;

  return (
    <div>
      <PageTitle title="إدارة المخزون" subtitle="الأرصدة والحركات والتحويلات والجرد">
        {has('inventory.receive') && <button className="btn-success" onClick={() => { setModal('receive'); setError(''); }}><Icon name="download" size={15} className="inline-block align-[-2px]" /> استلام</button>}
        {has('inventory.adjust') && <button className="btn-secondary" onClick={() => { setModal('issue'); setError(''); }}><Icon name="upload" size={15} className="inline-block align-[-2px]" /> صرف</button>}
        {has('inventory.transfer') && <button className="btn-primary" onClick={() => { setModal('transfer'); setError(''); }}><Icon name="refresh" size={15} className="inline-block align-[-2px]" /> تحويل</button>}
        {has('inventory.adjust') && <button className="btn-secondary" onClick={() => { setModal('adjust'); setError(''); }}><Icon name="scale" size={15} className="inline-block align-[-2px]" /> تسوية</button>}
        {has('inventory.stocktake') && <button className="btn-secondary" onClick={() => { setModal('stocktake'); setCounts({}); setError(''); }}><Icon name="calc" size={15} className="inline-block align-[-2px]" /> جرد</button>}
      </PageTitle>
      <SuccessBox msg={success} />

      <div className="card p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="label">نوع الموقع</label>
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
            {[['warehouse', ' مخزن'], ['pos', ' نقطة بيع']].map(([k, l]) => (
              <button key={k} onClick={() => { setLocType(k); const list = k === 'warehouse' ? warehouses : posList; setLocId(list[0]?.id || null); }}
                className={`rounded-lg px-4 py-1.5 text-sm font-bold ${locType === k ? 'bg-white shadow text-brand-700' : 'text-slate-500'}`}>{l}</button>
            ))}
          </div>
        </div>
        <div className="min-w-[220px]">
          <label className="label">الموقع</label>
          <select className="input" value={locId || ''} onChange={e => setLocId(Number(e.target.value))}>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="label">بحث</label>
          <input className="input" placeholder="اسم / SKU / باركود…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {[['stock', 'الأرصدة'], ['movements', 'الحركات'], ...(has('cost.view') ? [['valuation', 'تقييم المخزون']] : [])].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-lg px-4 py-1.5 text-sm font-bold ${tab === k ? 'bg-white shadow text-brand-700' : 'text-slate-500'}`}>{l}</button>
          ))}
        </div>
      </div>

      {tab === 'stock' && (
        <Table head={['المنتج', 'SKU', 'باركود', 'الرصيد', 'حد الطلب', has('cost.view') ? 'متوسط التكلفة' : null, 'سعر البيع', 'الحالة'].filter(Boolean)}>
          {stock.map(r => (
            <tr key={r.variant_id}>
              <td className="td font-bold">{r.product_name} <span className="text-xs text-slate-400">{r.size} / {r.color}</span></td>
              <td className="td text-slate-500">{r.sku}</td>
              <td className="td text-slate-500">{r.barcode || '—'}</td>
              <td className="td font-extrabold text-lg">{fmt(r.quantity)}</td>
              <td className="td text-slate-500">{fmt(r.min_stock)}</td>
              {has('cost.view') && <td className="td">{fmt(r.avg_cost)}</td>}
              <td className="td font-bold text-brand-700">{fmt(r.selling_price)}</td>
              <td className="td">{r.quantity <= 0 ? <Badge color="red">نافد</Badge> : r.quantity <= r.min_stock ? <Badge color="amber">منخفض</Badge> : <Badge color="green">متوفر</Badge>}</td>
            </tr>
          ))}
        </Table>
      )}

      {tab === 'movements' && (
        <Table head={['رقم الحركة', 'التاريخ', 'النوع', 'المنتج', 'الكمية', has('cost.view') ? 'التكلفة' : null, 'المستخدم', 'المستند', 'ملاحظات'].filter(Boolean)}>
          {movements.map(m => (
            <tr key={m.id}>
              <td className="td text-slate-500">{m.movement_number}</td>
              <td className="td text-slate-500">{m.created_at}</td>
              <td className="td"><Badge color={['SALE', 'ISSUE', 'POS_RETURN'].includes(m.movement_type) ? 'rose' : ['RECEIVE_SUPPLIER', 'ADD', 'SALE_RETURN'].includes(m.movement_type) ? 'green' : 'blue'}>{MOVE_AR[m.movement_type] || m.movement_type}</Badge></td>
              <td className="td font-semibold">{m.product_name} <span className="text-xs text-slate-400">{m.size}/{m.color}</span></td>
              <td className="td font-bold">{fmt(m.quantity)}</td>
              {has('cost.view') && <td className="td">{fmt(m.cost_price)}</td>}
              <td className="td text-slate-500">{m.user_name || '—'}</td>
              <td className="td text-slate-500">{m.document_number || '—'}</td>
              <td className="td text-slate-400 text-xs max-w-[200px] truncate">{m.notes || ''}</td>
            </tr>
          ))}
        </Table>
      )}

      {tab === 'valuation' && has('cost.view') && (
        <Table head={['الموقع', 'النوع', 'إجمالي القطع', 'القيمة بالتكلفة', 'القيمة بسعر البيع', 'ربح متوقع']}>
          {valuation.map((v, i) => (
            <tr key={i}>
              <td className="td font-bold">{v.location_name}</td>
              <td className="td"><Badge color={v.location_type === 'warehouse' ? 'blue' : 'violet'}>{v.location_type === 'warehouse' ? 'مخزن' : 'نقطة بيع'}</Badge></td>
              <td className="td">{fmt(v.total_qty)}</td>
              <td className="td">{fmt(v.total_cost)}</td>
              <td className="td">{fmt(v.total_selling)}</td>
              <td className="td font-bold text-emerald-700">{fmt(v.total_selling - v.total_cost)}</td>
            </tr>
          ))}
        </Table>
      )}

      {/* استلام / صرف / تحويل */}
      <Modal open={['receive', 'issue', 'transfer'].includes(modal)} onClose={() => setModal('')} wide
        title={modal === 'receive' ? ' استلام بضاعة من مورد' : modal === 'issue' ? ' صرف من المخزن' : ' تحويل مخزون'}>
        <ErrorBox error={error} />
        <div className="grid md:grid-cols-3 gap-3 mb-3">
          {modal === 'transfer' ? (
            <>
              <Field label="من"><div className="flex gap-1">
                <select className="input !w-24" value={opForm.from_type} onChange={e => setOpForm({ ...opForm, from_type: e.target.type === undefined ? e.target.value : e.target.value, from_id: '' })}><option value="warehouse">مخزن</option><option value="pos">نقطة بيع</option></select>
                <select className="input flex-1" value={opForm.from_id} onChange={e => setOpForm({ ...opForm, from_id: e.target.value })}>
                  <option value="">اختر…</option>
                  {(opForm.from_type === 'warehouse' ? warehouses : posList).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select></div></Field>
              <Field label="إلى"><div className="flex gap-1">
                <select className="input !w-24" value={opForm.to_type} onChange={e => setOpForm({ ...opForm, to_type: e.target.value, to_id: '' })}><option value="warehouse">مخزن</option><option value="pos">نقطة بيع</option></select>
                <select className="input flex-1" value={opForm.to_id} onChange={e => setOpForm({ ...opForm, to_id: e.target.value })}>
                  <option value="">اختر…</option>
                  {(opForm.to_type === 'warehouse' ? warehouses : posList).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select></div></Field>
            </>
          ) : (
            <>
              <Field label="المخزن"><select className="input" value={opForm.warehouse_id || locId || ''} onChange={e => setOpForm({ ...opForm, warehouse_id: e.target.value })}>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
              <Field label="المورد"><select className="input" value={opForm.supplier_id} onChange={e => setOpForm({ ...opForm, supplier_id: e.target.value })}><option value="">— بدون —</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            </>
          )}
          <Field label="ملاحظات"><input className="input" value={opForm.notes} onChange={e => setOpForm({ ...opForm, notes: e.target.value })} /></Field>
        </div>
        <div className="rounded-xl bg-slate-50 p-3 grid md:grid-cols-[1fr_100px_110px_auto] gap-2 items-end">
          <Field label="الصنف"><VariantPicker value={line.variant} onChange={v => setLine({ ...line, variant: v, cost_price: v.cost_price ?? 0 })} /></Field>
          <Field label="الكمية"><input type="number" min="1" className="input" value={line.quantity} onChange={e => setLine({ ...line, quantity: e.target.value })} /></Field>
          {modal === 'receive' && has('cost.view') ? <Field label="التكلفة"><input type="number" min="0" className="input" value={line.cost_price} onChange={e => setLine({ ...line, cost_price: e.target.value })} /></Field> : <span />}
          <button type="button" className="btn-primary" onClick={addLine}>＋ إضافة</button>
        </div>
        <div className="mt-3 space-y-1.5">
          {lines.map((l, i) => (
            <div key={i} className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <span className="font-semibold">{l.label}</span>
              <span>× {fmt(l.quantity)}{modal === 'receive' && l.cost_price ? ` — تكلفة ${fmt(l.cost_price)}` : ''}</span>
              <button className="text-rose-500" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Icon name="trash" size={15} className="inline-block align-[-2px]" /></button>
            </div>
          ))}
        </div>
        <button disabled={busy} onClick={submitOp} className="btn-primary w-full mt-4 !py-3">{busy ? 'جارٍ التنفيذ…' : ' تنفيذ'}</button>
      </Modal>

      {/* تسوية */}
      <Modal open={modal === 'adjust'} onClose={() => setModal('')} title="️ تسوية مخزون">
        <ErrorBox error={error} />
        <div className="space-y-3">
          <Field label="الصنف"><VariantPicker value={adj.variant} onChange={v => setAdj({ ...adj, variant: v })} /></Field>
          <Field label="الكمية (+ زيادة / − عجز)"><input type="number" className="input" value={adj.quantity} onChange={e => setAdj({ ...adj, quantity: e.target.value })} placeholder="مثال: 5 أو -2" /></Field>
          <Field label="سبب التسوية *"><input className="input" value={adj.reason} onChange={e => setAdj({ ...adj, reason: e.target.value })} placeholder="تالف / خطأ إدخال / …" /></Field>
        </div>
        <button disabled={busy} onClick={submitAdjust} className="btn-primary w-full mt-4 !py-3">تنفيذ التسوية</button>
      </Modal>

      {/* جرد */}
      <Modal open={modal === 'stocktake'} onClose={() => setModal('')} title=" جرد المخزون" wide>
        <ErrorBox error={error} />
        <p className="text-sm text-slate-500 mb-3">أدخل الكمية الفعلية المعدودة — سيتم تسجيل فروقات الجرد فقط. اترك الحقل فارغًا لتجاهل الصنف.</p>
        <div className="max-h-[55vh] overflow-y-auto space-y-1.5">
          {stock.map(r => (
            <div key={r.variant_id} className="grid grid-cols-[1fr_90px_110px] items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <span className="font-semibold">{r.product_name} <span className="text-xs text-slate-400">{r.size}/{r.color}</span></span>
              <span className="text-slate-400">دفتري: {fmt(r.quantity)}</span>
              <input type="number" min="0" className="input !py-1.5 text-center" placeholder="فعلي" value={counts[r.variant_id] ?? ''} onChange={e => setCounts({ ...counts, [r.variant_id]: e.target.value })} />
            </div>
          ))}
        </div>
        <button disabled={busy} onClick={submitStocktake} className="btn-primary w-full mt-4 !py-3">اعتماد الجرد</button>
      </Modal>
    </div>
  );
}
