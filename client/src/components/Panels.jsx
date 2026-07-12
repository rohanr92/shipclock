import React, { useEffect, useState } from 'react';
import { ChannelBadge } from './Bits.jsx';
import { api, fmtDate } from '../lib.js';

export function MissingView({ missing }) {
  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <div className="font-display text-sm font-semibold">On Mirakl, not in Shopify</div>
        <p className="mt-0.5 text-xs text-muted">
          Active marketplace orders whose Mirakl order ID doesn't match any imported Shopify order. Usually means the import bridge missed them.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              {['Mirakl order ID', 'Marketplace', 'State', 'Product', 'Placed', 'Last alerted'].map((h) => (
                <th key={h} className="eyebrow px-4 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {missing.map((m) => (
              <tr key={m.miraklOrderId} className="border-b border-line/60 align-top">
                <td className="px-4 py-3 font-mono text-xs font-semibold">{m.miraklOrderId}</td>
                <td className="px-4 py-3"><ChannelBadge channel={m.channel} label={m.channelLabel} /></td>
                <td className="px-4 py-3 font-mono text-xs">{m.state}</td>
                <td className="px-4 py-3">
                  {m.products.map((p, i) => (
                    <div key={i}>{p.title} <span className="text-muted">× {p.qty}</span></div>
                  ))}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">{fmtDate(m.createdDate)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">{m.lastAlertAt ? fmtDate(m.lastAlertAt) : 'Not yet'}</td>
              </tr>
            ))}
            {missing.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-muted">Every active Mirakl order is matched in Shopify. ✓</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AlertsView() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    api('/alerts').then(setRows).catch(() => {});
  }, []);
  const tone = { OVERDUE: 'text-bad', AT_RISK: 'text-warn', CARRIER_DELAYED: 'text-warn', MISSING_IN_SHOPIFY: 'text-[#5B21B6]' };
  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-line px-4 py-3 font-display text-sm font-semibold">Email alert log</div>
      <div className="divide-y divide-line/60">
        {rows.map((a) => (
          <div key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
            <span className={`font-mono text-[11px] font-semibold ${tone[a.type] || ''}`}>{a.type.replace(/_/g, ' ')}</span>
            <span>{a.summary}</span>
            <span className="ml-auto font-mono text-[11px] text-muted">{fmtDate(a.sent_at)} → {a.recipients}</span>
          </div>
        ))}
        {rows.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted">No alerts sent yet.</div>}
      </div>
    </div>
  );
}

