const { DateTime } = require('luxon');
const config = require('./config');

// Green API (WhatsApp) - https://green-api.com
// Env: GREEN_API_ID (idInstance), GREEN_API_TOKEN (apiTokenInstance)
const API_URL = (process.env.GREEN_API_URL || 'https://api.green-api.com').replace(/\/+$/, '');
const ID = process.env.GREEN_API_ID;
const TOKEN = process.env.GREEN_API_TOKEN;

function isConfigured() {
  return !!(ID && TOKEN);
}

// Accepts phone numbers ("15551234567", "+880 17...") or raw chat ids
// ("15551234567@c.us" for a person, "1203...@g.us" for a group).
function toChatId(entry) {
  const e = String(entry || '').trim();
  if (!e) return null;
  if (e.includes('@')) return e;
  const digits = e.replace(/[^0-9]/g, '');
  return digits ? `${digits}@c.us` : null;
}

async function sendText(chatId, message) {
  const res = await fetch(`${API_URL}/waInstance${ID}/sendMessage/${TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId, message }),
  });
  if (!res.ok) throw new Error(`Green API ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// Send one message to every configured person/group, paced ~1.5s apart
// so the sending pattern looks human and avoids WhatsApp spam heuristics.
async function broadcast(settings, message) {
  if (!isConfigured()) throw new Error('WhatsApp not configured (set GREEN_API_ID / GREEN_API_TOKEN)');
  const targets = (settings.whatsappRecipients || []).map(toChatId).filter(Boolean);
  if (!targets.length) throw new Error('No WhatsApp recipients configured');
  const errors = [];
  for (const t of targets) {
    try {
      await sendText(t, message);
    } catch (e) {
      errors.push(`${t}: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (errors.length) throw new Error(errors.join(' | '));
}

// List groups the linked WhatsApp number is a member of (to grab group ids).
async function getGroups() {
  if (!isConfigured()) throw new Error('WhatsApp not configured (set GREEN_API_ID / GREEN_API_TOKEN)');
  const res = await fetch(`${API_URL}/waInstance${ID}/getChats/${TOKEN}`);
  if (!res.ok) throw new Error(`Green API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const chats = await res.json();
  return (Array.isArray(chats) ? chats : [])
    .filter((c) => String(c.id || '').endsWith('@g.us'))
    .map((c) => ({ id: c.id, name: c.name || '(unnamed group)' }));
}

// ---------- Message formatting (WhatsApp markdown: *bold*, _italic_) ----------
function fmt(iso) {
  if (!iso) return '-';
  return DateTime.fromISO(iso, { setZone: true }).setZone(config.TZ).toFormat("EEE MMM d, h:mm a 'ET'");
}

function productLines(r) {
  return JSON.parse(r.products || '[]')
    .map((p) => `• ${p.title}${p.variant ? ` — ${p.variant}` : ''} ×${p.qty}${p.sku ? ` (${p.sku})` : ''}`)
    .join('\n');
}

function orderBlock(r, extraLines) {
  return [
    `*${r.name}* · ${config.channelLabel(r.channel)}`,
    `Mirakl: ${r.mirakl_order_id}`,
    productLines(r),
    `Placed: ${fmt(r.created_at)}`,
    ...(extraLines || []),
  ].join('\n');
}

const FOOTER = '';

async function sendOverdue(settings, rows) {
  const msg =
    `🔴 *ShipClock: ${rows.length} order${rows.length > 1 ? 's' : ''} NOT shipped — 48h deadline passed*\n` +
    `Carrier has not scanned these. Ship them now.\n\n` +
    rows.map((r) => orderBlock(r, [`Deadline: ${fmt(r.deadline)}`, `*Overdue by ${r.delta}*`])).join('\n\n') +
    FOOTER;
  await broadcast(settings, msg);
}

async function sendAtRisk(settings, rows) {
  const msg =
    `🟠 *ShipClock: ${rows.length} order${rows.length > 1 ? 's' : ''} approaching the 48h ship deadline*\n\n` +
    rows.map((r) => orderBlock(r, [`Deadline: ${fmt(r.deadline)}`, `*Time left: ${r.delta}*`])).join('\n\n') +
    FOOTER;
  await broadcast(settings, msg);
}

async function sendCarrierDelayed(settings, rows) {
  const msg =
    `🚚 *ShipClock: ${rows.length} order${rows.length > 1 ? 's' : ''} in transit but delayed by the carrier*\n` +
    `SLA met — nothing to ship. Watch tracking; open a claim if they stall.\n\n` +
    rows
      .map((r) => {
        const tracking = JSON.parse(r.tracking || '[]')
          .map((t) => `Tracking: ${t.company || ''} ${t.number || ''}`.trim())
          .join('\n');
        return orderBlock(r, tracking ? [tracking] : []);
      })
      .join('\n\n') +
    FOOTER;
  await broadcast(settings, msg);
}

async function sendStockIssue(settings, rows) {
  const msg =
    `⚠️ *ShipClock: ${rows.length} open order${rows.length > 1 ? 's' : ''} with NO stock to fulfill*\n` +
    `Inventory is below zero — more orders than physical stock. Restock, transfer, or cancel before the deadline.\n\n` +
    rows
      .map((r) => {
        const stockLines = JSON.parse(r.products || '[]')
          .filter((p) => p.tracked && typeof p.stock === 'number' && p.stock < 0)
          .map((p) => `*Stock ${p.stock}* — ${p.title}${p.variant ? ` ${p.variant}` : ''}`);
        return orderBlock(r, stockLines);
      })
      .join('\n\n') +
    FOOTER;
  await broadcast(settings, msg);
}

async function sendMissing(settings, rows) {
  const msg =
    `🟣 *ShipClock: ${rows.length} Mirakl order${rows.length > 1 ? 's' : ''} not found in Shopify*\n` +
    `These exist on the marketplace but were never imported — fulfill manually or re-run the import.\n\n` +
    rows
      .map((m) =>
        [
          `*${m.mirakl_order_id}* · ${config.channelLabel(m.channel)}`,
          `State: ${m.order_state}`,
          JSON.parse(m.products || '[]')
            .map((p) => `• ${p.title} ×${p.qty}`)
            .join('\n'),
          `Placed: ${fmt(m.created_date)}`,
        ].join('\n')
      )
      .join('\n\n') +
    FOOTER;
  await broadcast(settings, msg);
}

async function sendTest(settings) {
  await broadcast(
    settings,
    `✅ *ShipClock test message*\nWhatsApp alerts are configured correctly. Order alerts (overdue, at-risk, carrier delays, stock issues, missing imports) will arrive in this chat.${FOOTER}`
  );
}

module.exports = {
  isConfigured,
  getGroups,
  sendOverdue,
  sendAtRisk,
  sendCarrierDelayed,
  sendStockIssue,
  sendMissing,
  sendTest,
};
