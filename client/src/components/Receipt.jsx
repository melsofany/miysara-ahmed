import { fmt } from '../api.js';

const PAY_AR = { cash: 'نقدي', card: 'بطاقة', bank_transfer: 'تحويل بنكي', wallet: 'محفظة إلكترونية' };

export default function Receipt({ data }) {
  const { store_name, receipt_footer, invoice: inv } = data;
  return (
    <div id="receipt" dir="rtl" className="mx-auto w-[280px] bg-white p-3 text-[12px] font-mono leading-relaxed text-black">
      <div className="text-center">
        <div className="text-base font-extrabold">{store_name}</div>
        <div>{inv.pos_name}</div>
        <div className="border-b border-dashed border-black my-1.5" />
        <div>فاتورة: {inv.invoice_number}</div>
        <div>{inv.created_at}</div>
        <div>الكاشير: {inv.cashier_name}</div>
        <div className="border-b border-dashed border-black my-1.5" />
      </div>
      <table className="w-full">
        <thead>
          <tr className="border-b border-dashed border-black">
            <th className="text-start">الصنف</th><th>كمية</th><th>سعر</th><th>إجمالي</th>
          </tr>
        </thead>
        <tbody>
          {inv.items.map((it, i) => (
            <tr key={i}>
              <td className="text-start">{it.product_name}<br /><span className="text-[10px]">{it.size} / {it.color}</span></td>
              <td className="text-center">{fmt(it.quantity)}</td>
              <td className="text-center">{fmt(it.unit_price)}</td>
              <td className="text-center">{fmt(it.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-b border-dashed border-black my-1.5" />
      <div className="flex justify-between"><span>الإجمالي الفرعي</span><span>{fmt(inv.subtotal)}</span></div>
      <div className="flex justify-between"><span>الخصم</span><span>{fmt(inv.discount)}</span></div>
      <div className="flex justify-between text-sm font-extrabold"><span>الإجمالي</span><span>{fmt(inv.total)}</span></div>
      <div className="flex justify-between"><span>طريقة الدفع</span><span>{PAY_AR[inv.payment_method]}</span></div>
      <div className="flex justify-between"><span>المدفوع</span><span>{fmt(inv.paid_amount)}</span></div>
      <div className="flex justify-between"><span>الباقي</span><span>{fmt(inv.change_amount)}</span></div>
      <div className="border-b border-dashed border-black my-1.5" />
      <div className="text-center">{receipt_footer}</div>
    </div>
  );
}
