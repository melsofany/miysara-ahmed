import { useEffect, useState } from 'react';
import api, { errMsg } from '../api.js';
import { PageTitle, Modal, Field, ErrorBox, Table, Badge } from '../components/UI.jsx';

const TABS = [
  { key: 'categories', label: 'التصنيفات', fields: [{ k: 'name', l: 'اسم التصنيف', req: true }, { k: 'parent_id', l: 'التصنيف الأب', type: 'parent' }] },
  { key: 'suppliers', label: 'الموردون', fields: [{ k: 'name', l: 'اسم المورد', req: true }, { k: 'contact_person', l: 'جهة الاتصال' }, { k: 'phone', l: 'الهاتف' }, { k: 'email', l: 'البريد' }, { k: 'address', l: 'العنوان' }] },
  { key: 'manufacturers', label: 'الماركات / الشركات المصنعة', fields: [{ k: 'name', l: 'الاسم', req: true }] },
  { key: 'seasons', label: 'المواسم', fields: [{ k: 'name', l: 'اسم الموسم', req: true }] },
  { key: 'warehouses', label: 'المخازن', endpoint: '/inventory/warehouses', fields: [{ k: 'name', l: 'اسم المخزن', req: true }, { k: 'code', l: 'الكود', req: true }, { k: 'address', l: 'العنوان' }] },
  { key: 'pos_locations', label: 'نقاط البيع', endpoint: '/pos-locations', fields: [{ k: 'name', l: 'اسم نقطة البيع', req: true }, { k: 'code', l: 'الكود', req: true }, { k: 'address', l: 'العنوان' }] },
];

export default function MasterData() {
  const [tab, setTab] = useState(TABS[0]);
  const [rows, setRows] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({});
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const endpoint = tab.endpoint || `/${tab.key}`;
  const load = () => api.get(endpoint).then(r => setRows(r.data)).catch(() => setRows([]));
  useEffect(() => { load(); }, [tab]);

  const openNew = () => { setForm({}); setEdit(null); setError(''); setModal(true); };
  const openEdit = (r) => { setForm({ ...r }); setEdit(r.id); setError(''); setModal(true); };

  const save = async () => {
    setBusy(true); setError('');
    try {
      const payload = { ...form };
      if (payload.parent_id === '') payload.parent_id = null;
      if (edit) await api.put(`${endpoint}/${edit}`, payload);
      else await api.post(endpoint, payload);
      setModal(false); load();
    } catch (e) { setError(errMsg(e)); }
    setBusy(false);
  };

  const parents = tab.key === 'categories' ? rows.filter(r => !r.parent_id) : [];

  return (
    <div>
      <PageTitle title="البيانات الأساسية" subtitle="التصنيفات والموردون والماركات والمواسم والمخازن ونقاط البيع">
        <button className="btn-primary" onClick={openNew}>＋ إضافة</button>
      </PageTitle>

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t)}
            className={`rounded-xl px-4 py-2 text-sm font-bold transition ${tab.key === t.key ? 'bg-brand-600 text-white shadow' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <Table head={[...tab.fields.filter(f => f.type !== 'parent').map(f => f.l), tab.key === 'categories' ? 'التصنيف الأب' : null, 'الحالة', ''].filter(Boolean)}>
        {rows.map(r => (
          <tr key={r.id}>
            {tab.fields.filter(f => f.type !== 'parent').map(f => (
              <td key={f.k} className={`td ${f.k === 'name' ? 'font-bold' : 'text-slate-500'}`}>{f.k === 'parent_id' ? '' : (r[f.k] ?? '—')}</td>
            ))}
            {tab.key === 'categories' && <td className="td text-slate-500">{rows.find(x => x.id === r.parent_id)?.name || '— رئيسي —'}</td>}
            <td className="td">{'is_active' in r ? (r.is_active ? <Badge color="green">نشط</Badge> : <Badge color="red">معطّل</Badge>) : '—'}</td>
            <td className="td"><button className="btn-ghost !px-2 !py-1" onClick={() => openEdit(r)}>✏️</button></td>
          </tr>
        ))}
      </Table>

      <Modal open={modal} onClose={() => setModal(false)} title={`${edit ? 'تعديل' : 'إضافة'} — ${tab.label}`}>
        <ErrorBox error={error} />
        <div className="space-y-3">
          {tab.fields.map(f => (
            <Field key={f.k} label={`${f.l}${f.req ? ' *' : ''}`}>
              {f.type === 'parent' ? (
                <select className="input" value={form.parent_id || ''} onChange={e => setForm({ ...form, parent_id: e.target.value })}>
                  <option value="">— تصنيف رئيسي —</option>
                  {parents.filter(p => p.id !== edit).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              ) : (
                <input className="input" value={form[f.k] || ''} onChange={e => setForm({ ...form, [f.k]: e.target.value })} />
              )}
            </Field>
          ))}
          {edit && 'is_active' in (rows.find(r => r.id === edit) || {}) && (
            <label className="flex items-center gap-2 font-semibold text-sm">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!!form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked ? 1 : 0 })} /> نشط
            </label>
          )}
        </div>
        <button disabled={busy} onClick={save} className="btn-primary w-full mt-5 !py-3">{busy ? 'جارٍ الحفظ…' : '💾 حفظ'}</button>
      </Modal>
    </div>
  );
}
