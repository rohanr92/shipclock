async function manualAction(path, body, confirmText) {
  if (confirmText && !window.confirm(confirmText)) return;
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('shipclock_token') || ''}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let m = `HTTP ${res.status}`;
    try { m = (await res.json()).error || m; } catch (e) {}
    window.alert(m);
    return;
  }
  window.location.reload();
}

import React, { useMemo, useState } from 'react';
import { ChannelBadge, SlaChip, SlaRail } from './Bits.jsx';
import { fmtDate } from '../lib.js';

const SLA_ORDER = { overdue: 0, at_risk: 1, on_track: 2, carrier_delayed: 3, shipped_late: 4, shipped_on_time: 5 };

export function KpiStrip({ kpis, onFilter }) {
  const tiles = [
    { key: 'overdue', label: 'Overdue', value: kpis.overdue, tone: 'text-bad', filter: 'overdue' },
    { key: 'atRisk', label: 'At risk', value: kpis.atRisk, tone: 'text-warn', filter: 'at_risk' },
    { key: 'labelOnly', label: 'Label only', value: kpis.labelOnly, tone: 'text-ink', filter: 'label_created' },
    { key: 'delayed', label: 'Carrier delayed', value: kpis.delayed || 0, tone: 'text-warn', filter: 'delayed' },
    { key: 'stockIssues', label: 'No stock', value: kpis.stockIssues || 0, tone: 'text-bad', filter: 'stock' },
    { key: 'inTransit', label: 'In transit', value: kpis.inTransit, tone: 'text-good', filter: 'in_transit' },
    { key: 'missing', label: 'Missing in Shopify', value: kpis.missing, tone: 'text-[#5B21B6]', filter: 'missing' },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
      {tiles.map((t) => (
        <button
          key={t.key}
          onClick={() => onFilter(t.filter)}
          className="panel px-4 py-3 text-left transition-colors hover:border-ink"
        >
          <div className="eyebrow">{t.label}</div>
          <div className={`mt-1 font-display text-3xl font-bold tabular-nums ${t.tone}`}>{t.value}</div>
        </button>
      ))}
    </div>
  );
}

export function OrdersTable({ orders, now, initialFilter, channels }) {
  const [q, setQ] = useState('');
  const [channel, setChannel] = useState('all');
  const [status, setStatus] = useState(initialFilter || 'open');

  React.useEffect(() => {
    if (initialFilter) setStatus(initialFilter);
  }, [initialFilter]);

  const filtered = useMemo(() => {
    let rows = [...orders];
    if (status === 'open') rows = rows.filter((o) => o.shipState !== 'in_transit' && o.shipState !== 'delayed');
    else if (status === 'overdue') rows = rows.filter((o) => o.sla === 'overdue');
    else if (status === 'at_risk') rows = rows.filter((o) => o.sla === 'at_risk');
    else if (status === 'label_created') rows = rows.filter((o) => o.shipState === 'label_created');
    else if (status === 'delayed') rows = rows.filter((o) => o.shipState === 'delayed');
    else if (status === 'stock') rows = rows.filter((o) => o.stockIssue);
    else if (status === 'in_transit') rows = rows.filter((o) => o.shipState === 'in_transit');
    if (channel !== 'all') rows = rows.filter((o) => o.channel === channel);
    if (q.trim()) {
      const t = q.trim().toLowerCase();
      rows = rows.filter(
        (o) =>
          o.name.toLowerCase().includes(t) ||
          (o.miraklOrderId || '').toLowerCase().includes(t) ||
          o.products.some((p) => (p.title || '').toLowerCase().includes(t) || (p.sku || '').toLowerCase().includes(t))
      );
    }
    rows.sort((a, b) => SLA_ORDER[a.sla] - SLA_ORDER[b.sla] || a.minutesLeft - b.minutesLeft);
    return rows;
  }, [orders, q, channel, status]);

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search order, Mirakl ID, product, SKU…"
          className="w-full rounded-lg border border-line px-3 py-1.5 text-sm sm:w-72"
        />
        <select value={channel} onChange={(e) => setChannel(e.target.value)} className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm">
          <option value="all">All marketplaces</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm">
          <option value="open">Open (not in transit)</option>
          <option value="overdue">Overdue</option>
          <option value="at_risk">At risk</option>
          <option value="label_created">Label only</option>
          <option value="delayed">Carrier delayed</option>
          <option value="stock">No stock</option>
          <option value="in_transit">In transit</option>
          <option value="all">Everything</option>
        </select>
        <span className="ml-auto font-mono text-xs text-muted">{filtered.length} orders</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              {['Order', 'Marketplace', 'Mirakl order ID', 'Product · size', 'Placed', 'Ship clock', 'SLA'].map((h) => (
                <th key={h} className="eyebrow px-4 py-2.5 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => (
              <tr key={o.orderKey} className="border-b border-line/60 align-top hover:bg-porcelain/60">
                <td className="px-4 py-3">
                  <div className="font-display font-semibold">{o.name}</div>
                  <div className="font-mono text-[11px] text-muted">{o.displayStatus || o.shipState}</div>
                  {o.carrierStatus && (
                    <div className="mt-0.5 max-w-[220px] font-mono text-[10px] text-muted">{o.carrierStatus}</div>
                  )}
                  {o.manualShipped ? (
                    <div className="mt-1 text-[10px] text-good">
                      marked shipped manually{o.manualBy ? ` by ${o.manualBy}` : ''} ·{' '}
                      <button
                        className="underline hover:text-ink"
                        onClick={(e) => { e.stopPropagation(); manualAction('/orders/unmark-shipped', { orderKey: o.orderKey }, `Undo the manual "shipped" mark on ${o.name}?`); }}
                      >
                        undo
                      </button>
                    </div>
                  ) : o.shipState !== 'in_transit' && o.shipState !== 'delayed' ? (
                    <button
                      className="mt-1 text-[10px] text-muted underline hover:text-ink"
                      onClick={(e) => { e.stopPropagation(); manualAction('/orders/mark-shipped', { orderKey: o.orderKey }, `Mark ${o.name} as shipped now? Alerts for it will stop and it will count as shipped.`); }}
                    >
                      Mark as shipped
                    </button>
                  ) : null}
                </td>
                <td className="px-4 py-3"><ChannelBadge channel={o.channel} label={o.channelLabel} /></td>
                <td className="px-4 py-3 font-mono text-xs">{o.miraklOrderId}</td>
                <td className="px-4 py-3">
                  {o.products.map((p, i) => (
                    <div key={i}>
                      <span className="font-medium">{p.title}</span>
                      {p.variant ? <span className="text-muted"> · {p.variant}</span> : null}
                      <span className="text-muted"> × {p.qty}</span>
                      {p.tracked && typeof p.stock === 'number' && p.stock < 0 && (
                        <span className="chip ml-1.5" style={{ background: '#FBE6E3', color: '#C0362C' }}>
                          no stock ({p.stock})
                        </span>
                      )}
                      {p.sku ? <div className="font-mono text-[11px] text-muted">{p.sku}</div> : null}
                    </div>
                  ))}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">
                  {fmtDate(o.createdAt)}
                  <div className="mt-0.5">due {fmtDate(o.deadline)}</div>
                </td>
                <td className="px-4 py-3" style={{ minWidth: 160 }}>
                  <SlaRail createdAt={o.createdAt} deadline={o.deadline} now={now} sla={o.sla} />
                </td>
                <td className="px-4 py-3"><SlaChip sla={o.sla} minutesLeft={o.minutesLeft} /></td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted">
                  No orders match these filters. Change a filter or run a sync.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
