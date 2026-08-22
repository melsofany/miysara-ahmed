import { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import api, { fmt } from '../api.js';
import { useAuth } from '../App.jsx';
import { PageTitle, Table } from '../components/UI.jsx';

const TABS = [
  { key: 'sales', label: 'المبيعات', groups: [['day', 'يومي'], ['month', 'شهري'], ['pos', 'حسب نقطة البيع'], ['cashier', 'حسب الكاشير'], ['product', 'حسب المنتج'], ['category', 'حسب التصنيف'], ['supplier', 'حسب المورد'], ['season', 'حسب الموسم']] },
  { key: 'inventory', label: 'المخزون', types: [['current', 'الحالي'], ['valuation', 'تقييم المخزون'], ['low', 'منخفض المخزون'], ['out', 'نافد'], ['slow', 'بطيء الحركة'], ['best', 'الأكثر مبيعًا'], ['transfers', 'التحويلات']] },
  { key: 'profit', label: 'الأرباح', perm: 'profit.view', groups: [['product', 'حسب المنتج'], ['pos', 'حسب نقطة البيع'], ['period', 'حسب اليوم']] },
  { key: 'cashiers', label: 'الكاشيرز' },
];

function exportCsv(name, rows) {
  if (!rows?.length) return;
  const cols = Object.keys(rows[0]);
  const csv = [cols.join(','), ...rows.map(r => cols.map(c => `"${String(r[c] ?? '').replaceAll('"', '""')}"`).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${name}.csv`; a.click();
}

export default function Reports() {
  const { has } = useAuth();
  const tabs = TABS.filter(t => !t.perm || has(t.perm));
  const [tab, setTab] = useState(tabs[0]?.key || 'sales');
  const [group, setGroup] = useState('day');
  const [invType, setInvType] = useState('current');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState([]);
  const [cols, setCols] = useState([]);

  useEffect(() => {
    const params = {};
    if (from) params.from = from;
    if (to) params.to = to;
    let url = '';
    if (tab === 'sales') { url = '/reports/sales'; params.group_by = group; }
    else if (tab === 'inventory') { url = '/reports/inventory'; params.type = invType; }
    else if (tab === 'profit') { url = '/reports/profit'; params.group_by = group; }
    else url = '/reports/cashiers';
    api.get(url, { params }).then(r => {
      setRows(r.data);
      setCols(r.data[0] ? Object.keys(r.data[0]) : []);
    }).catch(() => setRows([]));
  }, [tab, group, invType, from, to]);

  const HEAD_AR = {
    label: 'البند', total: 'الإجمالي', qty: 'الكمية', invoices: 'الفواتير', revenue: 'الإيراد', cost: 'التكلفة',
    profit: 'الربح', margin: 'الهامش %', cashier: 'الكاشير', pos_name: 'نقطة البيع', sales: 'المبيعات', shifts: 'الشفتات',
    expected_cash: 'النقدية المتوقعة', actual_cash: 'الفعلية', difference: 'الفرق', product_name: 'المنتج', sku: 'SKU',
    barcode: 'باركود', size: 'المقاس', color: 'اللون', quantity: 'الرصيد', avg_cost: 'متوسط التكلفة', selling_price: 'سعر البيع',
    location_name: 'الموقع', cost_value: 'قيمة التكلفة', selling_value: 'قيمة البيع', min_stock: 'حد الطلب', sold_qty: 'المبيع',
    stock: 'المخزون', movement_number: 'الحركة', created_at: 'التاريخ', movement_type: 'النوع', cost_price: 'التكلفة',
    source_name: 'المصدر', dest_name: 'الوجهة', user_name: 'المستخدم', document_number: 'المستند',
  };
  const isNum = (k) => ['total', 'qty', 'invoices', 'revenue', 'cost', 'profit', 'sales', 'shifts', 'expected_cash', 'actual_cash', 'difference', 'quantity', 'avg_cost', 'selling_price', 'cost_value', 'selling_value', 'sold_qty', 'stock', 'min_stock', 'cost_price'].includes(k);

  return (
    <div>
      <PageTitle title="التقارير" subtitle="مبيعات • مخزون • أرباح • كاشيرز">
        {has('reports.export') && <button className="btn-secondary" onClick={() => exportCsv(`report-${tab}`, rows)}><Icon name="download" size={15} className="inline-block align-[-2px]" /> تصدير Excel/CSV</button>}
        <button className="btn-secondary" onClick={() => window.print()}><Icon name="print" size={15} className="inline-block align-[-2px]" /> طباعة / PDF</button>
      </PageTitle>

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`rounded-xl px-4 py-2 text-sm font-bold transition ${tab === t.key ? 'bg-brand-600 text-white shadow' : 'bg-white border border-slate-200 text-slate-600'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="card p-4 mb-4 flex flex-wrap gap-2 items-end">
        <div><label className="label">من</label><input type="date" className="input w-44" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div><label className="label">إلى</label><input type="date" className="input w-44" value={to} onChange={e => setTo(e.target.value)} /></div>
        {tab === 'sales' && (
          <div><label className="label">التجميع</label>
            <select className="input w-48" value={group} onChange={e => setGroup(e.target.value)}>{tabs.find(t => t.key === 'sales').groups.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        )}
        {tab === 'profit' && (
          <div><label className="label">التجميع</label>
            <select className="input w-48" value={group} onChange={e => setGroup(e.target.value)}>{tabs.find(t => t.key === 'profit').groups.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        )}
        {tab === 'inventory' && (
          <div><label className="label">نوع التقرير</label>
            <select className="input w-48" value={invType} onChange={e => setInvType(e.target.value)}>{tabs.find(t => t.key === 'inventory').types.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        )}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead><tr className="bg-slate-50">{cols.map(c => <th key={c} className="th">{HEAD_AR[c] || c}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {cols.map(c => (
                  <td key={c} className={`td ${isNum(c) ? 'font-semibold' : ''}`}>
                    {isNum(c) ? fmt(r[c]) : (c === 'margin' ? `${r[c]}%` : String(r[c] ?? '—'))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="py-10 text-center text-slate-400 text-sm">لا بيانات في الفترة المحددة</div>}
      </div>
    </div>
  );
}
