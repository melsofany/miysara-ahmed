import { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import api, { errMsg } from '../api.js';
import { useAuth } from '../App.jsx';
import { PageTitle, Field, ErrorBox, SuccessBox, Table } from '../components/UI.jsx';

export default function Settings() {
  const { has } = useAuth();
  const [settings, setSettings] = useState({});
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [tab, setTab] = useState('settings');
  const [f, setF] = useState({ entity: '', from: '', to: '' });

  useEffect(() => {
    if (has('settings.manage')) api.get('/system/settings').then(r => setSettings(r.data));
  }, []);
  useEffect(() => {
    if (tab === 'audit' && has('audit.view')) {
      const params = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
      api.get('/system/audit-logs', { params }).then(r => setLogs(r.data));
    }
  }, [tab, f]);

  const save = async () => {
    setError('');
    try { await api.put('/system/settings', settings); setSuccess('تم حفظ الإعدادات'); }
    catch (e) { setError(errMsg(e)); }
  };

  return (
    <div>
      <PageTitle title="الإعدادات والنظام" />
      <div className="mb-4 flex gap-2">
        {has('settings.manage') && <button onClick={() => setTab('settings')} className={`rounded-xl px-4 py-2 text-sm font-bold ${tab === 'settings' ? 'bg-brand-600 text-white' : 'bg-white border border-slate-200'}`}><Icon name="settings" size={15} className="inline-block align-[-2px]" /> الإعدادات</button>}
        {has('audit.view') && <button onClick={() => setTab('audit')} className={`rounded-xl px-4 py-2 text-sm font-bold ${tab === 'audit' ? 'bg-brand-600 text-white' : 'bg-white border border-slate-200'}`}><Icon name="history" size={15} className="inline-block align-[-2px]" /> سجل العمليات</button>}
      </div>
      <SuccessBox msg={success} /><ErrorBox error={error} />

      {tab === 'settings' && has('settings.manage') && (
        <div className="card p-5 max-w-2xl space-y-4">
          <Field label="اسم المتجر (يظهر في الإيصال)"><input className="input" value={settings.store_name || ''} onChange={e => setSettings({ ...settings, store_name: e.target.value })} /></Field>
          <Field label="تذييل الإيصال"><input className="input" value={settings.receipt_footer || ''} onChange={e => setSettings({ ...settings, receipt_footer: e.target.value })} /></Field>
          <Field label="العملة"><input className="input" dir="ltr" value={settings.currency || ''} onChange={e => setSettings({ ...settings, currency: e.target.value })} /></Field>
          <label className="flex items-center gap-2 font-semibold text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={settings.allow_negative_stock === '1'}
              onChange={e => setSettings({ ...settings, allow_negative_stock: e.target.checked ? '1' : '0' })} />
            السماح بالمخزون السالب (البيع/الصرف بدون رصيد)
          </label>
          <button onClick={save} className="btn-primary !py-3 px-8"><Icon name="save" size={15} className="inline-block align-[-2px]" /> حفظ الإعدادات</button>
        </div>
      )}

      {tab === 'audit' && (
        <div>
          <div className="card p-4 mb-4 flex flex-wrap gap-2">
            <input className="input w-52" placeholder="الكيان (invoices, products…)" dir="ltr" value={f.entity} onChange={e => setF({ ...f, entity: e.target.value })} />
            <input type="date" className="input w-44" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} />
            <input type="date" className="input w-44" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} />
          </div>
          <Table head={['التاريخ', 'المستخدم', 'العملية', 'الكيان', 'المعرف', 'السبب', 'IP']}>
            {logs.map(l => (
              <tr key={l.id} title={`قديم: ${l.old_data || '—'}\nجديد: ${l.new_data || '—'}`}>
                <td className="td text-slate-500">{l.created_at}</td>
                <td className="td font-semibold">{l.user_name || '—'}</td>
                <td className="td"><span className="badge bg-slate-100 text-slate-600" dir="ltr">{l.action}</span></td>
                <td className="td" dir="ltr">{l.entity}</td>
                <td className="td" dir="ltr">{l.entity_id || '—'}</td>
                <td className="td text-slate-500 max-w-[220px] truncate">{l.reason || '—'}</td>
                <td className="td text-slate-400" dir="ltr">{l.ip || '—'}</td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </div>
  );
}
