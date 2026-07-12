import React, { useEffect, useState } from 'react';
import { api, CHANNEL_COLORS } from '../lib.js';

const fmtPct = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);
const fmtH = (v) => (v === null || v === undefined ? '—' : `${v.toFixed(1)}h`);
const fmtD = (v) => (v === null || v === undefined ? '—' : `${v.toFixed(1)}d`);

function rateTone(v, goodHigh = true) {
  if (v === null || v === undefined) return 'text-muted';
  const good = goodHigh ? v >= 0.95 : v <= 0.03;
  const bad = goodHigh ? v < 0.85 : v > 0.08;
  return bad ? 'text-bad' : good ? 'text-good' : 'text-warn';
}

export default function ScorecardView() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    setData(null);
    api(`/scorecard?days=${days}`).then(setData).catch((e) => setErr(e.message));
  }, [days]);

  const cards = data
    ? [
        { label: 'Orders', value: data.all.orders, tone: 'text-ink' },
        { label: 'On-time ship rate', value: fmtPct(data.all.onTimeRate), tone: rateTone(data.all.onTimeRate) },
        { label: 'Avg ship time', value: fmtH(data.all.avgShipBusinessHours), tone: 'text-ink', hint: 'business hours, order → carrier scan' },
        { label: 'Avg delivery', value: fmtD(data.all.avgDeliveryDays), tone: 'text-ink', hint: 'calendar days, order → delivered' },
        { label: 'Cancelled', value: fmtPct(data.all.cancelRate), tone: rateTone(data.all.cancelRate, false) },
        { label: 'Shipped late', value: data.all.lateShipped, tone: data.all.lateShipped > 0 ? 'text-warn' : 'text-good' },
      ]
    : [];

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <span className="eyebrow">Period</span>
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`rounded-lg border px-3 py-1.5 font-display text-[12px] font-semibold uppercase tracking-wider ${
              days === d ? 'border-ink bg-ink text-white' : 'border-line bg-white text-muted hover:text-ink'
            }`}
          >
            {d} days
          </button>
        ))}
        <span className="ml-auto text-xs text-muted">Based on Shopify order data · deadlines in business hours (Sat/Sun excluded)</span>
      </div>

      {err && <div className="panel px-4 py-6 text-center text-sm text-bad">{err}</div>}
      {!data && !err && <div className="panel px-4 py-12 text-center text-sm text-muted">Loading…</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {cards.map((c) => (
              <div key={c.label} className="panel px-4 py-3" title={c.hint || ''}>
                <div className="eyebrow">{c.label}</div>
                <div className={`mt-1 font-display text-2xl font-bold tabular-nums ${c.tone}`}>{c.value}</div>
              </div>
            ))}
          </div>

          <div className="panel mt-4 overflow-hidden">
            <div className="border-b border-line px-4 py-3 font-display text-sm font-semibold">By marketplace · last {data.days} days</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left">
                    {['Marketplace', 'Orders', 'On-time ship', 'Avg ship time', 'Avg delivery', 'Shipped late', 'Cancelled', 'Open now'].map((h) => (
                      <th key={h} className="eyebrow px-4 py-2.5">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-line/60 bg-porcelain/50 font-medium">
                    <td className="px-4 py-3">All marketplaces</td>
                    <td className="px-4 py-3 tabular-nums">{data.all.orders}</td>
                    <td className={`px-4 py-3 tabular-nums font-semibold ${rateTone(data.all.onTimeRate)}`}>{fmtPct(data.all.onTimeRate)}</td>
                    <td className="px-4 py-3 tabular-nums">{fmtH(data.all.avgShipBusinessHours)}</td>
                    <td className="px-4 py-3 tabular-nums">{fmtD(data.all.avgDeliveryDays)}</td>
                    <td className="px-4 py-3 tabular-nums">{data.all.lateShipped}</td>
                    <td className={`px-4 py-3 tabular-nums ${rateTone(data.all.cancelRate, false)}`}>{fmtPct(data.all.cancelRate)}</td>
                    <td className="px-4 py-3 tabular-nums">{data.all.openNow}</td>
                  </tr>
                  {data.channels.map((c) => {
                    const color = CHANNEL_COLORS[c.id] || CHANNEL_COLORS.unknown;
                    return (
                      <tr key={c.id} className="border-b border-line/60">
                        <td className="px-4 py-3">
                          <span className="chip" style={{ background: color.bg, color: color.fg }}>{c.label}</span>
                        </td>
                        <td className="px-4 py-3 tabular-nums">{c.orders}</td>
                        <td className={`px-4 py-3 tabular-nums font-semibold ${rateTone(c.onTimeRate)}`}>{fmtPct(c.onTimeRate)}</td>
                        <td className="px-4 py-3 tabular-nums">{fmtH(c.avgShipBusinessHours)}</td>
                        <td className="px-4 py-3 tabular-nums">{fmtD(c.avgDeliveryDays)}</td>
                        <td className="px-4 py-3 tabular-nums">{c.lateShipped}</td>
                        <td className={`px-4 py-3 tabular-nums ${rateTone(c.cancelRate, false)}`}>{fmtPct(c.cancelRate)}</td>
                        <td className="px-4 py-3 tabular-nums">{c.openNow}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="px-4 py-3 text-xs text-muted">
              On-time = carrier scan within 48 business hours. Avg ship time counts business hours only. Avg delivery counts calendar days and builds up as orders get delivered from now on.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
