const nodemailer = require('nodemailer');
const { DateTime } = require('luxon');
const config = require('./config');

let transporter = null;
function getTransporter() {
  if (!transporter) {
    if (!config.SMTP.host || !config.SMTP.user) {
      throw new Error('SMTP not configured (SMTP_HOST / SMTP_USER / SMTP_PASS)');
    }
    transporter = nodemailer.createTransport({
      host: config.SMTP.host,
      port: config.SMTP.port,
      secure: config.SMTP.secure,
      auth: { user: config.SMTP.user, pass: config.SMTP.pass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
    });
  }
  return transporter;
}

const S = {
  wrap: 'margin:0;padding:24px;background:#f2f4f3;font-family:Arial,Helvetica,sans-serif;color:#14181a;',
  card: 'max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e2e6e4;border-radius:10px;overflow:hidden;',
  head: 'padding:18px 24px;border-bottom:1px solid #e2e6e4;',
  brand: 'font-size:12px;letter-spacing:2px;color:#5c6670;text-transform:uppercase;margin:0 0 6px;',
  title: 'font-size:19px;font-weight:bold;margin:0;',
  body: 'padding:20px 24px;',
  table: 'width:100%;border-collapse:collapse;font-size:13px;',
  th: 'text-align:left;padding:8px 10px;background:#f6f7f6;border-bottom:1px solid #e2e6e4;color:#5c6670;font-size:11px;text-transform:uppercase;letter-spacing:1px;',
  td: 'padding:10px;border-bottom:1px solid #eef0ef;vertical-align:top;',
  mono: 'font-family:Consolas,Menlo,monospace;font-size:12px;',
  foot: 'padding:14px 24px;color:#8a939b;font-size:11px;',
};

function fmt(iso) {
  if (!iso) return '—';
  return DateTime.fromISO(iso, { setZone: true }).setZone(config.TZ).toFormat("EEE MMM d, h:mm a 'ET'");
}

function productsCell(products) {
  return (products || [])
    .map((p) => {
      const size = p.variant ? ` — ${p.variant}` : '';
      const sku = p.sku ? `<br><span style="${S.mono};color:#5c6670">${p.sku}</span>` : '';
      return `${p.title}${size} × ${p.qty}${sku}`;
    })
    .join('<br><br>');
}

function shell(headline, sub, inner) {
  return `<div style="${S.wrap}"><div style="${S.card}">
    <div style="${S.head}"><p style="${S.brand}">ShipClock · Fulfillment SLA</p>
    <p style="${S.title}">${headline}</p>
    ${sub ? `<p style="margin:6px 0 0;color:#5c6670;font-size:13px;">${sub}</p>` : ''}</div>
    <div style="${S.body}">${inner}</div>
    <div style="${S.foot}">Automated alert · 48 business hours SLA (Sat/Sun excluded) · Timezone ${config.TZ}</div>
  </div></div>`;
}

function overdueTable(rows, kind) {
  const header = `<tr>
    <th style="${S.th}">Shopify</th><th style="${S.th}">Marketplace</th>
    <th style="${S.th}">Mirakl order ID</th><th style="${S.th}">Product / size</th>
    <th style="${S.th}">Placed</th><th style="${S.th}">Deadline</th>
    <th style="${S.th}">${kind === 'OVERDUE' ? 'Overdue by' : 'Time left'}</th>
    <th style="${S.th}">Status</th></tr>`;
  const body = rows
    .map((r) => `<tr>
      <td style="${S.td}"><b>${r.name}</b><br><span style="${S.mono};color:#5c6670">#${r.legacy_id || ''}</span></td>
      <td style="${S.td}">${config.channelLabel(r.channel)}</td>
      <td style="${S.td};${S.mono}">${r.mirakl_order_id}</td>
      <td style="${S.td}">${productsCell(JSON.parse(r.products || '[]'))}</td>
      <td style="${S.td}">${fmt(r.created_at)}</td>
      <td style="${S.td}">${fmt(r.deadline)}</td>
      <td style="${S.td};color:${kind === 'OVERDUE' ? '#c0362c' : '#9a6b15'};font-weight:bold">${r.delta}</td>
      <td style="${S.td}">${r.ship_state === 'label_created' ? 'Label created, not in transit' : 'Not fulfilled'}</td>
    </tr>`)
    .join('');
  return `<table style="${S.table}">${header}${body}</table>`;
}

function missingTable(rows) {
  const header = `<tr>
    <th style="${S.th}">Mirakl order ID</th><th style="${S.th}">Marketplace</th>
    <th style="${S.th}">State</th><th style="${S.th}">Product</th>
    <th style="${S.th}">Placed</th></tr>`;
  const body = rows
    .map((r) => `<tr>
      <td style="${S.td};${S.mono}"><b>${r.mirakl_order_id}</b></td>
      <td style="${S.td}">${config.channelLabel(r.channel)}</td>
      <td style="${S.td}">${r.order_state}</td>
      <td style="${S.td}">${productsCell(JSON.parse(r.products || '[]'))}</td>
      <td style="${S.td}">${fmt(r.created_date)}</td>
    </tr>`)
    .join('');
  return `<table style="${S.table}">${header}${body}</table>`;
}

async function send(recipients, subject, html) {
  // Brevo HTTP API (port 443) - use when SMTP ports are blocked (e.g. Railway)
  if (process.env.BREVO_API_KEY) {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { name: 'ShipClock', email: config.SMTP.from },
        to: recipients.map((e) => ({ email: e })),
        subject,
        htmlContent: html,
      }),
    });
    if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return;
  }
  const t = getTransporter();
  await t.sendMail({
    from: `ShipClock <${config.SMTP.from}>`,
    to: recipients.join(', '),
    subject,
    html,
  });
}

