import React, { FormEvent, useEffect, useState } from 'react';
import { Brain, LoaderCircle, LockKeyhole } from 'lucide-react';

type AuthState = 'checking' | 'anonymous' | 'authenticated';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/auth/session', { credentials: 'same-origin', signal: controller.signal })
      .then((response) => setAuthState(response.ok ? 'authenticated' : 'anonymous'))
      .catch((cause) => {
        if (cause?.name !== 'AbortError') setAuthState('anonymous');
      });
    return () => controller.abort();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error || '登录失败，请稍后重试');
        return;
      }
      setPassword('');
      setAuthState('authenticated');
    } catch {
      setError('无法连接服务器，请确认后端已启动');
    } finally {
      setSubmitting(false);
    }
  };

  if (authState === 'authenticated') return <>{children}</>;

  if (authState === 'checking') {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-slate-950 text-slate-200">
        <LoaderCircle className="h-7 w-7 animate-spin" aria-label="正在验证登录状态" />
      </div>
    );
  }

  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-slate-950 px-5 py-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.22),_transparent_48%)]" />
      <section className="relative w-full max-w-sm rounded-3xl border border-white/10 bg-white/[0.06] p-7 shadow-2xl backdrop-blur-xl sm:p-9">
        <div className="mb-8 flex items-center gap-3 text-white">
          <span className="rounded-2xl bg-blue-500/20 p-3 ring-1 ring-blue-400/30"><Brain className="h-7 w-7 text-blue-300" /></span>
          <div><p className="text-xs font-medium uppercase tracking-[0.24em] text-blue-300">NMDD</p><h1 className="text-xl font-semibold">身份验证</h1></div>
        </div>
        <form className="space-y-5" onSubmit={submit}>
          <label className="block text-sm text-slate-300">账号
            <input autoComplete="username" autoFocus value={username} onChange={(event) => setUsername(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3 text-white outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20" required />
          </label>
          <label className="block text-sm text-slate-300">密码
            <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3 text-white outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20" required />
          </label>
          {error && <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-sm text-red-200">{error}</p>}
          <button disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-3 font-medium text-white transition hover:bg-blue-400 disabled:cursor-wait disabled:opacity-60">
            {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
            {submitting ? '验证中…' : '登录'}
          </button>
        </form>
      </section>
    </main>
  );
}
