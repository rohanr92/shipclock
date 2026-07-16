const { DateTime } = require('luxon');
const config = require('./config');

// Direct carrier tracking (USPS / UPS / FedEx) so a drop-off scan counts as
// "shipped" within one poll, instead of waiting days for Shopify to refresh.
//
// Env (fill in only the carriers you use):
//   USPS_CLIENT_ID / USPS_CLIENT_SECRET      developer.usps.com
//   UPS_CLIENT_ID / UPS_CLIENT_SECRET        developer.ups.com
//   FEDEX_CLIENT_ID / FEDEX_CLIENT_SECRET    developer.fedex.com
//   FEDEX_API_URL (optional, default https://apis.fedex.com; sandbox: https://apis-sandbox.fedex.com)

const TIMEOUT_MS = 10000;
const FEDEX_URL = (process.env.FEDEX_API_URL || 'https://apis.fedex.com').replace(/\/+$/, '');

const CREDS = {
  usps: { id: process.env.USPS_CLIENT_ID, secret: process.env.USPS_CLIENT_SECRET },
  ups: { id: process.env.UPS_CLIENT_ID, secret: process.env.UPS_CLIENT_SECRET },
  fedex: { id: process.env.FEDEX_CLIENT_ID, secret: process.env.FEDEX_CLIENT_SECRET },
};

function configured(carrier) {
  return !!(CREDS[carrier] && CREDS[carrier].id && CREDS[carrier].secret);
}
function anyConfigured() {
  return configured('usps') || configured('ups') || configured('fedex');
}

async function fetchT(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// ---- OAuth token cache (client credentials for all three) ----
const tokens = {};
async function getToken(carrier) {
  const cached = tokens[carrier];
  if (cached && Date.now() < cached.exp - 60_000) return cached.token;

  const { id, secret } = CREDS[carrier];
  let res;
  if (carrier === 'usps') {
    res = await fetchT('https://apis.usps.com/oauth2/v3/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials', client_id: id, client_secret: secret }),
    });
  } else if (carrier === 'ups') {
    res = await fetchT('https://onlinetools.ups.com/security/v1/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      },
      body: 'grant_type=client_credentials',
    });
  } else {
    res = await fetchT(`${FEDEX_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=client_credentials&client_id=${encodeURIComponent(id)}&client_secret=${encodeURIComponent(secret)}`,
    });
  }
  if (!res.ok) throw new Error(`${carrier} auth ${res.status}: ${(await res.text()).slice(0, 150)}`);
  const j = await res.json();
  tokens[carrier] = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return j.access_token;
}

// ---- Which carrier does a tracking number belong to? ----
function detectCarrier(company, number) {
  const c = (company || '').toLowerCase();
  const n = (number || '').replace(/\s/g, '');
  if (!n) return null;
  if (/usps|postal|pirate/.test(c) && !/ups(?!p)/.test(c)) return 'usps';
  if (/fedex/.test(c)) return 'fedex';
  if (/\bups\b|united parcel/.test(c)) return 'ups';
  if (/^1Z/i.test(n)) return 'ups';
  if (/^(94|93|92|95|82)\d{18,20}$/.test(n)) return 'usps';
  if (/^[A-Z]{2}\d{9}US$/i.test(n)) return 'usps';
  if (/^96\d{18,20}$/.test(n)) return 'fedex';
  if (/^\d{12}$/.test(n) || /^\d{15}$/.test(n)) return 'fedex';
  if (/^\d{20,22}$/.test(n)) return 'usps';
  return null;
}

const LABEL_ONLY = /label created|shipping label|awaiting item|pre-?shipment|order created|shipment information sent|billing information received|manifest/i;

// ---- Per-carrier trackers: return { scanned, scanTime, summary } ----
async function trackUSPS(number) {
  const token = await getToken('usps');
  const res = await fetchT(`https://apis.usps.com/tracking/v3/tracking/${encodeURIComponent(number)}?expand=DETAIL`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`USPS ${res.status}`);
  const j = await res.json();
  const events = (j.trackingEvents || []).map((e) => ({
    desc: e.eventType || e.event || '',
    time: e.eventTimestamp || null,
  }));
  return interpret('USPS', events, j.status || j.statusCategory);
}

