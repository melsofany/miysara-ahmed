import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../App.jsx';

const NAV = [
  { to: '/', label: 'لوحة التحكم', icon: '📊', perm: 'dashboard.view' },
  { to: '/pos', label: 'نقطة البيع', icon: '🛒', perm: 'pos.sell' },
  { to: '/invoices', label: 'الفواتير', icon: '🧾', perm: 'invoices.view' },
  { to: '/returns', label: 'المرتجعات', icon: '↩️', perm: 'returns.view' },
  { to: '/shifts', label: 'الشفتات', icon: '💰', perm: 'shifts.open' },
  { to: '/inventory', label: 'المخزون', icon: '📦', perm: 'inventory.view' },
  { to: '/products', label: 'المنتجات', icon: '👕', perm: 'products.view' },
  { to: '/master-data', label: 'البيانات الأساسية', icon: '🗂️', perm: 'catalog.manage' },
  { to: '/reports', label: 'التقارير', icon: '📈', perm: 'reports.view' },
  { to: '/users', label: 'المستخدمون', icon: '👥', perm: 'users.manage' },
  { to: '/settings', label: 'الإعدادات', icon: '⚙️', perm: 'settings.manage' },
];

export default function Layout() {
  const { user, logout, has } = useAuth();
  const [open, setOpen] = useState(false);
  const items = NAV.filter(n => has(n.perm) || (n.to === '/shifts' && (has('shifts.close') || has('shifts.manage'))));

  return (
    <div className="min-h-screen lg:flex">
      {/* شريط علوي للموبايل */}
      <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between bg-brand-900 text-white px-4 py-3 shadow">
        <button onClick={() => setOpen(!open)} className="text-2xl leading-none">☰</button>
        <div className="font-extrabold">ميسرة أحمد</div>
        <div className="text-xs opacity-80">{user?.full_name}</div>
      </header>

      {/* القائمة الجانبية */}
      <aside className={`${open ? 'translate-x-0' : 'translate-x-full'} lg:translate-x-0 transition-transform duration-200 fixed lg:static inset-y-0 right-0 z-40 w-64 bg-brand-950 text-white flex flex-col`}>
        <div className="px-5 py-6 border-b border-white/10">
          <div className="text-xl font-extrabold tracking-wide">ميسرة أحمد</div>
          <div className="text-[11px] text-brand-300 font-semibold mt-0.5">MIYSARA AHMED — نظام إدارة محلات الملابس</div>
        </div>
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {items.map(n => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} onClick={() => setOpen(false)}
              className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition ${isActive ? 'bg-brand-600 text-white shadow' : 'text-brand-100/80 hover:bg-white/10'}`}>
              <span className="text-lg">{n.icon}</span>{n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 p-4">
          <div className="text-sm font-bold">{user?.full_name}</div>
          <div className="text-xs text-brand-300">{user?.role_name_ar}</div>
          <button onClick={logout} className="mt-3 w-full rounded-xl bg-white/10 hover:bg-white/20 py-2 text-sm font-bold transition">تسجيل الخروج</button>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}

      <main className="flex-1 min-w-0 p-4 lg:p-6 max-w-[1600px] mx-auto w-full">
        <Outlet />
      </main>
    </div>
  );
}