async function sendOverdue(recipients, rows) {
  const subject = `[ShipClock] ${rows.length} order${rows.length > 1 ? 's' : ''} not shipped - 48h deadline passed`;
  const html = shell(
    'SLA breached: not in transit within 48 business hours',
    'These orders have a label at most — the carrier has not scanned them. Ship them now.',
    overdueTable(rows, 'OVERDUE')
  );
  await send(recipients, subject, html);
}

async function sendAtRisk(recipients, rows) {
  const subject = `[ShipClock] ${rows.length} order${rows.length > 1 ? 's' : ''} approaching the 48h ship deadline`;
  const html = shell(
    'Approaching deadline: ship these today',
    'These orders are inside the warning window and are not in transit yet.',
    overdueTable(rows, 'AT_RISK')
  );
  await send(recipients, subject, html);
}

function delayedTable(rows) {
  const header = `<tr>
    <th style="${S.th}">Shopify</th><th style="${S.th}">Marketplace</th>
    <th style="${S.th}">Mirakl order ID</th><th style="${S.th}">Product / size</th>
    <th style="${S.th}">Placed</th><th style="${S.th}">Tracking</th></tr>`;
  const body = rows
    .map((r) => {
      const tracking = JSON.parse(r.tracking || '[]')
        .map((t) => `${t.company || ''} <span style="${S.mono}">${t.number || ''}</span>${t.url ? ` &middot; <a href="${t.url}">track</a>` : ''}`)
        .join('<br>') || '&mdash;';
      return `<tr>
      <td style="${S.td}"><b>${r.name}</b><br><span style="${S.mono};color:#5c6670">#${r.legacy_id || ''}</span></td>
      <td style="${S.td}">${config.channelLabel(r.channel)}</td>
      <td style="${S.td};${S.mono}">${r.mirakl_order_id}</td>
      <td style="${S.td}">${productsCell(JSON.parse(r.products || '[]'))}</td>
      <td style="${S.td}">${fmt(r.created_at)}</td>
      <td style="${S.td}">${tracking}</td>
    </tr>`;
    })
    .join('');
  return `<table style="${S.table}">${header}${body}</table>`;
}

async function sendCarrierDelayed(recipients, rows) {
  const subject = `[ShipClock] ${rows.length} order${rows.length > 1 ? 's' : ''} in transit but delayed by the carrier`;
  const html = shell(
    'Carrier delay: shipped, but the carrier reports a delay',
    'These orders ARE with the carrier (SLA met) but tracking shows a delay. Nothing to ship - watch them and open a carrier claim if they stall.',
    delayedTable(rows)
  );
  await send(recipients, subject, html);
}

