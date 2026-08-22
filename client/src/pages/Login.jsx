import { useState } from 'react';
import Icon from '../components/Icon.jsx';
import api, { errMsg } from '../api.js';
import { useAuth } from '../App.jsx';
import { ErrorBox } from '../components/UI.jsx';

export default function Login() {
  const { login } = useAuth();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const { data } = await api.post('/auth/login', form);
      login(data.token, data.user);
    } catch (e2) { setError(errMsg(e2)); }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-950 via-brand-900 to-brand-700 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex h-20 w-20 items-center justify-center rounded-3xl bg-white/10 backdrop-blur text-4xl shadow-xl mb-4"><Icon name="shirt" size={40} /></div>
          <h1 className="text-3xl font-extrabold text-white">ميسرة أحمد</h1>
          <p className="text-brand-200 text-sm font-semibold mt-1">MIYSARA Ahmed — نظام إدارة محلات الملابس</p>
        </div>
        <form onSubmit={submit} className="card p-7 shadow-2xl">
          <ErrorBox error={error} />
          <div className="space-y-4">
            <div>
              <label className="label">اسم المستخدم</label>
              <input autoFocus className="input" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} placeholder="admin" />
            </div>
            <div>
              <label className="label">كلمة المرور</label>
              <input type="password" className="input" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="••••••••" />
            </div>
            <button disabled={loading} className="btn-primary w-full !py-3 text-base">
              {loading ? 'جارٍ تسجيل الدخول…' : 'تسجيل الدخول'}
            </button>
          </div>
        </form>
        <p className="text-center text-brand-200/70 text-xs mt-6">نظام متكامل: مخازن • نقاط بيع • فواتير • تقارير</p>
      </div>
    </div>
  );
}
