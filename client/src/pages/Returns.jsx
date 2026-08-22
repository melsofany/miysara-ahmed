import { useEffect, useState } from 'react';
import api, { fmt } from '../api.js';
import { PageTitle, Table, Badge, Modal } from '../components/UI.jsx';

export default function Returns() {
  const [rows, setRows] = useState([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [num, setNum] = useState('');
  const [detail, setDetail] = useState(null);

  const load = () => {
    const params = {};
    if (from) params.from = from;
    if (to) params.to = to;
    if (num) params.invoice_number = num;
    api.get('/returns', { params }).then(r => setRows(r.data));
  };
  useEffect(() => { load(); }, [from, to, num]);

  return (
    <div>
      <PageTitle title="المرتجعات" subtitle="مرتجعات المبيعات المرتبطة بالفواتير الأصلية" />
      <div className="card p-4 mb-4 flex flex-wrap gap-3">
        <input className="input w-52" placeholder="رقم الفاتورة" value={num} onChange={e => setNum(e.target.value)} />
        <input type="date" className="input w-44" value={from} onChange={e => setFrom(e.target.value)} />
        <input type="date" className="input w-44" value={to} onChange={e => setTo(e.target.value)} />
      </div>
      <Table head={['رقم المرتجع', 'الفاتورة', 'التاريخ', 'النوع', 'نقطة البيع', 'نفّذه', 'المسترد', 'السبب', '']}>
        {rows.map(r => (
          <tr key={r.id}>
            <td className="td font-bold text-violet-700">{r.return_number}</td>
            <td className="td text-brand-700 font-semibold">{r.inv_no}</td>
            <td className="td text-slate-500">{r.created_at}</td>
            <td className="td"><Badge color={r.return_type === 'full' ? 'violet' : 'blue'}>{r.return_type === 'full' ? 'كلي' : 'جزئي'}</Badge></td>
            <td className="td">{r.pos_name}</td>
            <td className="td">{r.user_name}</td>
            <td className="td font-extrabold text-rose-600">{fmt(r.total_refund)}</td>
            <td className="td text-slate-500 max-w-[200px] truncate">{r.reason}</td>
            <td className="td"><button className="btn-ghost !px-2 !py-1" onClick={async () => setDetail((await api.get(`/returns/${r.id}`)).data)}>👁</button></td>
          </tr>
        ))}
      </Table>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={`↩️ مرتجع ${detail?.return_number}`}>
        {detail && (
          <div>
            <div className="text-sm mb-3 text-slate-500">فاتورة <b className="text-brand-700">{detail.inv_no}</b> — {detail.created_at} — نفّذه: <b>{detail.user_name}</b></div>
            <Table head={['المنتج', 'الكمية', 'السعر', 'الإجمالي']}>
              {detail.items.map(it => (
                <tr key={it.id}>
                  <td className="td font-semibold">{it.product_name} <span className="text-xs text-slate-400">{it.size}/{it.color}</span></td>
                  <td className="td">{fmt(it.quantity)}</td>
                  <td className="td">{fmt(it.unit_price)}</td>
                  <td className="td font-bold">{fmt(it.total)}</td>
                </tr>
              ))}
            </Table>
            <div className="mt-3 text-start text-sm">إجمالي المسترد: <b className="text-rose-600 text-lg">{fmt(detail.total_refund)}</b> — السبب: {detail.reason}</div>
          </div>
        )}
      </Modal>
    </div>
  );
}
