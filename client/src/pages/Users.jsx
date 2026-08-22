import { useEffect, useState } from 'react';
import api, { errMsg } from '../api.js';
import { PageTitle, Modal, Field, ErrorBox, Table, Badge } from '../components/UI.jsx';

export default function Users() {
  const [tab, setTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [perms, setPerms] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [posList, setPosList] = useState([]);
  const [modal, setModal] = useState(false);
  const [roleModal, setRoleModal] = useState(false);
  const [form, setForm] = useState({});
  const [roleForm, setRoleForm] = useState({});
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.get('/users').then(r => setUsers(r.data));
    api.get('/roles').then(r => setRoles(r.data));
    api.get('/permissions').then(r => setPerms(r.data));
    api.get('/inventory/warehouses').then(r => setWarehouses(r.data));
    api.get('/pos-locations').then(r => setPosList(r.data));
  };
  useEffect(() => { load(); }, []);

  const saveUser = async () => {
    setBusy(true); setError('');
    try {
      if (edit) await api.put(`/users/${edit}`, form);
      else await api.post('/users', form);
      setModal(false); load();
    } catch (e) { setError(errMsg(e)); }
    setBusy(false);
  };

  const saveRole = async () => {
    setBusy(true); setError('');
    try {
      if (roleForm.id) await api.put(`/roles/${roleForm.id}`, roleForm);
      else await api.post('/roles', roleForm);
      setRoleModal(false); load();
    } catch (e) { setError(errMsg(e)); }
    setBusy(false);
  };

  const removeUser = async (u) => {
    if (!confirm(`حذف/تعطيل ${u.full_name}؟`)) return;
    try { await api.delete(`/users/${u.id}`); load(); } catch (e) { alert(errMsg(e)); }
  };

  const groups = [...new Set(perms.map(p => p.group_name))];

  return (
    <div>
      <PageTitle title="المستخدمون والصلاحيات" subtitle="إدارة المستخدمين والأدوار وربطهم بالمخازن ونقاط البيع">
        {tab === 'users' ? <button className="btn-primary" onClick={() => { setForm({ is_active: 1, warehouse_ids: [], pos_ids: [] }); setEdit(null); setError(''); setModal(true); }}>＋ مستخدم</button>
          : <button className="btn-primary" onClick={() => { setRoleForm({ permissions: [] }); setError(''); setRoleModal(true); }}>＋ دور جديد</button>}
      </PageTitle>

      <div className="mb-4 flex gap-2">
        {[['users', '👥 المستخدمون'], ['roles', '🛡️ الأدوار والصلاحيات']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-xl px-4 py-2 text-sm font-bold ${tab === k ? 'bg-brand-600 text-white shadow' : 'bg-white border border-slate-200 text-slate-600'}`}>{l}</button>
        ))}
      </div>

      {tab === 'users' ? (
        <Table head={['المستخدم', 'الاسم', 'الدور', 'المخازن', 'نقاط البيع', 'الحالة', '']}>
          {users.map(u => (
            <tr key={u.id}>
              <td className="td font-bold">{u.username}</td>
              <td className="td">{u.full_name}</td>
              <td className="td"><Badge color="blue">{u.role_name}</Badge></td>
              <td className="td text-slate-500">{u.warehouse_ids.length ? u.warehouse_ids.map(id => warehouses.find(w => w.id === id)?.name).join('، ') : 'الكل'}</td>
              <td className="td text-slate-500">{u.pos_ids.length ? u.pos_ids.map(id => posList.find(p => p.id === id)?.name).join('، ') : 'الكل'}</td>
              <td className="td">{u.is_active ? <Badge color="green">نشط</Badge> : <Badge color="red">معطّل</Badge>}</td>
              <td className="td">
                <div className="flex gap-1">
                  <button className="btn-ghost !px-2 !py-1" onClick={() => { setForm({ ...u, password: '' }); setEdit(u.id); setError(''); setModal(true); }}>✏️</button>
                  <button className="btn-ghost !px-2 !py-1 text-rose-600" onClick={() => removeUser(u)}>🗑</button>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {roles.map(r => (
            <div key={r.id} className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <div><b>{r.name_ar}</b> <span className="text-xs text-slate-400" dir="ltr">{r.name}</span></div>
                <button className="btn-ghost !px-2 !py-1" onClick={() => { setRoleForm({ id: r.id, name: r.name, name_ar: r.name_ar, description: r.description || '', permissions: r.permissions }); setError(''); setRoleModal(true); }}>✏️</button>
              </div>
              <div className="flex flex-wrap gap-1">
                {r.permissions.slice(0, 12).map(p => <span key={p} className="badge bg-slate-100 text-slate-600" dir="ltr">{p}</span>)}
                {r.permissions.length > 12 && <span className="badge bg-brand-100 text-brand-700">+{r.permissions.length - 12}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* مستخدم */}
      <Modal open={modal} onClose={() => setModal(false)} title={edit ? '✏️ تعديل مستخدم' : '＋ مستخدم جديد'} wide>
        <ErrorBox error={error} />
        <div className="grid md:grid-cols-2 gap-3">
          {!edit && <Field label="اسم المستخدم *"><input className="input" dir="ltr" value={form.username || ''} onChange={e => setForm({ ...form, username: e.target.value })} /></Field>}
          <Field label={edit ? 'كلمة مرور جديدة (اتركها فارغة للإبقاء)' : 'كلمة المرور *'}><input type="password" className="input" dir="ltr" value={form.password || ''} onChange={e => setForm({ ...form, password: e.target.value })} /></Field>
          <Field label="الاسم الكامل *"><input className="input" value={form.full_name || ''} onChange={e => setForm({ ...form, full_name: e.target.value })} /></Field>
          <Field label="الهاتف"><input className="input" dir="ltr" value={form.phone || ''} onChange={e => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="البريد"><input className="input" dir="ltr" value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="الدور *"><select className="input" value={form.role_id || ''} onChange={e => setForm({ ...form, role_id: Number(e.target.value) })}><option value="">اختر…</option>{roles.map(r => <option key={r.id} value={r.id}>{r.name_ar}</option>)}</select></Field>
          <Field label="المخازن المسموحة (فارغة = الكل)">
            <div className="flex flex-wrap gap-1.5">{warehouses.map(w => (
              <label key={w.id} className={`badge cursor-pointer ${form.warehouse_ids?.includes(w.id) ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                <input type="checkbox" className="hidden" checked={!!form.warehouse_ids?.includes(w.id)}
                  onChange={e => setForm({ ...form, warehouse_ids: e.target.checked ? [...(form.warehouse_ids || []), w.id] : (form.warehouse_ids || []).filter(x => x !== w.id) })} />
                {w.name}
              </label>))}</div>
          </Field>
          <Field label="نقاط البيع المسموحة (فارغة = الكل)">
            <div className="flex flex-wrap gap-1.5">{posList.map(p => (
              <label key={p.id} className={`badge cursor-pointer ${form.pos_ids?.includes(p.id) ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                <input type="checkbox" className="hidden" checked={!!form.pos_ids?.includes(p.id)}
                  onChange={e => setForm({ ...form, pos_ids: e.target.checked ? [...(form.pos_ids || []), p.id] : (form.pos_ids || []).filter(x => x !== p.id) })} />
                {p.name}
              </label>))}</div>
          </Field>
          {edit && <label className="flex items-center gap-2 font-semibold text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!!form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked ? 1 : 0 })} /> نشط</label>}
        </div>
        <button disabled={busy} onClick={saveUser} className="btn-primary w-full mt-4 !py-3">{busy ? 'جارٍ الحفظ…' : '💾 حفظ'}</button>
      </Modal>

      {/* دور */}
      <Modal open={roleModal} onClose={() => setRoleModal(false)} title={roleForm.id ? `✏️ تعديل دور — ${roleForm.name_ar}` : '＋ دور جديد'} wide>
        <ErrorBox error={error} />
        <div className="grid md:grid-cols-2 gap-3 mb-4">
          {!roleForm.id && <Field label="الاسم الإنجليزي *"><input className="input" dir="ltr" placeholder="senior_cashier" value={roleForm.name || ''} onChange={e => setRoleForm({ ...roleForm, name: e.target.value })} /></Field>}
          <Field label="اسم الدور *"><input className="input" value={roleForm.name_ar || ''} onChange={e => setRoleForm({ ...roleForm, name_ar: e.target.value })} /></Field>
          <Field label="الوصف"><input className="input" value={roleForm.description || ''} onChange={e => setRoleForm({ ...roleForm, description: e.target.value })} /></Field>
        </div>
        <div className="space-y-3 max-h-[45vh] overflow-y-auto">
          {groups.map(g => (
            <div key={g}>
              <div className="font-extrabold text-sm mb-1.5">{g}</div>
              <div className="flex flex-wrap gap-1.5">
                {perms.filter(p => p.group_name === g).map(p => (
                  <label key={p.code} className={`badge cursor-pointer !py-1.5 !px-3 ${roleForm.permissions?.includes(p.code) ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                    <input type="checkbox" className="hidden" checked={!!roleForm.permissions?.includes(p.code)}
                      onChange={e => setRoleForm({ ...roleForm, permissions: e.target.checked ? [...(roleForm.permissions || []), p.code] : (roleForm.permissions || []).filter(x => x !== p.code) })} />
                    {p.name_ar}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        <button disabled={busy} onClick={saveRole} className="btn-primary w-full mt-4 !py-3">{busy ? 'جارٍ الحفظ…' : '💾 حفظ الدور'}</button>
      </Modal>
    </div>
  );
}
