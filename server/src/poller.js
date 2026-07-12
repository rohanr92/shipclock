const { DateTime } = require('luxon');
const { db, getSettings } = require('./db');
const config = require('./config');
const shopify = require('./shopify');
const mirakl = require('./mirakl');
const mailer = require('./mailer');
const whatsapp = require('./whatsapp');
const { addBusinessHours } = require('./sla');

const upsertOrder = db.prepare(`
INSERT INTO orders (order_key, name, legacy_id, created_at, channel, mirakl_order_id, products,
                    ship_state, display_status, tracking, deadline, cancelled, sla_met, sla_met_at,
                    stock_issue, first_seen, updated_at)
VALUES (@order_key, @name, @legacy_id, @created_at, @channel, @mirakl_order_id, @products,
        @ship_state, @display_status, @tracking, @deadline, @cancelled, @sla_met, @sla_met_at,
        @stock_issue, @now, @now)
ON CONFLICT(order_key) DO UPDATE SET
  name = excluded.name,
  channel = excluded.channel,
  mirakl_order_id = excluded.mirakl_order_id,
  products = excluded.products,
  ship_state = excluded.ship_state,
  display_status = excluded.display_status,
  tracking = excluded.tracking,
  deadline = excluded.deadline,
  cancelled = excluded.cancelled,
  sla_met = COALESCE(orders.sla_met, excluded.sla_met),
  sla_met_at = COALESCE(orders.sla_met_at, excluded.sla_met_at),
  stock_issue = excluded.stock_issue,
  updated_at = excluded.updated_at
`);

const logAlert = db.prepare(
  'INSERT INTO alerts (type, order_key, channel, summary, recipients, sent_at) VALUES (?, ?, ?, ?, ?, ?)'
);

function lastAlertAt(type, orderKey) {
  const row = db
    .prepare('SELECT sent_at FROM alerts WHERE type = ? AND order_key = ? ORDER BY sent_at DESC LIMIT 1')
    .get(type, orderKey);
  return row ? DateTime.fromISO(row.sent_at) : null;
}

function humanDelta(minutes) {
  const m = Math.abs(Math.round(minutes));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}

async function syncShopify(settings, now) {
  const orders = await shopify.fetchMiraklShopifyOrders(settings.lookbackDays);
  const nowISO = now.toISO();

  for (const o of orders) {
    const existing = db.prepare('SELECT sla_met, sla_met_at FROM orders WHERE order_key = ?').get(o.orderKey);
    let slaMet = existing ? existing.sla_met : null;
    let slaMetAt = existing ? existing.sla_met_at : null;

    const deadline = addBusinessHours(o.createdAt, settings.slaHours);

    const shipped = o.shipState === 'in_transit' || o.shipState === 'delayed';
    if (shipped && slaMet !== 1 && slaMet !== 0) {
      // First time we see it with the carrier: record whether it beat the deadline.
      slaMet = now.toISO() <= deadline ? 1 : 0;
      slaMetAt = nowISO;
    }

    // Stock issue: an open order whose variant inventory is NEGATIVE.
    // (1 in stock -> order arrives -> 0 is fine: that unit is allocated to this order.
    //  Below zero means more orders than physical stock - it cannot be fulfilled.)
    const stockIssue =
      !shipped &&
      (o.products || []).some((p) => p.tracked && typeof p.stock === 'number' && p.stock < 0)
        ? 1
        : 0;

    upsertOrder.run({
      order_key: o.orderKey,
      name: o.name,
      legacy_id: o.legacyId,
      created_at: o.createdAt,
      channel: o.channel,
      mirakl_order_id: o.miraklOrderId,
      products: JSON.stringify(o.products),
      ship_state: o.shipState,
      display_status: o.displayStatus,
      tracking: JSON.stringify(o.tracking),
      deadline,
      cancelled: o.cancelled ? 1 : 0,
      sla_met: slaMet,
      sla_met_at: slaMetAt,
      stock_issue: stockIssue,
      now: nowISO,
    });
  }
  return orders.length;
}

