const express = require('express');
const { DateTime } = require('luxon');
const { db, getSettings, saveSettings } = require('./db');
const config = require('./config');
const { runPoll, runDailySummary, runWeeklyReport } = require('./poller');
const { businessMinutesBetween } = require('./sla');
const mailer = require('./mailer');
const whatsapp = require('./whatsapp');
const scorecard = require('./scorecard');

const router = express.Router();

router.get('/overview', (req, res) => {
  const settings = getSettings();
  const now = DateTime.utc();
  const rows = db
    .prepare('SELECT * FROM orders WHERE cancelled = 0 ORDER BY created_at DESC LIMIT 500')
    .all();

  const orders = rows.map((r) => {
    const deadline = DateTime.fromISO(r.deadline);
    const minutesLeft = Math.round(deadline.diff(now, 'minutes').minutes);
    let sla;
    if (r.ship_state === 'in_transit') sla = r.sla_met === 0 ? 'shipped_late' : 'shipped_on_time';
    else if (r.ship_state === 'delayed') sla = 'carrier_delayed';
    else if (minutesLeft <= 0) sla = 'overdue';
    else if (minutesLeft <= settings.atRiskHours * 60) sla = 'at_risk';
    else sla = 'on_track';
    return {
      orderKey: r.order_key,
      name: r.name,
      legacyId: r.legacy_id,
      createdAt: r.created_at,
      channel: r.channel,
      channelLabel: config.channelLabel(r.channel),
      miraklOrderId: r.mirakl_order_id,
      products: JSON.parse(r.products || '[]'),
      shipState: r.ship_state,
      displayStatus: r.display_status,
      tracking: JSON.parse(r.tracking || '[]'),
      deadline: r.deadline,
      minutesLeft,
      sla,
      stockIssue: !!r.stock_issue,
    };
  });

  const missing = (settings.trackMirakl
    ? db.prepare('SELECT * FROM missing WHERE resolved = 0 ORDER BY created_date DESC').all()
    : [])
    .map((m) => ({
      miraklOrderId: m.mirakl_order_id,
      channel: m.channel,
      channelLabel: config.channelLabel(m.channel),
      state: m.order_state,
      createdDate: m.created_date,
      customer: m.customer,
      products: JSON.parse(m.products || '[]'),
      firstSeen: m.first_seen,
      lastAlertAt: m.last_alert_at,
    }));

  const lastRun = db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT 1').get();

  const kpis = {
    overdue: orders.filter((o) => o.sla === 'overdue').length,
    atRisk: orders.filter((o) => o.sla === 'at_risk').length,
    labelOnly: orders.filter((o) => o.shipState === 'label_created').length,
    delayed: orders.filter((o) => o.shipState === 'delayed').length,
    stockIssues: orders.filter((o) => o.stockIssue).length,
    inTransit: orders.filter((o) => o.shipState === 'in_transit').length,
    missing: missing.length,
    open: orders.filter((o) => o.shipState !== 'in_transit' && o.shipState !== 'delayed').length,
  };

  res.json({
    now: now.toISO(),
    tz: config.TZ,
    settings,
    kpis,
    orders,
    missing,
    lastRun: lastRun
      ? { finishedAt: lastRun.finished_at, ok: !!lastRun.ok, detail: JSON.parse(lastRun.detail || '{}') }
      : null,
    channels: config.CHANNELS,
    platformsConfigured: settings.trackMirakl ? config.miraklPlatforms().map((p) => p.id) : [],
    trackMirakl: settings.trackMirakl,
  });
});

router.get('/alerts', (req, res) => {
  const rows = db.prepare('SELECT * FROM alerts ORDER BY id DESC LIMIT 200').all();
  res.json(rows);
});

router.get('/settings', (req, res) => res.json(getSettings()));

router.put('/settings', (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.recipients !== undefined)
    patch.recipients = Array.isArray(b.recipients) ? b.recipients.join(',') : String(b.recipients);
  if (b.slaHours !== undefined) patch.sla_hours = b.slaHours;
  if (b.atRiskHours !== undefined) patch.at_risk_hours = b.atRiskHours;
  if (b.alertAtRisk !== undefined) patch.alert_at_risk = String(!!b.alertAtRisk);
  if (b.repeatHours !== undefined) patch.repeat_hours = b.repeatHours;
  if (b.graceHours !== undefined) patch.grace_hours = b.graceHours;
  if (b.lookbackDays !== undefined) patch.lookback_days = b.lookbackDays;
  if (b.trackMirakl !== undefined) patch.track_mirakl = String(!!b.trackMirakl);
  if (b.whatsappEnabled !== undefined) patch.whatsapp_enabled = String(!!b.whatsappEnabled);
  if (b.whatsappRecipients !== undefined)
    patch.whatsapp_recipients = Array.isArray(b.whatsappRecipients) ? b.whatsappRecipients.join(',') : String(b.whatsappRecipients);
  if (b.summaryEnabled !== undefined) patch.summary_enabled = String(!!b.summaryEnabled);
  if (b.weeklyReportEnabled !== undefined) patch.weekly_report_enabled = String(!!b.weeklyReportEnabled);
  saveSettings(patch);
  res.json(getSettings());
});

// Scorecard: fulfillment performance per marketplace over a period
router.get('/scorecard', (req, res) => {
  const days = [7, 30, 90].includes(parseInt(req.query.days, 10)) ? parseInt(req.query.days, 10) : 30;
  res.json(scorecard.buildScorecard(days));
});

router.post('/send-weekly-now', async (req, res) => {
  try {
    const detail = await runWeeklyReport('manual');
    res.json(detail);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/send-summary-now', async (req, res) => {
  try {
    const detail = await runDailySummary('manual');
    res.json(detail);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/run-now', async (req, res) => {
  try {
    const detail = await runPoll('manual');
    res.json(detail);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/test-whatsapp', async (req, res) => {
  try {
    const settings = getSettings();
    if (!whatsapp.isConfigured())
      return res.status(400).json({ error: 'GREEN_API_ID / GREEN_API_TOKEN not set on the server' });
    if (!settings.whatsappRecipients.length)
      return res.status(400).json({ error: 'No WhatsApp recipients configured' });
    await whatsapp.sendTest(settings);
    res.json({ ok: true, recipients: settings.whatsappRecipients });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/whatsapp-groups', async (req, res) => {
  try {
    const groups = await whatsapp.getGroups();
    res.json(groups);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/test-email', async (req, res) => {
  try {
    const settings = getSettings();
    if (!settings.recipients.length) return res.status(400).json({ error: 'No recipients configured' });
    await mailer.sendTest(settings.recipients);
    res.json({ ok: true, recipients: settings.recipients });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