function stockTable(rows) {
  const header = `<tr>
    <th style="${S.th}">Shopify</th><th style="${S.th}">Marketplace</th>
    <th style="${S.th}">Mirakl order ID</th><th style="${S.th}">Product / size</th>
    <th style="${S.th}">Stock now</th><th style="${S.th}">Placed</th></tr>`;
  const body = rows
    .map((r) => {
      const products = JSON.parse(r.products || '[]');
      const stockCell = products
        .map((p) => {
          const bad = p.tracked && typeof p.stock === 'number' && p.stock < 0;
          return bad
            ? `<b style="color:#c0362c">${p.stock}</b>`
            : `${typeof p.stock === 'number' ? p.stock : '&mdash;'}`;
        })
        .join('<br><br>');
      return `<tr>
      <td style="${S.td}"><b>${r.name}</b><br><span style="${S.mono};color:#5c6670">#${r.legacy_id || ''}</span></td>
      <td style="${S.td}">${config.channelLabel(r.channel)}</td>
      <td style="${S.td};${S.mono}">${r.mirakl_order_id}</td>
      <td style="${S.td}">${productsCell(products)}</td>
      <td style="${S.td}">${stockCell}</td>
      <td style="${S.td}">${fmt(r.created_at)}</td>
    </tr>`;
    })
    .join('');
  return `<table style="${S.table}">${header}${body}</table>`;
}

async function sendStockIssue(recipients, rows) {
  const subject = `[ShipClock] ${rows.length} open order${rows.length > 1 ? 's' : ''} with NO stock to fulfill`;
  const html = shell(
    'No stock: open orders you cannot fulfill',
    'Inventory for these products is below zero - more orders exist than physical stock. Restock, transfer, or cancel before the 48h clock runs out.',
    stockTable(rows)
  );
  await send(recipients, subject, html);
}

async function sendMissing(recipients, rows) {
  const subject = `[ShipClock] ${rows.length} Mirakl order${rows.length > 1 ? 's' : ''} not found in Shopify`;
  const html = shell(
    'Order exists on the marketplace but not in Shopify',
    'These orders were found on Mirakl but no matching Shopify order carries their Mirakl order ID. The import bridge may have failed — fulfill them manually or re-run the import.',
    missingTable(rows)
  );
  await send(recipients, subject, html);
}

function summaryLine(r, humanDeadline) {
  const m = Math.abs(Math.round(r.minutesLeft));
  const h = Math.floor(m / 60);
  const left = r.minutesLeft <= 0 ? `overdue ${h}h ${m % 60}m` : `${h}h ${m % 60}m left`;
  const color = r.minutesLeft <= 0 ? '#c0362c' : r.minutesLeft <= 120 ? '#9a6b15' : '#3b444b';
  return `<tr>
    <td style="${S.td}"><b>${r.name}</b></td>
    <td style="${S.td}">${config.channelLabel(r.channel)}</td>
    <td style="${S.td};${S.mono}">${r.mirakl_order_id}</td>
    <td style="${S.td}">${productsCell(JSON.parse(r.products || '[]'))}</td>
    <td style="${S.td}">${humanDeadline(r.deadline)}</td>
    <td style="${S.td};color:${color};font-weight:bold">${left}</td>
  </tr>`;
}

async function sendDailySummary(recipients, d) {
  const total = d.open.length;
  const subject = total === 0
    ? '[ShipClock] Morning summary - all clear, nothing to ship'
    : `[ShipClock] Morning summary - ${total} to ship${d.overdue.length ? `, ${d.overdue.length} OVERDUE` : ''}${d.dueSoon.length ? `, ${d.dueSoon.length} due in 2h` : ''}`;

  const counts = `<p style="font-size:14px;line-height:1.8">
    ${d.overdue.length ? `🔴 <b>${d.overdue.length} overdue</b> — ship first<br>` : ''}
    ${d.dueSoon.length ? `⏰ <b>${d.dueSoon.length} due within 2 hours</b><br>` : ''}
    ${d.dueToday.length ? `📦 ${d.dueToday.length} more due today<br>` : ''}
    ${d.later ? `🗓 ${d.later} due later<br>` : ''}
    </p>
    <p style="font-size:12px;color:#5c6670">Also right now: ${d.delayed} carrier delayed · ${d.stock} with no stock · ${d.missing} missing in Shopify</p>`;

  const urgent = [...d.overdue, ...d.dueSoon, ...d.dueToday];
  const table = urgent.length
    ? `<table style="${S.table}"><tr>
        <th style="${S.th}">Shopify</th><th style="${S.th}">Marketplace</th>
        <th style="${S.th}">Mirakl order ID</th><th style="${S.th}">Product / size</th>
        <th style="${S.th}">Deadline</th><th style="${S.th}">Clock</th></tr>${urgent.map((r) => summaryLine(r, d.humanDeadline)).join('')}</table>`
    : '';

  const html = shell(
    total === 0 ? `All clear — ${d.date}` : `${total} order${total > 1 ? 's' : ''} to ship — ${d.date}`,
    total === 0 ? 'Nothing waiting to ship. Every order is with the carrier.' : "Today's shipping worklist, most urgent first.",
    counts + table
  );
  await send(recipients, subject, html);
}

