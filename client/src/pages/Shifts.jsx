import { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import api, { errMsg, fmt } from '../api.js';
import { useAuth } from '../App.jsx';
import { PageTitle, Modal, Field, ErrorBox, SuccessBox, Table, Badge } from '../components/UI.jsx';

const CM_AR = { sale: 'مبيعات', refund: 'مرتجع', expense: 'مصروف' };
const PAY_AR = { cash: 'نقدي', card: 'بطاقة', bank_transfer: 'تحويل', wallet: 'محفظة' };

export default function Shifts() {
  const { has } = useAuth();
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ from: '', to: '', cashier_id: '', pos_location_id: '', status: '' });
  const [posList, setPosList] = useState([]);
  const [users, setUsers] = useState([]);
  const [detail, setDetail] = useState(null);
  const [closeModal, setCloseModal] = useState(null);
  const [actualCash, setActualCash] = useState('');
  const [expModal, setExpModal] = useState(null);
  const [exp, setExp] = useState({ amount: '', notes: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [closeResult, setCloseResult] = useState(null);

  const load = () => {
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    api.get('/shifts', { params }).then(r => setRows(r.data));
  };
  useEffect(() => { load(); }, [filters]);
  useEffect(() => {
    api.get('/pos-locations').then(r => setPosList(r.data)).catch(() => {});
    if (has('shifts.manage')) api.get('/users').then(r => setUsers(r.data)).catch(() => {});
  }, []);

  const doClose = async () => {
    setError('');
    try {
      const { data } = await api.post(`/shifts/${closeModal.id}/close`, { actual_cash: Number(actualCash) });
      setCloseResult(data); setCloseModal(null); setActualCash(''); load();
    } catch (e) { setError(errMsg(e)); }
  };

  const doExpense = async () => {
    setError('');
    try {
      await api.post(`/shifts/${expModal.id}/expense`, { amount: Number(exp.amount), notes: exp.notes });
      setSuccess('تم تسجيل المصروف'); setExpModal(null); setExp({ amount: '', notes: '' }); load();
    } catch (e) { setError(errMsg(e)); }
  };

  return (
    <div>
      <PageTitle title="الشفتات ودرج النقدية" subtitle="فتح وإغلاق الشفتات ومراجعة العجز والزيادة" />
      <SuccessBox msg={success} /><ErrorBox error={!closeModal && !expModal ? error : ''} />

      {closeResult && (
        <div className={`card p-5 mb-4 border-2 ${closeResult.difference === 0 ? 'border-emerald-300' : closeResult.difference > 0 ? 'border-brand-300' : 'border-rose-300'}`}>
          <div className="text-lg font-extrabold mb-2">نتيجة إغلاق الشفت</div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-400">المتوقع</div><b className="text-xl">{fmt(closeResult.expected_cash)}</b></div>
            <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-400">الفعلي</div><b className="text-xl">{fmt(closeResult.actual_cash)}</b></div>
            <div className={`rounded-xl p-3 ${closeResult.difference === 0 ? 'bg-emerald-50' : closeResult.difference > 0 ? 'bg-brand-50' : 'bg-rose-50'}`}>
              <div className="text-xs text-slate-400">{closeResult.status}</div>
              <b className={`text-xl ${closeResult.difference < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{fmt(closeResult.difference)}</b>
            </div>
          </div>
        </div>
      )}

      <div className="card p-4 mb-4 flex flex-wrap gap-2">
        <input type="date" className="input w-44" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} />
        <input type="date" className="input w-44" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} />
        <select className="input w-52" value={filters.pos_location_id} onChange={e => setFilters({ ...filters, pos_location_id: e.target.value })}>
          <option value="">كل النقاط</option>{posList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {has('shifts.manage') && (
          <select className="input w-52" value={filters.cashier_id} onChange={e => setFilters({ ...filters, cashier_id: e.target.value })}>
            <option value="">كل الكاشيرز</option>{users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        )}
        <select className="input w-36" value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}>
          <option value="">كل الحالات</option><option value="open">مفتوح</option><option value="closed">مغلق</option>
        </select>
      </div>

      <Table head={['#', 'نقطة البيع', 'الكاشير', 'الفتح', 'الفكة', 'نقدي', 'بطاقة', 'محفظة/تحويل', 'مرتجعات', 'مصروفات', 'المتوقع', 'الفعلي', 'الفرق', 'الحالة', '']}>
        {rows.map(s => (
          <tr key={s.id}>
            <td className="td font-bold">{s.id}</td>
            <td className="td">{s.pos_name}</td>
            <td className="td">{s.cashier_name}</td>
            <td className="td text-slate-500">{s.opened_at}</td>
            <td className="td">{fmt(s.opening_cash)}</td>
            <td className="td text-emerald-700 font-semibold">{fmt(s.cash_sales)}</td>
            <td className="td">{fmt(s.card_sales)}</td>
            <td className="td">{fmt(s.wallet_sales + s.transfer_sales)}</td>
            <td className="td text-rose-600">{fmt(s.refunds)}</td>
            <td className="td text-rose-600">{fmt(s.expenses)}</td>
            <td className="td">{s.expected_cash != null ? fmt(s.expected_cash) : '—'}</td>
            <td className="td">{s.actual_cash != null ? fmt(s.actual_cash) : '—'}</td>
            <td className={`td font-extrabold ${s.difference > 0 ? 'text-brand-600' : s.difference < 0 ? 'text-rose-600' : ''}`}>{s.difference != null ? fmt(s.difference) : '—'}</td>
            <td className="td">{s.status === 'open' ? <Badge color="green">مفتوح</Badge> : <Badge color="slate">مغلق</Badge>}</td>
            <td className="td">
              <div className="flex gap-1">
                <button className="btn-ghost !px-2 !py-1" onClick={async () => setDetail((await api.get(`/shifts/${s.id}`)).data)}><Icon name="eye" size={15} className="inline-block align-[-2px]" /></button>
                {s.status === 'open' && has('expenses.manage') && <button className="btn-ghost !px-2 !py-1" title="مصروف" onClick={() => { setExpModal(s); setError(''); }}><Icon name="moneyDown" size={15} className="inline-block align-[-2px]" /></button>}
                {s.status === 'open' && has('shifts.close') && <button className="btn-danger !px-2.5 !py-1" onClick={() => { setCloseModal(s); setError(''); setCloseResult(null); }}>إغلاق</button>}
              </div>
            </td>
          </tr>
        ))}
      </Table>

      {/* تفاصيل */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={` شفت #${detail?.id} — ${detail?.cashier_name}`} wide>
        {detail && (
          <div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm mb-3">
              <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-400">نقطة البيع</div><b>{detail.pos_name}</b></div>
              <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-400">الفتح</div><b>{detail.opened_at}</b></div>
              <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-400">الإغلاق</div><b>{detail.closed_at || '—'}</b></div>
              <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-400">الفواتير</div><b>{detail.invoices_count}</b></div>
            </div>
            <Table head={['الوقت', 'النوع', 'الطريقة', 'المبلغ', 'البيان']}>
              {detail.movements.map(m => (
                <tr key={m.id}>
                  <td className="td text-slate-500">{m.created_at}</td>
                  <td className="td"><Badge color={m.type === 'sale' ? 'green' : 'red'}>{CM_AR[m.type]}</Badge></td>
                  <td className="td">{PAY_AR[m.payment_method]}</td>
                  <td className="td font-bold">{fmt(m.amount)}</td>
                  <td className="td text-slate-500">{m.notes}</td>
                </tr>
              ))}
            </Table>
          </div>
        )}
      </Modal>

      {/* إغلاق */}
      <Modal open={!!closeModal} onClose={() => setCloseModal(null)} title={` إغلاق شفت #${closeModal?.id}`}>
        <ErrorBox error={error} />
        {closeModal && (
          <div className="space-y-3 text-sm">
            <div className="rounded-xl bg-slate-50 p-3 space-y-1">
              <div className="flex justify-between"><span>الفكة الافتتاحية</span><b>{fmt(closeModal.opening_cash)}</b></div>
              <div className="flex justify-between"><span>+ مبيعات نقدية</span><b className="text-emerald-700">{fmt(closeModal.cash_sales)}</b></div>
              <div className="flex justify-between"><span>− مرتجعات</span><b className="text-rose-600">{fmt(closeModal.refunds)}</b></div>
              <div className="flex justify-between"><span>− مصروفات</span><b className="text-rose-600">{fmt(closeModal.expenses)}</b></div>
              <div className="flex justify-between border-t pt-1 text-base"><span>النقدية المتوقعة</span><b className="text-brand-700">{fmt(closeModal.opening_cash + closeModal.cash_sales - closeModal.refunds - closeModal.expenses)}</b></div>
            </div>
            <Field label="النقدية الفعلية في الدرج *">
              <input autoFocus type="number" min="0" className="input !text-xl text-center font-bold" value={actualCash} onChange={e => setActualCash(e.target.value)} />
            </Field>
            <button onClick={doClose} className="btn-danger w-full !py-3"><Icon name="lock" size={15} className="inline-block align-[-2px]" /> إغلاق الشفت</button>
          </div>
        )}
      </Modal>

      {/* مصروف */}
      <Modal open={!!expModal} onClose={() => setExpModal(null)} title={` مصروف نقدي — شفت #${expModal?.id}`}>
        <ErrorBox error={error} />
        <div className="space-y-3">
          <Field label="المبلغ *"><input type="number" min="0.01" className="input text-center font-bold" value={exp.amount} onChange={e => setExp({ ...exp, amount: e.target.value })} /></Field>
          <Field label="البيان *"><input className="input" value={exp.notes} onChange={e => setExp({ ...exp, notes: e.target.value })} placeholder="مثال: أدوات نظافة" /></Field>
        </div>
        <button onClick={doExpense} className="btn-primary w-full mt-4 !py-3">تسجيل المصروف</button>
      </Modal>
    </div>
  );
}
