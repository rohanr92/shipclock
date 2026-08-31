import React, { useCallback, useEffect, useState } from 'react';
import { api, fmtDate, getToken, setToken } from './lib.js';
import { KpiStrip, OrdersTable } from './components/Orders.jsx';
import { MissingView, AlertsView, SettingsTab } from './components/Panels.jsx';
import Login from './components/Login.jsx';
import ScorecardView from './components/Scorecard.jsx';

const TABS = [
  { id: 'orders', label: 'Orders' },
  { id: 'missing', label: 'Missing in Shopify' },
  { id: 'scorecard', label: 'Scorecard' },
  { id: 'alerts', label: 'Alert log' },
  { id: 'settings', label: 'Settings' },
];

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = checking, null = signed out
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('orders');
  const [ordersFilter, setOrdersFilter] = useState('open');
  const [syncing, setSyncing] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api('/overview'));
      setErr('');
    } catch (e) {
      if (e.unauthorized) { setToken(null); setUser(null); return; }
      setErr(e.message);
    }
  }, []);

  useEffect(() => {
    if (!getToken()) { setUser(null); return; }
    api('/auth/me').then(setUser).catch(() => { setToken(null); setUser(null); });
  }, []);

  useEffect(() => {
    if (!user) return;
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [user, load]);

  const signOut = async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    setToken(null);
    setUser(null);
    setData(null);
  };

  if (user === undefined) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted">Loading…</div>;
  }
  if (user === null) {
    return <Login onSignedIn={setUser} />;
  }

  const runNow = async () => {
    setSyncing(true);
    try {
      await api('/run-now', { method: 'POST' });
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSyncing(false);
    }
  };

  const onKpiFilter = (f) => {
    if (f === 'missing') { setTab('missing'); return; }
    setTab('orders');
    setOrdersFilter(f);
  };

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-center gap-3">
        <div>
          <div className="font-display text-xl font-extrabold uppercase tracking-[0.14em]">
            Ship<span className="text-muted">Clock</span>
          </div>
          <div className="text-xs text-muted">
            48 business-hour ship SLA · Mirakl → Shopify · weekends excluded
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {data?.lastRun && (
            <span className="hidden font-mono text-[11px] text-muted sm:inline">
              last sync {fmtDate(data.lastRun.finishedAt)} {data.lastRun.ok ? '✓' : '· with errors'}
            </span>
          )}
          <button className="btn btn-dark" onClick={runNow} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
          <button className="btn btn-ghost" onClick={signOut} title={user.email}>
            Sign out
          </button>
        </div>
      </header>

      {err && (
        <div className="mb-4 rounded-lg border border-bad/30 bg-[#FBE6E3] px-4 py-2.5 text-sm text-bad">
          {err}
        </div>
      )}
      {data?.lastRun && !data.lastRun.ok && (
        <div className="mb-4 rounded-lg border border-warn/30 bg-[#FBF0DA] px-4 py-2.5 text-xs text-warn">
          Last sync issues: {(data.lastRun.detail.errors || []).join(' · ')}
        </div>
      )}

      {!data ? (
        <div className="panel px-4 py-16 text-center text-sm text-muted">Loading…</div>
      ) : (
        <>
          <KpiStrip kpis={data.kpis} onFilter={onKpiFilter} />

          <nav className="mt-6 flex gap-1 border-b border-line">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 font-display text-[12px] font-semibold uppercase tracking-wider ${
                  tab === t.id ? 'border-b-2 border-ink text-ink' : 'text-muted hover:text-ink'
                }`}
              >
                {t.label}
                {t.id === 'missing' && data.kpis.missing > 0 && (
                  <span className="ml-1.5 rounded bg-[#EFE9FA] px-1.5 font-mono text-[10px] text-[#5B21B6]">
                    {data.kpis.missing}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <main className="mt-4">
            {tab === 'orders' && (
              <OrdersTable
                orders={data.orders}
                now={new Date(data.now).getTime()}
                initialFilter={ordersFilter}
                channels={data.channels}
              />
            )}
            {tab === 'missing' && <MissingView missing={data.missing} resolvedManually={data.missingResolvedManually || []} />}
            {tab === 'scorecard' && <ScorecardView />}
            {tab === 'alerts' && <AlertsView />}
            {tab === 'settings' && <SettingsTab settings={data.settings} onSaved={load} user={user} />}
          </main>

          <footer className="mt-8 text-center font-mono text-[11px] text-muted">
            Marketplaces watching: {data.platformsConfigured.length ? data.platformsConfigured.join(' · ') : 'none configured — add Mirakl keys in .env'} · timezone {data.tz}
          </footer>
        </>
      )}
    </div>
  );
}