async function trackUPS(number) {
  const token = await getToken('ups');
  const res = await fetchT(`https://onlinetools.ups.com/api/track/v1/details/${encodeURIComponent(number)}?locale=en_US`, {
    headers: { Authorization: `Bearer ${token}`, transId: `shipclock-${Date.now()}`, transactionSrc: 'shipclock' },
  });
  if (!res.ok) throw new Error(`UPS ${res.status}`);
  const j = await res.json();
  const pkg = j.trackResponse?.shipment?.[0]?.package?.[0];
  const events = (pkg?.activity || []).map((a) => ({
    desc: a.status?.description || a.status?.type || '',
    // UPS 'M' = manifest / billing info received = label only
    labelOnly: a.status?.type === 'M' || a.status?.type === 'MV',
    time:
      a.date && a.time
        ? DateTime.fromFormat(`${a.date}${a.time}`, 'yyyyMMddHHmmss', { zone: config.TZ }).toUTC().toISO()
        : null,
  }));
  return interpret('UPS', events, pkg?.currentStatus?.description);
}

async function trackFedEx(number) {
  const token = await getToken('fedex');
  const res = await fetchT(`${FEDEX_URL}/track/v1/trackingnumbers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      includeDetailedScans: true,
      trackingInfo: [{ trackingNumberInfo: { trackingNumber: number } }],
    }),
  });
  if (!res.ok) throw new Error(`FedEx ${res.status}`);
  const j = await res.json();
  const tr = j.output?.completeTrackResults?.[0]?.trackResults?.[0];
  if (tr?.error) throw new Error(`FedEx: ${tr.error.message || tr.error.code}`);
  const events = (tr?.scanEvents || []).map((e) => ({
    desc: e.eventDescription || e.eventType || '',
    labelOnly: e.eventType === 'OC', // Order Created = label only
    time: e.date || null,
  }));
  return interpret('FedEx', events, tr?.latestStatusDetail?.description);
}

// Shared: find the earliest physical scan among the events.
function interpret(carrier, events, currentStatus) {
  const scans = events.filter((e) => !(e.labelOnly === true || LABEL_ONLY.test(e.desc)));
  if (!scans.length) {
    return { scanned: false, scanTime: null, summary: `${carrier}: ${currentStatus || 'label created, no scan yet'}` };
  }
  // earliest scan (events usually arrive newest-first)
  let first = scans[scans.length - 1];
  for (const s of scans) {
    if (s.time && (!first.time || s.time < first.time)) first = s;
  }
  let scanTime = null;
  if (first.time) {
    const dt = DateTime.fromISO(first.time, { setZone: true });
    if (dt.isValid) scanTime = dt.toUTC().toISO();
  }
  const shown = DateTime.fromISO(scanTime || DateTime.utc().toISO())
    .setZone(config.TZ)
    .toFormat('MMM d, h:mm a');
  return { scanned: true, scanTime, summary: `${carrier}: ${first.desc || 'scanned'} · ${shown} ET` };
}

// Check an order's tracking numbers until one shows a physical scan.
async function firstScan(trackingList) {
  let last = null;
  for (const t of trackingList || []) {
    const carrier = detectCarrier(t.company, t.number);
    if (!carrier || !configured(carrier)) continue;
    try {
      const fn = carrier === 'usps' ? trackUSPS : carrier === 'ups' ? trackUPS : trackFedEx;
      const result = await fn(t.number.replace(/\s/g, ''));
      if (result.scanned) return result;
      last = result;
    } catch (e) {
      last = { scanned: false, scanTime: null, summary: `${carrier.toUpperCase()} lookup failed: ${e.message}` };
    }
  }
  return last; // null if nothing was checkable
}

module.exports = { anyConfigured, configured, detectCarrier, firstScan };
