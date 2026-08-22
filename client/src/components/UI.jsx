export function PageTitle({ title, subtitle, children }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-800">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative card w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto p-5`}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-extrabold">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }) {
  return <div><label className="label">{label}</label>{children}</div>;
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="mb-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 px-4 py-2.5 text-sm font-semibold">{error}</div>;
}

export function SuccessBox({ msg }) {
  if (!msg) return null;
  return <div className="mb-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-2.5 text-sm font-semibold">{msg}</div>;
}

export function Table({ head, children, empty = 'لا توجد بيانات' }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full">
        <thead><tr className="bg-slate-50">{head.map((h, i) => <th key={i} className="th">{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
      {!children?.length && <div className="py-10 text-center text-slate-400 text-sm">{empty}</div>}
    </div>
  );
}

export function Badge({ color = 'slate', children }) {
  const colors = {
    slate: 'bg-slate-100 text-slate-600', green: 'bg-emerald-100 text-emerald-700',
    red: 'bg-rose-100 text-rose-700', amber: 'bg-amber-100 text-amber-700',
    blue: 'bg-brand-100 text-brand-700', violet: 'bg-violet-100 text-violet-700',
  };
  return <span className={`badge ${colors[color]}`}>{children}</span>;
}
