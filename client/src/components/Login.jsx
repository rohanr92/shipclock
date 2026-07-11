import React, { useState } from 'react';
import { api, setToken } from '../lib.js';

export default function Login({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email || !password || busy) return;
    setBusy(true);
    setErr('');
    try {
      const r = await api('/auth/login', { method: 'POST', body: { email, password } });
      setToken(r.token);
      onSignedIn({ email: r.email, isAdmin: r.isAdmin });
    } catch (e) {
      setErr(e.unauthorized ? 'Wrong email or password' : e.message);
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e) => { if (e.key === 'Enter') submit(); };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="panel w-full max-w-sm p-7">
        <div className="mb-1 font-display text-xl font-extrabold uppercase tracking-[0.14em]">
          Ship<span className="text-muted">Clock</span>
        </div>
        <p className="mb-6 text-xs text-muted">48 business-hour ship SLA · sign in to continue</p>

        <label className="block">
          <span className="eyebrow">Email</span>
          <input
            className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
            type="email" autoComplete="username" value={email}
            onChange={(e) => setEmail(e.target.value)} onKeyDown={onKey} autoFocus
          />
        </label>
        <label className="mt-4 block">
          <span className="eyebrow">Password</span>
          <input
            className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
            type="password" autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)} onKeyDown={onKey}
          />
        </label>

        {err && <p className="mt-3 text-sm text-bad">{err}</p>}

        <button className="btn btn-dark mt-5 w-full justify-center" onClick={submit} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
    </div>
  );
}
