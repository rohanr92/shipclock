const { DateTime } = require('luxon');
const { db } = require('./db');
const config = require('./config');
const { businessMinutesBetween } = require('./sla');

function calc(list) {
  const total = list.length;
  const cancelled = list.filter((r) => r.cancelled).length;
  const active = list.filter((r) => !r.cancelled);
  const shipped = active.filter((r) => r.sla_met !== null && r.sla_met_at);
  const onTime = shipped.filter((r) => r.sla_met === 1).length;
  const late = shipped.filter((r) => r.sla_met === 0).length;
  const shipMins = shipped.map((r) => businessMinutesBetween(r.created_at, r.sla_met_at));
  const delivered = active.filter((r) => r.delivered_at);
  const delivDays = delivered.map((r) => (new Date(r.delivered_at) - new Date(r.created_at)) / 86400000);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return {
    orders: total,
    cancelled,
    cancelRate: total ? cancelled / total : null,
    shipped: shipped.length,
    lateShipped: late,
    onTimeRate: onTime + late > 0 ? onTime / (onTime + late) : null,
    avgShipBusinessHours: avg(shipMins) !== null ? avg(shipMins) / 60 : null,
    delivered: delivered.length,
    avgDeliveryDays: avg(delivDays),
    openNow: active.filter((r) => r.ship_state !== 'in_transit' && r.ship_state !== 'delayed').length,
  };
}

// Metrics for orders created in a window of `days`, ending `endOffsetDays` ago.
// buildScorecard(7)      -> last 7 days
// buildScorecard(7, 7)   -> the 7 days before that (for week-over-week trends)
function buildScorecard(days, endOffsetDays = 0) {
  const until = DateTime.utc().minus({ days: endOffsetDays });
  const since = until.minus({ days });
  const rows = db
    .prepare('SELECT * FROM orders WHERE created_at >= ? AND created_at < ?')
    .all(since.toISO(), until.toISO());
  return {
    days,
    since: since.toISO(),
    until: until.toISO(),
    all: calc(rows),
    channels: config.CHANNELS.map((c) => ({ id: c.id, label: c.label, ...calc(rows.filter((r) => r.channel === c.id)) })),
  };
}

// Plain-language "what the score says / what to improve" lines, shared by email + WhatsApp.
function buildInsights(cur, prev) {
  const out = [];
  const p = (v) => (v == null ? null : Math.round(v * 100));
  const a = cur.all;

  if (a.orders === 0) {
    out.push('No orders in this period.');
    return out;
  }

  if (a.onTimeRate != null) {
    const otp = p(a.onTimeRate);
    if (otp >= 95) out.push(`✅ On-time ship rate ${otp}% — target met (95%+).`);
    else if (otp >= 85)
      out.push(`🟠 On-time ship rate ${otp}% — below the ~95% marketplaces expect. ${a.lateShipped} order(s) shipped late.`);
    else
      out.push(`🔴 On-time ship rate ${otp}% — risk zone for marketplace metrics. ${a.lateShipped} shipped late. Make overdue orders the first pick every morning.`);

    if (prev && prev.all.onTimeRate != null) {
      const d = otp - p(prev.all.onTimeRate);
      if (d <= -3) out.push(`▼ On-time dropped ${Math.abs(d)} points vs the previous week (${p(prev.all.onTimeRate)}% → ${otp}%).`);
      else if (d >= 3) out.push(`▲ On-time improved ${d} points vs the previous week (${p(prev.all.onTimeRate)}% → ${otp}%).`);
    }
  } else {
    out.push('No shipped orders in this period to rate yet.');
  }

  const rated = cur.channels.filter((c) => c.onTimeRate != null && c.shipped >= 3);
  if (rated.length > 1) {
    const worst = [...rated].sort((x, y) => x.onTimeRate - y.onTimeRate)[0];
    if (worst.onTimeRate < 0.95)
      out.push(`Focus marketplace: ${worst.label} at ${p(worst.onTimeRate)}% on-time (${worst.lateShipped} late of ${worst.shipped} shipped) — ship its orders first.`);
  }

  if (a.avgShipBusinessHours != null) {
    const h = a.avgShipBusinessHours;
    if (h > 40) out.push(`🔴 Avg ship time ${h.toFixed(1)} business hours — too close to the 48h limit. Aim under 30h for a safety buffer.`);
    else if (h > 30) out.push(`🟠 Avg ship time ${h.toFixed(1)}h — okay, but getting under 30h gives a safer buffer.`);
    else out.push(`✅ Avg ship time ${h.toFixed(1)}h — healthy buffer under the 48h limit.`);
  }

  if (a.cancelRate != null && a.cancelRate > 0.05)
    out.push(`🟠 Cancel rate ${p(a.cancelRate)}% — marketplaces penalize seller cancellations above ~2-3%. Check the no-stock alerts.`);

  if (a.avgDeliveryDays != null) out.push(`Avg delivery: ${a.avgDeliveryDays.toFixed(1)} days from order to doorstep.`);
  if (a.openNow > 0) out.push(`${a.openNow} order(s) still open right now.`);

  return out;
}

module.exports = { buildScorecard, buildInsights };
