import React from 'react';
import { CHANNEL_COLORS, fmtCountdown, weekendSegments } from '../lib.js';

export function ChannelBadge({ channel, label }) {
  const c = CHANNEL_COLORS[channel] || CHANNEL_COLORS.unknown;
  return (
    <span className="chip" style={{ background: c.bg, color: c.fg }}>
      {label || channel}
    </span>
  );
}

const SLA_STYLES = {
  overdue: { fill: '#C0362C', chipBg: '#FBE6E3', chipFg: '#C0362C', text: 'Overdue' },
  at_risk: { fill: '#B45309', chipBg: '#FBF0DA', chipFg: '#9A6B15', text: 'At risk' },
  on_track: { fill: '#5C6670', chipBg: '#EEF0EF', chipFg: '#3B444B', text: 'On track' },
  carrier_delayed: { fill: '#B45309', chipBg: '#FBF0DA', chipFg: '#92400E', text: 'In transit · carrier delayed' },
  shipped_on_time: { fill: '#0E7A4E', chipBg: '#E4F3EB', chipFg: '#0E7A4E', text: 'In transit · on time' },
  shipped_late: { fill: '#0E7A4E', chipBg: '#E4F3EB', chipFg: '#7A5A0E', text: 'In transit · shipped late' },
};

export function SlaChip({ sla, minutesLeft }) {
  const s = SLA_STYLES[sla] || SLA_STYLES.on_track;
  const shippedLike = sla === 'shipped_on_time' || sla === 'shipped_late' || sla === 'carrier_delayed';
  const label = shippedLike ? s.text : `${s.text} · ${fmtCountdown(minutesLeft)}`;
  return (
    <span className="chip whitespace-nowrap" style={{ background: s.chipBg, color: s.chipFg }}>
      {label}
    </span>
  );
}

/**
 * The SLA rail: order placed -> 48 business-hour deadline on a real-time axis.
 * Hatched segments are Sat/Sun, where the clock is paused. The dark tick is "now".
 */
export function SlaRail({ createdAt, deadline, now, sla }) {
  const s = SLA_STYLES[sla] || SLA_STYLES.on_track;
  const start = new Date(createdAt).getTime();
  const end = new Date(deadline).getTime();
  const total = Math.max(1, end - start);
  const pct = Math.min(100, Math.max(0, ((now - start) / total) * 100));
  const segs = weekendSegments(createdAt, deadline);
  const shipped = sla === 'shipped_on_time' || sla === 'shipped_late' || sla === 'carrier_delayed';

  return (
    <div className="w-full min-w-[140px]" title="Placed → 48 business-hour deadline. Hatched = weekend (clock paused).">
      <div className="rail">
        {segs.map(([a, b], i) => (
          <div key={i} className="rail-weekend" style={{ left: `${a}%`, width: `${b - a}%` }} />
        ))}
        <div
          className="rail-fill"
          style={{ width: `${shipped ? 100 : pct}%`, background: s.fill, opacity: shipped ? 0.9 : 0.8 }}
        />
        {!shipped && pct < 100 && <div className="rail-now" style={{ left: `${pct}%` }} />}
      </div>
    </div>
  );
}
