import { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import api, { errMsg, fmt } from '../api.js';
import { useAuth } from '../App.jsx';
import { PageTitle, Modal, Field, ErrorBox, SuccessBox, Table, Badge } from '../components/UI.jsx';

const emptyProduct = { sku: '', barcode: '', name: '', description: '', category_id: '', season_id: '', supplier_id: '', manufacturer_id: '', model_number: '', cost_price: 0, selling_price: 0, min_stock: 0, image: '' };
const emptyVariant = { sku: '', barcode: '', size: '', color: '', cost_price: 0, selling_price: 0, min_stock: 0 };

export default function Products() {
  const { has } = useAuth();
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ categories: [], seasons: [], suppliers: [], manufacturers: [] });
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(emptyProduct);
  const [variants, setVariants] = useState([]);
  const [editId, setEditId] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    const params = {};
    if (q) params.q = q;
    if (categoryId) params.category_id = categoryId;
    api.get('/products', { params }).then(r => setRows(r.data));
  };
  useEffect(() => { load(); }, [q, categoryId]);
  useEffect(() => {
    Promise.all(['/categories', '/seasons', '/suppliers', '/manufacturers'].map(u => api.get(u).then(r => r.data).catch(() => [])))
      .then(([categories, seasons, suppliers, manufacturers]) => setMeta({ categories, seasons, suppliers, manufacturers }));
  }, []);

  const openNew = () => { setForm(emptyProduct); setVariants([]); setEditId(null); setError(''); setModal(true); };
  const openEdit = async (id) => {
    const { data } = await api.get(`/products/${id}`);
    setForm({
      sku: data.sku, barcode: data.barcode || '', name: data.name, description: data.description || '',
      category_id: data.category_id || '', season_id: data.season_id || '', supplier_id: data.supplier_id || '',
      manufacturer_id: data.manufacturer_id || '', model_number: data.model_number || '',
      cost_price: data.cost_price ?? 0, selling_price: data.selling_price ?? 0, min_stock: data.min_stock ?? 0, image: data.image || '',
    });
    setVariants(data.variants.map(v => ({ ...v, existing: true })));
    setEditId(id); setError(''); setModal(true);
  };

  const save = async () => {
    setBusy(true); setError('');
    try {
      if (editId) {
        await api.put(`/products/${editId}`, form);
        for (const v of variants) {
          const payload = { sku: v.sku, barcode: v.barcode || undefined, size: v.size, color: v.color, cost_price: v.cost_price, selling_price: v.selling_price, min_stock: v.min_stock, is_active: v.is_active };
          if (v.existing) await api.put(`/variants/${v.id}`, payload);
          else await api.post(`/products/${editId}/variants`, payload);
        }
        setSuccess('تم حفظ المنتج بنجاح');
      } else {
        await api.post('/products', { ...form, variants });
        setSuccess('تم إنشاء المنتج بنجاح');
      }
      setModal(false); load();
    } catch (e) { setError(errMsg(e)); }
    setBusy(false);
  };

  const remove = async (id) => {
    if (!confirm('حذف/تعطيل هذا المنتج؟')) return;
    try { const { data } = await api.delete(`/products/${id}`); setSuccess(data.deactivated ? 'تم تعطيل المنتج (له حركات مسجلة)' : 'تم حذف المنتج'); load(); }
    catch (e) { setError(errMsg(e)); }
  };

  const num = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div>
      <PageTitle title="المنتجات والأصناف" subtitle="إدارة المنتجات والمقاسات والألوان (Variants)">
        {has('products.create') && <button className="btn-primary" onClick={openNew}>＋ منتج جديد</button>}
      </PageTitle>
      <SuccessBox msg={success} /><ErrorBox error={!modal ? error : ''} />

      <div className="card p-4 mb-4 flex flex-wrap gap-3">
        <input className="input flex-1 min-w-[200px]" placeholder="بحث بالاسم / SKU / باركود / موديل…" value={q} onChange={e => setQ(e.target.value)} />
        <select className="input w-56" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
          <option value="">كل التصنيفات</option>
          {meta.categories.map(c => <option key={c.id} value={c.id}>{c.parent_id ? '— ' : ''}{c.name}</option>)}
        </select>
      </div>

      <Table head={['المنتج', 'SKU', 'التصنيف', 'الموسم', 'المورد', has('cost.view') ? 'التكلفة' : null, 'سعر البيع', 'الحالة', ''].filter(Boolean)}>
        {rows.map(p => (
          <tr key={p.id}>
            <td className="td font-bold">{p.name}{p.model_number && <span className="block text-xs text-slate-400">موديل: {p.model_number}</span>}</td>
            <td className="td text-slate-500">{p.sku}</td>
            <td className="td">{p.parent_category_name ? `${p.parent_category_name} / ` : ''}{p.category_name || '—'}</td>
            <td className="td">{p.season_name || '—'}</td>
            <td className="td">{p.supplier_name || '—'}</td>
            {has('cost.view') && <td className="td text-slate-500">{fmt(p.cost_price)}</td>}
            <td className="td font-bold text-brand-700">{fmt(p.selling_price)}</td>
            <td className="td">{p.is_active ? <Badge color="green">نشط</Badge> : <Badge color="red">معطّل</Badge>}</td>
            <td className="td">
              <div className="flex gap-1">
                {has('products.edit') && <button className="btn-ghost !px-2 !py-1" onClick={() => openEdit(p.id)}><Icon name="edit" size={15} className="inline-block align-[-2px]" /></button>}
                {has('products.delete') && <button className="btn-ghost !px-2 !py-1 text-rose-600" onClick={() => remove(p.id)}><Icon name="trash" size={15} className="inline-block align-[-2px]" /></button>}
              </div>
            </td>
          </tr>
        ))}
      </Table>

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? '️ تعديل منتج' : '＋ منتج جديد'} wide>
        <ErrorBox error={error} />
        <div className="grid md:grid-cols-3 gap-3">
          <Field label="اسم المنتج *"><input className="input" value={form.name} onChange={num('name')} /></Field>
          <Field label="SKU *"><input className="input" dir="ltr" value={form.sku} onChange={num('sku')} /></Field>
          <Field label="باركود المنتج"><input className="input" dir="ltr" value={form.barcode} onChange={num('barcode')} /></Field>
          <Field label="التصنيف"><select className="input" value={form.category_id} onChange={num('category_id')}><option value="">—</option>{meta.categories.map(c => <option key={c.id} value={c.id}>{c.parent_id ? '— ' : ''}{c.name}</option>)}</select></Field>
          <Field label="الموسم"><select className="input" value={form.season_id} onChange={num('season_id')}><option value="">—</option>{meta.seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="المورد"><select className="input" value={form.supplier_id} onChange={num('supplier_id')}><option value="">—</option>{meta.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="الماركة / الشركة المصنعة"><select className="input" value={form.manufacturer_id} onChange={num('manufacturer_id')}><option value="">—</option>{meta.manufacturers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
          <Field label="رقم الموديل"><input className="input" value={form.model_number} onChange={num('model_number')} /></Field>
          <Field label="رابط الصورة"><input className="input" dir="ltr" value={form.image} onChange={num('image')} /></Field>
          {has('cost.view') && <Field label="سعر التكلفة"><input type="number" min="0" className="input" value={form.cost_price} onChange={num('cost_price')} /></Field>}
          <Field label="سعر البيع"><input type="number" min="0" className="input" value={form.selling_price} onChange={num('selling_price')} /></Field>
          <Field label="حد الطلب (تنبيه نقص)"><input type="number" min="0" className="input" value={form.min_stock} onChange={num('min_stock')} /></Field>
          <Field label="الوصف"><input className="input" value={form.description} onChange={num('description')} /></Field>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-extrabold">المتغيرات (مقاس × لون)</h4>
            <button className="btn-secondary !py-1.5" onClick={() => setVariants([...variants, { ...emptyVariant, sku: `${form.sku || 'P'}-V${variants.length + 1}`, cost_price: form.cost_price, selling_price: form.selling_price }])}>＋ متغير</button>
          </div>
          <div className="space-y-2">
            {variants.map((v, i) => (
              <div key={i} className="grid grid-cols-2 md:grid-cols-8 gap-2 items-center rounded-xl bg-slate-50 p-2">
                <input className="input !py-1.5" dir="ltr" placeholder="SKU *" value={v.sku} onChange={e => setVariants(variants.map((x, j) => j === i ? { ...x, sku: e.target.value } : x))} />
                <input className="input !py-1.5" dir="ltr" placeholder="باركود" value={v.barcode || ''} onChange={e => setVariants(variants.map((x, j) => j === i ? { ...x, barcode: e.target.value } : x))} />
                <input className="input !py-1.5" placeholder="المقاس" value={v.size || ''} onChange={e => setVariants(variants.map((x, j) => j === i ? { ...x, size: e.target.value } : x))} />
                <input className="input !py-1.5" placeholder="اللون" value={v.color || ''} onChange={e => setVariants(variants.map((x, j) => j === i ? { ...x, color: e.target.value } : x))} />
                {has('cost.view') ? <input type="number" className="input !py-1.5" placeholder="تكلفة" value={v.cost_price} onChange={e => setVariants(variants.map((x, j) => j === i ? { ...x, cost_price: e.target.value } : x))} /> : <span />}
                <input type="number" className="input !py-1.5" placeholder="بيع" value={v.selling_price} onChange={e => setVariants(variants.map((x, j) => j === i ? { ...x, selling_price: e.target.value } : x))} />
                <input type="number" className="input !py-1.5" placeholder="حد الطلب" value={v.min_stock} onChange={e => setVariants(variants.map((x, j) => j === i ? { ...x, min_stock: e.target.value } : x))} />
                <button className="btn-ghost text-rose-600 !py-1.5" onClick={() => setVariants(variants.filter((_, j) => j !== i))}><Icon name="trash" size={15} className="inline-block align-[-2px]" /></button>
              </div>
            ))}
            {!variants.length && <div className="text-sm text-slate-400 text-center py-3">أضف متغيرًا واحدًا على الأقل (SKU + باركود مستقل لكل مقاس/لون)</div>}
          </div>
        </div>
        <button disabled={busy} onClick={save} className="btn-primary w-full mt-5 !py-3">{busy ? 'جارٍ الحفظ…' : ' حفظ المنتج'}</button>
      </Modal>
    </div>
  );
}