function evaluateSla(settings, now) {
  const open = db
    .prepare("SELECT * FROM orders WHERE cancelled = 0 AND ship_state NOT IN ('in_transit', 'delayed')")
    .all();

  const overdue = [];
  const atRisk = [];

  for (const r of open) {
    const deadline = DateTime.fromISO(r.deadline);
    const minutesLeft = deadline.diff(now, 'minutes').minutes;

    if (minutesLeft <= 0) {
      const last = lastAlertAt('OVERDUE', r.order_key);
      const due = !last || now.diff(last, 'hours').hours >= settings.repeatHours;
      if (due) overdue.push({ ...r, delta: humanDelta(minutesLeft) });
    } else if (settings.alertAtRisk && minutesLeft <= settings.atRiskHours * 60) {
      const last = lastAlertAt('AT_RISK', r.order_key);
      if (!last) atRisk.push({ ...r, delta: humanDelta(minutesLeft) });
    }
  }
  return { overdue, atRisk };
}

// Open orders whose product has negative stock: separate one-time alert per order.
function evaluateStockIssues() {
  const rows = db
    .prepare("SELECT * FROM orders WHERE cancelled = 0 AND stock_issue = 1 AND ship_state NOT IN ('in_transit', 'delayed')")
    .all();
  const toAlert = [];
  for (const r of rows) {
    const last = lastAlertAt('STOCK_ISSUE', r.order_key);
    if (!last) toAlert.push(r);
  }
  return toAlert;
}

// Orders the carrier has but reported as delayed: separate one-time alert per order.
function evaluateCarrierDelayed(now) {
  const rows = db
    .prepare("SELECT * FROM orders WHERE cancelled = 0 AND ship_state = 'delayed'")
    .all();
  const toAlert = [];
  for (const r of rows) {
    const last = lastAlertAt('CARRIER_DELAYED', r.order_key);
    if (!last) toAlert.push(r);
  }
  return toAlert;
}

async function crossCheckMirakl(settings, now) {
  const platforms = config.miraklPlatforms();
  const nowISO = now.toISO();
  const errors = [];

  // Every Mirakl order id we know about in Shopify (recent window)
  const known = new Set(
    db.prepare('SELECT mirakl_order_id FROM orders').all().map((r) => (r.mirakl_order_id || '').trim())
  );

  const upMissing = db.prepare(`
    INSERT INTO missing (mirakl_order_id, channel, order_state, created_date, customer, products, first_seen, resolved)
    VALUES (@id, @channel, @state, @created, @customer, @products, @now, 0)
    ON CONFLICT(mirakl_order_id) DO UPDATE SET
      order_state = excluded.order_state, resolved = 0, resolved_at = NULL
  `);

  const seenThisRun = new Set();

  for (const p of platforms) {
    try {
      const orders = await mirakl.fetchPlatformOrders(p, settings.lookbackDays);
      for (const mo of orders) {
        seenThisRun.add(mo.miraklOrderId);
        if (known.has(mo.miraklOrderId)) continue;
        upMissing.run({
          id: mo.miraklOrderId,
          channel: p.id,
          state: mo.state,
          created: mo.createdDate,
          customer: mo.customer,
          products: JSON.stringify(mo.products),
          now: nowISO,
        });
      }
    } catch (e) {
      errors.push(e.message);
    }
  }

  // Resolve rows that are now matched in Shopify (or no longer active on Mirakl)
  const unresolved = db.prepare('SELECT * FROM missing WHERE resolved = 0').all();
  for (const m of unresolved) {
    if (known.has(m.mirakl_order_id)) {
      db.prepare('UPDATE missing SET resolved = 1, resolved_at = ? WHERE mirakl_order_id = ?').run(
        nowISO,
        m.mirakl_order_id
      );
    }
  }

  // Alert on unresolved rows older than the grace period, respecting repeat interval
  const toAlert = db
    .prepare('SELECT * FROM missing WHERE resolved = 0')
    .all()
    .filter((m) => {
      const age = now.diff(DateTime.fromISO(m.first_seen), 'hours').hours;
      if (age < settings.graceHours) return false;
      if (!m.last_alert_at) return true;
      return now.diff(DateTime.fromISO(m.last_alert_at), 'hours').hours >= settings.repeatHours;
    });

  return { toAlert, errors };
}

