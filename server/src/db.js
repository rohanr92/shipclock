const Database = require('better-sqlite3');
const path = require('path');
const config = require('./config');

const db = new Database(process.env.DB_PATH || path.join(__dirname, '..', 'shipclock.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS orders (
  order_key TEXT PRIMARY KEY,          -- Shopify GID
  name TEXT,                           -- #8981
  legacy_id TEXT,
  created_at TEXT,
  channel TEXT,
  mirakl_order_id TEXT,
  products TEXT,                       -- JSON [{title,variant,sku,qty}]
  ship_state TEXT,                     -- unfulfilled | label_created | in_transit
  display_status TEXT,                 -- raw Shopify fulfillment displayStatus
  tracking TEXT,                       -- JSON [{company,number,url}]
  deadline TEXT,                       -- ISO, 48 business hours after created_at
  cancelled INTEGER DEFAULT 0,
  sla_met INTEGER,                     -- 1 met, 0 missed-at-deadline (still open), NULL pending
  sla_met_at TEXT,
  first_seen TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT,                           -- OVERDUE | AT_RISK | MISSING_IN_SHOPIFY
  order_key TEXT,                      -- shopify gid or mirakl id for missing
  channel TEXT,
  summary TEXT,
  recipients TEXT,
  sent_at TEXT
);

CREATE TABLE IF NOT EXISTS missing (
  mirakl_order_id TEXT PRIMARY KEY,
  channel TEXT,
  order_state TEXT,
  created_date TEXT,
  customer TEXT,
  products TEXT,                       -- JSON
  first_seen TEXT,
  last_alert_at TEXT,
  resolved INTEGER DEFAULT 0,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT,
  finished_at TEXT,
  ok INTEGER,
  detail TEXT
);
`);

// Migration: add stock_issue column to existing databases
try { db.exec('ALTER TABLE orders ADD COLUMN stock_issue INTEGER DEFAULT 0'); } catch (e) {}

const DEFAULT_SETTINGS = {
  recipients: config.DEFAULT_RECIPIENTS, // comma separated
  sla_hours: '48',
  at_risk_hours: '8',
  alert_at_risk: 'true',
  repeat_hours: '12', // re-send overdue alert every N hours until resolved
  grace_hours: '3', // Mirakl order must be this old before "missing in Shopify" alert
  lookback_days: '14',
  track_mirakl: 'true', // OFF = only track Shopify orders, skip Mirakl platform polling
  whatsapp_enabled: 'false',
  whatsapp_recipients: '', // phone numbers (15551234567) and/or group ids (...@g.us), comma separated
};

const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = {};
  for (const r of rows) s[r.key] = r.value;
  return {
    recipients: (s.recipients || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
    slaHours: parseFloat(s.sla_hours || '48'),
    atRiskHours: parseFloat(s.at_risk_hours || '8'),
    alertAtRisk: s.alert_at_risk !== 'false',
    repeatHours: parseFloat(s.repeat_hours || '12'),
    graceHours: parseFloat(s.grace_hours || '3'),
    lookbackDays: parseInt(s.lookback_days || '14', 10),
    trackMirakl: s.track_mirakl !== 'false',
    whatsappEnabled: s.whatsapp_enabled === 'true',
    whatsappRecipients: (s.whatsapp_recipients || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  };
}

function saveSettings(patch) {
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const tx = db.transaction((entries) => {
    for (const [k, v] of entries) up.run(k, String(v));
  });
  tx(Object.entries(patch));
}

module.exports = { db, getSettings, saveSettings };