function TeamView({ user }) {
  const [users, setUsers] = useState([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [makeAdmin, setMakeAdmin] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const loadUsers = () => api('/auth/users').then(setUsers).catch(() => {});
  useEffect(() => { loadUsers(); }, []);

  const addUser = async () => {
    if (busy) return;
    setBusy(true);
    setMsg('');
    try {
      const r = await api('/auth/users', { method: 'POST', body: { email, password, isAdmin: makeAdmin } });
      setMsg(r.emailSent
        ? `Added ${email} and emailed them their sign-in details.`
        : `Added ${email}, but the email failed (${r.emailError}). Send them the password yourself.`);
      setEmail(''); setPassword(''); setMakeAdmin(false);
      loadUsers();
    } catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  };

  const removeUser = async (u) => {
    if (!window.confirm(`Remove ${u.email}? They will no longer be able to sign in.`)) return;
    try { await api(`/auth/users/${u.id}`, { method: 'DELETE' }); loadUsers(); }
    catch (e) { setMsg(e.message); }
  };

  const inputCls = 'w-full rounded-lg border border-line px-3 py-2 text-sm';
  return (
    <div className="panel mt-5 max-w-2xl p-5">
      <div className="font-display text-sm font-semibold">Team access</div>
      <p className="mt-0.5 text-xs text-muted">
        People who can sign in to this dashboard. New members get an email with their sign-in details.
      </p>

      <div className="mt-4 divide-y divide-line/60 rounded-lg border border-line">
        {users.map((u) => (
          <div key={u.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span>{u.email}</span>
            {u.isAdmin && <span className="chip bg-porcelain text-muted">admin</span>}
            {u.email === user.email && <span className="chip bg-porcelain text-muted">you</span>}
            {u.email !== user.email && (
              <button className="ml-auto text-xs text-bad hover:underline" onClick={() => removeUser(u)}>
                Remove
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <input className={inputCls} placeholder="new-person@email.com" type="email"
          value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className={inputCls} placeholder="Set their password (min 8 chars)" type="text"
          value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={makeAdmin} onChange={(e) => setMakeAdmin(e.target.checked)} />
        Can manage the team (admin)
      </label>
      <div className="mt-3 flex items-center gap-3">
        <button className="btn btn-dark" onClick={addUser} disabled={busy}>
          {busy ? 'Adding…' : 'Add person & email them'}
        </button>
        {msg && <span className="text-sm text-muted">{msg}</span>}
      </div>
    </div>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState('');
  const change = async () => {
    setMsg('');
    try {
      await api('/auth/change-password', { method: 'POST', body: { current, next } });
      setMsg('Password changed.');
      setCurrent(''); setNext('');
    } catch (e) { setMsg(e.message); }
  };
  const inputCls = 'w-full rounded-lg border border-line px-3 py-2 text-sm';
  return (
    <div className="panel mt-5 max-w-2xl p-5">
      <div className="font-display text-sm font-semibold">Change my password</div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <input className={inputCls} placeholder="Current password" type="password"
          value={current} onChange={(e) => setCurrent(e.target.value)} />
        <input className={inputCls} placeholder="New password (min 8 chars)" type="password"
          value={next} onChange={(e) => setNext(e.target.value)} />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button className="btn btn-ghost" onClick={change}>Change password</button>
        {msg && <span className="text-sm text-muted">{msg}</span>}
      </div>
    </div>
  );
}

export function SettingsView({ settings, onSaved, user }) {
  const [form, setForm] = useState({
    recipients: settings.recipients.join(', '),
    slaHours: settings.slaHours,
    atRiskHours: settings.atRiskHours,
    alertAtRisk: settings.alertAtRisk,
    repeatHours: settings.repeatHours,
    graceHours: settings.graceHours,
    lookbackDays: settings.lookbackDays,
    trackMirakl: settings.trackMirakl,
    whatsappEnabled: settings.whatsappEnabled,
    whatsappRecipients: (settings.whatsappRecipients || []).join(', '),
    summaryEnabled: settings.summaryEnabled,
  });
  const [msg, setMsg] = useState('');
  const [waGroups, setWaGroups] = useState(null);

  const save = async () => {
    setMsg('');
    try {
      await api('/settings', { method: 'PUT', body: { ...form, recipients: form.recipients, whatsappRecipients: form.whatsappRecipients } });
      setMsg('Saved.');
      onSaved && onSaved();
    } catch (e) { setMsg(e.message); }
  };

  const testEmail = async () => {
    setMsg('Sending test…');
    try {
      const r = await api('/test-email', { method: 'POST' });
      setMsg(`Test sent to ${r.recipients.join(', ')}`);
    } catch (e) { setMsg(`Test failed: ${e.message}`); }
  };

  const testWhatsApp = async () => {
    setMsg('Sending WhatsApp test…');
    try {
      const r = await api('/test-whatsapp', { method: 'POST' });
      setMsg(`WhatsApp test sent to ${r.recipients.join(', ')}`);
    } catch (e) { setMsg(`WhatsApp test failed: ${e.message}`); }
  };

  const sendSummaryNow = async () => {
    setMsg('Sending summary…');
    try {
      const r = await api('/send-summary-now', { method: 'POST' });
      setMsg(r.delivered ? `Summary sent (${r.open} open, ${r.overdue} overdue).` : `Not sent: ${(r.errors || []).join(' · ') || r.skipped || 'no channels configured'}`);
    } catch (e) { setMsg(`Summary failed: ${e.message}`); }
  };

  const listGroups = async () => {
    setMsg('Loading groups…');
    setWaGroups(null);
    try {
      const groups = await api('/whatsapp-groups');
      setWaGroups(groups);
      setMsg(groups.length ? 'Copy a group ID into WhatsApp recipients above, then Save.' : 'No groups found — add the linked WhatsApp number to a group first.');
    } catch (e) { setMsg(`Could not load groups: ${e.message}`); }
  };

  const Field = ({ label, children, hint }) => (
    <label className="block">
      <span className="eyebrow">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </label>
  );
  const inputCls = 'w-full rounded-lg border border-line px-3 py-2 text-sm';

  return (
    <div className="panel max-w-2xl p-5">
      <div className="grid gap-5">
        <Field label="Alert recipients" hint="Comma separated. Everyone here gets every alert email.">
          <input className={inputCls} value={form.recipients} onChange={(e) => setForm({ ...form, recipients: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="SLA (business hours)">
            <input type="number" className={inputCls} value={form.slaHours} onChange={(e) => setForm({ ...form, slaHours: e.target.value })} />
          </Field>
          <Field label="At-risk window (h)">
            <input type="number" className={inputCls} value={form.atRiskHours} onChange={(e) => setForm({ ...form, atRiskHours: e.target.value })} />
          </Field>
          <Field label="Repeat alerts every (h)">
            <input type="number" className={inputCls} value={form.repeatHours} onChange={(e) => setForm({ ...form, repeatHours: e.target.value })} />
          </Field>
          <Field label="Import grace period (h)" hint="Wait before flagging a Mirakl order missing in Shopify.">
            <input type="number" className={inputCls} value={form.graceHours} onChange={(e) => setForm({ ...form, graceHours: e.target.value })} />
          </Field>
          <Field label="Lookback (days)">
            <input type="number" className={inputCls} value={form.lookbackDays} onChange={(e) => setForm({ ...form, lookbackDays: e.target.value })} />
          </Field>
          <Field label="At-risk emails">
            <select className={inputCls} value={String(form.alertAtRisk)} onChange={(e) => setForm({ ...form, alertAtRisk: e.target.value === 'true' })}>
              <option value="true">On</option>
              <option value="false">Off (dashboard only)</option>
            </select>
          </Field>
          <Field label="Mirakl cross-check" hint="Off = only Shopify orders are tracked. No polling of Nordstrom / Macy's / Kohl's / JCPenney / Debenhams and no missing-in-Shopify alerts.">
            <select className={inputCls} value={String(form.trackMirakl)} onChange={(e) => setForm({ ...form, trackMirakl: e.target.value === 'true' })}>
              <option value="true">On</option>
              <option value="false">Off (Shopify only)</option>
            </select>
          </Field>
          <Field label="WhatsApp alerts">
            <select className={inputCls} value={String(form.whatsappEnabled)} onChange={(e) => setForm({ ...form, whatsappEnabled: e.target.value === 'true' })}>
              <option value="false">Off</option>
              <option value="true">On</option>
            </select>
          </Field>
          <Field label="Daily 8 AM summary" hint="Morning worklist (email + WhatsApp): how many to ship, which are urgent.">
            <select className={inputCls} value={String(form.summaryEnabled)} onChange={(e) => setForm({ ...form, summaryEnabled: e.target.value === 'true' })}>
              <option value="true">On</option>
              <option value="false">Off</option>
            </select>
          </Field>
        </div>
        <Field label="WhatsApp recipients" hint="Comma separated. People: phone with country code, digits only (e.g. 15551234567). Groups: group ID ending in @g.us — use the List WhatsApp groups button to find them.">
          <input className={inputCls} value={form.whatsappRecipients} onChange={(e) => setForm({ ...form, whatsappRecipients: e.target.value })} placeholder="15551234567, 120363041234567890@g.us" />
        </Field>
        {waGroups && waGroups.length > 0 && (
          <div className="rounded-lg border border-line bg-porcelain/60 p-3">
            <div className="eyebrow mb-2">Your WhatsApp groups</div>
            {waGroups.map((g) => (
              <div key={g.id} className="flex items-baseline gap-2 py-0.5 text-sm">
                <span>{g.name}</span>
                <span className="ml-auto select-all font-mono text-[11px] text-muted">{g.id}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn btn-dark" onClick={save}>Save settings</button>
          <button className="btn btn-ghost" onClick={testEmail}>Send test email</button>
          <button className="btn btn-ghost" onClick={testWhatsApp}>Send test WhatsApp</button>
          <button className="btn btn-ghost" onClick={listGroups}>List WhatsApp groups</button>
          <button className="btn btn-ghost" onClick={sendSummaryNow}>Send summary now</button>
          {msg && <span className="text-sm text-muted">{msg}</span>}
        </div>
      </div>
    </div>
  );
}

export function SettingsTab({ settings, onSaved, user }) {
  return (
    <>
      <SettingsView settings={settings} onSaved={onSaved} user={user} />
      {user?.isAdmin && <TeamView user={user} />}
      <ChangePassword />
    </>
  );
}