async function runPoll(trigger = 'cron') {
  const now = DateTime.utc();
  const settings = getSettings();
  const started = now.toISO();
  const detail = { trigger, shopifyOrders: 0, alerts: { overdue: 0, atRisk: 0, delayed: 0, stock: 0, missing: 0 }, errors: [] };

  try {
    detail.shopifyOrders = await syncShopify(settings, now);
  } catch (e) {
    detail.errors.push(`Shopify: ${e.message}`);
  }

  const { overdue, atRisk } = evaluateSla(settings, now);
  const carrierDelayed = evaluateCarrierDelayed(now);
  const stockIssues = evaluateStockIssues();
  let missingResult = { toAlert: [], errors: [] };
  if (settings.trackMirakl) {
    try {
      missingResult = await crossCheckMirakl(settings, now);
    } catch (e) {
      detail.errors.push(`Mirakl: ${e.message}`);
    }
  }
  detail.errors.push(...missingResult.errors);

  const recips = settings.recipients;
  const ts = DateTime.utc().toISO();
  const emailOn = recips.length > 0;
  const waOn = settings.whatsappEnabled && settings.whatsappRecipients.length > 0 && whatsapp.isConfigured();

  // Send one alert batch over both channels; dedupe (log) if at least one delivered.
  const dispatch = async (type, rows, emailFn, waFn) => {
    if (!rows.length) return 0;
    let delivered = false;
    if (emailOn) {
      try { await emailFn(recips, rows); delivered = true; }
      catch (e) { detail.errors.push(`Email ${type}: ${e.message}`); }
    }
    if (waOn) {
      try { await waFn(settings, rows); delivered = true; }
      catch (e) { detail.errors.push(`WhatsApp ${type}: ${e.message}`); }
    }
    return delivered ? rows.length : 0;
  };

  if (emailOn || waOn) {
    let n;
    n = await dispatch('OVERDUE', overdue, mailer.sendOverdue, whatsapp.sendOverdue);
    if (n) {
      for (const r of overdue)
        logAlert.run('OVERDUE', r.order_key, r.channel, `${r.name} / ${r.mirakl_order_id} overdue ${r.delta}`, recips.join(','), ts);
      detail.alerts.overdue = n;
    }
    n = await dispatch('AT_RISK', atRisk, mailer.sendAtRisk, whatsapp.sendAtRisk);
    if (n) {
      for (const r of atRisk)
        logAlert.run('AT_RISK', r.order_key, r.channel, `${r.name} / ${r.mirakl_order_id} due in ${r.delta}`, recips.join(','), ts);
      detail.alerts.atRisk = n;
    }
    n = await dispatch('CARRIER_DELAYED', carrierDelayed, mailer.sendCarrierDelayed, whatsapp.sendCarrierDelayed);
    if (n) {
      for (const r of carrierDelayed)
        logAlert.run('CARRIER_DELAYED', r.order_key, r.channel, `${r.name} / ${r.mirakl_order_id} in transit but delayed by carrier`, recips.join(','), ts);
      detail.alerts.delayed = n;
    }
    n = await dispatch('STOCK_ISSUE', stockIssues, mailer.sendStockIssue, whatsapp.sendStockIssue);
    if (n) {
      for (const r of stockIssues)
        logAlert.run('STOCK_ISSUE', r.order_key, r.channel, `${r.name} / ${r.mirakl_order_id} open order with no stock`, recips.join(','), ts);
      detail.alerts.stock = n;
    }
    n = await dispatch('MISSING_IN_SHOPIFY', missingResult.toAlert, mailer.sendMissing, whatsapp.sendMissing);
    if (n) {
      const mark = db.prepare('UPDATE missing SET last_alert_at = ? WHERE mirakl_order_id = ?');
      for (const m of missingResult.toAlert) {
        logAlert.run('MISSING_IN_SHOPIFY', m.mirakl_order_id, m.channel, `${m.mirakl_order_id} on ${config.channelLabel(m.channel)} Mirakl, not in Shopify`, recips.join(','), ts);
        mark.run(ts, m.mirakl_order_id);
      }
      detail.alerts.missing = n;
    }
  } else if (overdue.length || atRisk.length || carrierDelayed.length || stockIssues.length || missingResult.toAlert.length) {
    detail.errors.push('Alerts pending but no recipients configured (Settings).');
  }

  db.prepare('INSERT INTO runs (started_at, finished_at, ok, detail) VALUES (?, ?, ?, ?)').run(
    started,
    DateTime.utc().toISO(),
    detail.errors.length === 0 ? 1 : 0,
    JSON.stringify(detail)
  );

  return detail;
}

module.exports = { runPoll };
