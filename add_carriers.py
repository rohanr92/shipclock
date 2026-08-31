import io, sys

def patch(path, pairs):
    s = io.open(path, encoding='utf-8').read()
    for old, new in pairs:
        if old not in s:
            print(f'FAILED in {path}: {old[:90]}'); sys.exit(1)
        s = s.replace(old, new)
    io.open(path, 'w', encoding='utf-8').write(s)
    print(f'patched {path}')

patch('server/src/db.js', [
("""// Migration: delivered_at timestamp (stamped when a fulfillment first shows DELIVERED)
try { db.exec('ALTER TABLE orders ADD COLUMN delivered_at TEXT'); } catch (e) {}""",
"""// Migration: delivered_at timestamp (stamped when a fulfillment first shows DELIVERED)
try { db.exec('ALTER TABLE orders ADD COLUMN delivered_at TEXT'); } catch (e) {}
// Migration: latest direct-carrier tracking status (USPS/UPS/FedEx)
try { db.exec('ALTER TABLE orders ADD COLUMN carrier_status TEXT'); } catch (e) {}"""),
])

patch('server/src/poller.js', [
("""const scorecard = require('./scorecard');""",
"""const scorecard = require('./scorecard');
const carriers = require('./carriers');"""),
("""                    stock_issue, delivered_at, first_seen, updated_at)
VALUES (@order_key, @name, @legacy_id, @created_at, @channel, @mirakl_order_id, @products,
        @ship_state, @display_status, @tracking, @deadline, @cancelled, @sla_met, @sla_met_at,
        @stock_issue, @delivered_at, @now, @now)""",
"""                    stock_issue, delivered_at, carrier_status, first_seen, updated_at)
VALUES (@order_key, @name, @legacy_id, @created_at, @channel, @mirakl_order_id, @products,
        @ship_state, @display_status, @tracking, @deadline, @cancelled, @sla_met, @sla_met_at,
        @stock_issue, @delivered_at, @carrier_status, @now, @now)"""),
("""  delivered_at = COALESCE(orders.delivered_at, excluded.delivered_at),
  updated_at = excluded.updated_at""",
"""  delivered_at = COALESCE(orders.delivered_at, excluded.delivered_at),
  carrier_status = COALESCE(excluded.carrier_status, orders.carrier_status),
  updated_at = excluded.updated_at"""),
("""async function syncShopify(settings, now) {
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
    }""",
"""async function syncShopify(settings, now) {
  const orders = await shopify.fetchMiraklShopifyOrders(settings.lookbackDays);
  const nowISO = now.toISO();
  let carrierLookups = 0;
  const CARRIER_LOOKUP_CAP = 60; // per poll, safety valve

  for (const o of orders) {
    const existing = db.prepare('SELECT sla_met, sla_met_at FROM orders WHERE order_key = ?').get(o.orderKey);
    let slaMet = existing ? existing.sla_met : null;
    let slaMetAt = existing ? existing.sla_met_at : null;

    const deadline = addBusinessHours(o.createdAt, settings.slaHours);

    // Shopify often lags carrier scans by days. If a label exists but Shopify
    // shows no scan, ask USPS/UPS/FedEx directly - a physical scan counts as shipped.
    let carrierInfo = null;
    if (
      o.shipState === 'label_created' &&
      !o.cancelled &&
      slaMet === null &&
      o.tracking.length &&
      carriers.anyConfigured() &&
      carrierLookups < CARRIER_LOOKUP_CAP
    ) {
      carrierLookups += 1;
      carrierInfo = await carriers.firstScan(o.tracking);
      if (carrierInfo && carrierInfo.scanned) {
        o.shipState = 'in_transit';
        o.displayStatus = 'IN_TRANSIT';
      }
    }

    const shipped = o.shipState === 'in_transit' || o.shipState === 'delayed';
    if (shipped && slaMet !== 1 && slaMet !== 0) {
      // First time we see it with the carrier. Prefer the carrier's real scan
      // timestamp over our poll time - it's what actually happened.
      const shipAt = carrierInfo && carrierInfo.scanTime ? carrierInfo.scanTime : nowISO;
      slaMet = shipAt <= deadline ? 1 : 0;
      slaMetAt = shipAt;
    }"""),
("""      stock_issue: stockIssue,
      delivered_at: o.displayStatus === 'DELIVERED' ? nowISO : null,
      now: nowISO,
    });""",
"""      stock_issue: stockIssue,
      delivered_at: o.displayStatus === 'DELIVERED' ? nowISO : null,
      carrier_status: carrierInfo ? carrierInfo.summary : null,
      now: nowISO,
    });"""),
])

patch('server/src/routes.js', [
("""      sla,
      stockIssue: !!r.stock_issue,
    };""",
"""      sla,
      stockIssue: !!r.stock_issue,
      carrierStatus: r.carrier_status || null,
    };"""),
])

patch('client/src/components/Orders.jsx', [
("""                <td className="px-4 py-3">
                  <div className="font-display font-semibold">{o.name}</div>
                  <div className="font-mono text-[11px] text-muted">{o.displayStatus || o.shipState}</div>
                </td>""",
"""                <td className="px-4 py-3">
                  <div className="font-display font-semibold">{o.name}</div>
                  <div className="font-mono text-[11px] text-muted">{o.displayStatus || o.shipState}</div>
                  {o.carrierStatus && (
                    <div className="mt-0.5 max-w-[220px] font-mono text-[10px] text-muted">{o.carrierStatus}</div>
                  )}
                </td>"""),
])
print('CARRIERS OK')
