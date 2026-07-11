require('dotenv').config();

// Channel registry. Add more marketplaces here if needed.
const CHANNELS = [
  { id: 'nordstrom', label: 'Nordstrom' },
  { id: 'macys', label: "Macy's" },
  { id: 'kohls', label: "Kohl's" },
  { id: 'jcpenney', label: 'JCPenney' },
  { id: 'debenhams', label: 'Debenhams' },
];

// Builds the list of configured Mirakl platforms from env vars, e.g.
// NORDSTROM_MIRAKL_URL=https://nordstrom-prod.mirakl.net
// NORDSTROM_MIRAKL_KEY=xxxx-xxxx
function miraklPlatforms() {
  const out = [];
  for (const c of CHANNELS) {
    const prefix = c.id.toUpperCase();
    const url = process.env[`${prefix}_MIRAKL_URL`];
    const key = process.env[`${prefix}_MIRAKL_KEY`];
    if (url && key) {
      out.push({ id: c.id, label: c.label, url: url.replace(/\/+$/, ''), key });
    }
  }
  return out;
}

function normalizeChannel(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase().replace(/[^a-z]/g, '');
  for (const c of CHANNELS) {
    if (s.includes(c.id.replace(/[^a-z]/g, ''))) return c.id;
  }
  if (s.includes('jcp')) return 'jcpenney';
  return null;
}

function channelLabel(id) {
  const c = CHANNELS.find((x) => x.id === id);
  return c ? c.label : id || 'Unknown';
}

module.exports = {
  PORT: parseInt(process.env.PORT || '4780', 10),
  TZ: process.env.SLA_TIMEZONE || 'America/New_York',

  SHOPIFY_STORE: process.env.SHOPIFY_STORE, // e.g. menina-step.myshopify.com
  SHOPIFY_TOKEN: process.env.SHOPIFY_ADMIN_TOKEN,
  SHOPIFY_API_VERSION: process.env.SHOPIFY_API_VERSION || '2025-01',

  POLL_MINUTES: Math.max(5, parseInt(process.env.POLL_MINUTES || '15', 10)),

  SMTP: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
  },

  DEFAULT_RECIPIENTS: process.env.ALERT_EMAILS || '',

  CHANNELS,
  miraklPlatforms,
  normalizeChannel,
  channelLabel,
};
