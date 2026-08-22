import { useEffect, useState } from 'react';
import api, { fmt } from '../api.js';
import { useAuth } from '../App.jsx';
import { PageTitle } from '../components/UI.jsx';

const PERIODS = [['today', 'اليوم'], ['yesterday', 'أمس'], ['week', 'هذا الأسبوع'], ['month', 'هذا الشهر']];

function Stat({ title, value, icon, tone = 'blue', sub }) {
  const tones = {
    blue: 'from-brand-500 to-brand-700', green: 'from-emerald-500 to-emerald-700',
    amber: 'from-amber-500 to-orange-600', rose: 'from-rose-500 to-rose-700',
    violet: 'from-violet-500 to-violet-700', slate: 'from-slate-500 to-slate-700',
  };
  return (
    <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${tones[tone]} p-5 text-white shadow-lg`}>
      <div className="text-3xl absolute left-4 top-4 opacity-30">{icon}</div>
      <div className="text-sm font-semibold opacity-90">{title}</div>
      <div className="mt-2 text-3xl font-extrabold tracking-tight">{value}</div>
      {sub && <div className="mt-1 text-xs opacity-80">{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const { has } = useAuth();
  const [period, setPeriod] = useState('today');
  const [d, setD] = useState(null);

  useEffect(() => {
    api.get('/dashboard', { params: { period } }).then(r => setD(r.data)).catch(() => {});
  }, [period]);

  if (!d) return <div className="py-20 text-center text-slate-400">جارٍ التحميل…</div>;

  return (
    <div>
      <PageTitle title="لوحة التحكم" subtitle="نظرة شاملة على أداء المحلات">
        <div className="flex gap-1.5 rounded-xl bg-white p-1 shadow-sm border border-slate-200">
          {PERIODS.map(([k, l]) => (
            <button key={k} onClick={() => setPeriod(k)}
              className={`rounded-lg px-4 py-1.5 text-sm font-bold transition ${period === k ? 'bg-brand-600 text-white shadow' : 'text-slate-500 hover:bg-slate-100'}`}>{l}</button>
          ))}
        </div>
      </PageTitle>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
        <Stat title="مبيعات اليوم" value={fmt(d.today.total)} icon="💵" sub={`${d.today.cnt} فاتورة`} />
        <Stat title="مبيعات الشهر" value={fmt(d.month_total)} icon="🗓️" tone="violet" />
        <Stat title={`مبيعات الفترة`} value={fmt(d.sales.total)} icon="📈" tone="green" sub={`متوسط الفاتورة: ${fmt(d.sales.avg_invoice)}`} />
        <Stat title="عدد الفواتير" value={fmt(d.sales.cnt)} icon="🧾" tone="slate" />
        {has('profit.view') && <Stat title="إجمالي الربح" value={fmt(d.gross_profit)} icon="💰" tone="amber" />}
        <Stat title="المرتجعات" value={fmt(d.returns.total)} icon="↩️" tone="rose" sub={`${d.returns.cnt} عملية`} />
        <Stat title="الخصومات" value={fmt(d.sales.discounts)} icon="🏷️" tone="slate" />
        <Stat title="النقدية في الأدراج المفتوحة" value={fmt(d.cash_in_open_drawers)} icon="🗄️" tone="blue" />
        {has('cost.view') && <Stat title="قيمة المخزون (تكلفة)" value={fmt(d.inventory_cost_value)} icon="📦" tone="violet" />}
        {has('cost.view') && <Stat title="قيمة المخزون (بيع)" value={fmt(d.inventory_selling_value)} icon="🏪" tone="green" />}
        <Stat title="أصناف نافدة" value={fmt(d.out_of_stock_variants)} icon="⚠️" tone="rose" />
      </div>

      <div className="mt-6 grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        <div className="card p-5">
          <h3 className="font-extrabold mb-3">المبيعات حسب نقطة البيع</h3>
          <div className="space-y-2">
            {d.by_pos.map((p, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                <span className="text-sm font-semibold">{p.name}</span>
                <span className="text-sm font-extrabold text-brand-700">{fmt(p.total)} <span className="text-xs text-slate-400">({p.cnt})</span></span>
              </div>
            ))}
            {!d.by_pos.length && <div className="text-sm text-slate-400 text-center py-4">لا مبيعات في الفترة</div>}
          </div>
        </div>
        <div className="card p-5">
          <h3 className="font-extrabold mb-3">أفضل الكاشيرز</h3>
          <div className="space-y-2">
            {d.by_cashier.map((c, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                <span className="text-sm font-semibold">{i + 1}. {c.name}</span>
                <span className="text-sm font-extrabold text-emerald-700">{fmt(c.total)} <span className="text-xs text-slate-400">({c.cnt})</span></span>
              </div>
            ))}
            {!d.by_cashier.length && <div className="text-sm text-slate-400 text-center py-4">لا مبيعات في الفترة</div>}
          </div>
        </div>
        <div className="card p-5">
          <h3 className="font-extrabold mb-3">الأكثر مبيعًا</h3>
          <div className="space-y-2">
            {d.top_products.slice(0, 8).map((p, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                <span className="text-sm font-semibold truncate">{p.product_name}</span>
                <span className="text-sm font-extrabold text-violet-700">{fmt(p.qty)} قطعة</span>
              </div>
            ))}
            {!d.top_products.length && <div className="text-sm text-slate-400 text-center py-4">لا مبيعات في الفترة</div>}
          </div>
        </div>
      </div>

      <div className="card p-5 mt-4">
        <h3 className="font-extrabold mb-3">⚠️ أصناف منخفضة المخزون</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="bg-slate-50">{['المنتج', 'SKU', 'الموقع', 'الرصيد', 'حد الطلب'].map(h => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>
              {d.low_stock.map((r, i) => (
                <tr key={i}>
                  <td className="td font-semibold">{r.product_name} <span className="text-xs text-slate-400">{r.size} / {r.color}</span></td>
                  <td className="td text-slate-500">{r.sku}</td>
                  <td className="td">{r.location_name}</td>
                  <td className="td"><span className="badge bg-rose-100 text-rose-700">{fmt(r.quantity)}</span></td>
                  <td className="td text-slate-500">{fmt(r.min_stock)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!d.low_stock.length && <div className="py-6 text-center text-sm text-slate-400">لا توجد أصناف منخفضة المخزون 🎉</div>}
        </div>
      </div>
    </div>
  );
}