const fPct = (v) => (v == null ? '&mdash;' : `${Math.round(v * 100)}%`);
const fH = (v) => (v == null ? '&mdash;' : `${v.toFixed(1)}h`);
const fD2 = (v) => (v == null ? '&mdash;' : `${v.toFixed(1)}d`);

function scorecardTable(cur) {
  const row = (label, m, bold) => `<tr${bold ? ` style="background:#f6f7f6;font-weight:bold"` : ''}>
    <td style="${S.td}">${label}</td>
    <td style="${S.td}">${m.orders}</td>
    <td style="${S.td};color:${m.onTimeRate != null && m.onTimeRate < 0.85 ? '#c0362c' : m.onTimeRate != null && m.onTimeRate < 0.95 ? '#9a6b15' : '#0e7a4e'}"><b>${fPct(m.onTimeRate)}</b></td>
    <td style="${S.td}">${fH(m.avgShipBusinessHours)}</td>
    <td style="${S.td}">${fD2(m.avgDeliveryDays)}</td>
    <td style="${S.td}">${m.lateShipped}</td>
    <td style="${S.td}">${fPct(m.cancelRate)}</td>
  </tr>`;
  const header = `<tr>
    <th style="${S.th}">Marketplace</th><th style="${S.th}">Orders</th><th style="${S.th}">On-time</th>
    <th style="${S.th}">Avg ship</th><th style="${S.th}">Avg delivery</th><th style="${S.th}">Late</th><th style="${S.th}">Cancelled</th></tr>`;
  return `<table style="${S.table}">${header}${row('All marketplaces', cur.all, true)}${cur.channels.map((c) => row(config.channelLabel(c.id), c)).join('')}</table>`;
}

async function sendWeeklyScorecard(recipients, { cur, prev, insights, range }) {
  const otp = cur.all.onTimeRate == null ? 'n/a' : `${Math.round(cur.all.onTimeRate * 100)}% on-time`;
  const subject = `[ShipClock] Weekly scorecard ${range} - ${cur.all.orders} orders, ${otp}`;
  const insightHtml = `<p style="font-size:13px;font-weight:bold;margin:18px 0 6px">What the numbers say</p>
    <ul style="font-size:13px;line-height:1.7;padding-left:18px;margin:0">${insights.map((i) => `<li>${i}</li>`).join('')}</ul>
    <p style="font-size:11px;color:#8a939b;margin-top:14px">Method: clock starts at order creation in Shopify; "shipped" = first carrier scan reported to Shopify (checked every 15 min); on-time = scan within 48 business hours (Sat/Sun excluded); delivery in calendar days.</p>`;
  const html = shell(
    `Weekly scorecard — ${range}`,
    `Last 7 days vs the week before. Previous week: ${prev.all.orders} orders, ${fPct(prev.all.onTimeRate)} on-time.`,
    scorecardTable(cur) + insightHtml
  );
  await send(recipients, subject, html);
}

async function sendWelcome(email, password, appUrl) {
  const link = appUrl ? `<p style="font-size:13px">Sign in here: <a href="${appUrl}">${appUrl}</a></p>` : '';
  const html = shell(
    'You have been added to ShipClock',
    'ShipClock watches Mirakl orders in Shopify and alerts the team when an order is not shipped within 48 business hours.',
    `<p style="font-size:14px">Your sign-in details:</p>
     <table style="${S.table}">
       <tr><td style="${S.td};width:110px;color:#5c6670">Email</td><td style="${S.td}"><b>${email}</b></td></tr>
       <tr><td style="${S.td};color:#5c6670">Password</td><td style="${S.td}"><b style="${S.mono}">${password}</b></td></tr>
     </table>
     ${link}
     <p style="font-size:12px;color:#5c6670">You can change this password after signing in (Settings &rarr; Change my password).</p>`
  );
  await send([email], '[ShipClock] Your dashboard access', html);
}

async function sendTest(recipients) {
  await send(
    recipients,
    '✅ ShipClock test email',
    shell('Test email', 'SMTP is configured correctly. Alerts will arrive at this address.', '<p style="font-size:13px">Nothing to do — this is only a delivery test.</p>')
  );
}

module.exports = { sendOverdue, sendAtRisk, sendCarrierDelayed, sendStockIssue, sendMissing, sendDailySummary, sendWeeklyScorecard, sendWelcome, sendTest };
