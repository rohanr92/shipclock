const { DateTime } = require('luxon');

// States where an order exists and should be flowing into Shopify.
// WAITING_ACCEPTANCE = brand-new order, SHIPPING = accepted / awaiting shipment.
const ACTIVE_STATES = ['WAITING_ACCEPTANCE', 'SHIPPING'];

// GET /api/orders (OR11) — same shape on every Mirakl marketplace
// (Nordstrom, Macy's, Kohl's, JCPenney, Debenhams).
async function fetchPlatformOrders(platform, lookbackDays) {
  const startDate = DateTime.utc().minus({ days: lookbackDays }).toISO();
  const out = [];
  let offset = 0;
  const max = 100;

  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({
      start_date: startDate,
      max: String(max),
      offset: String(offset),
      order_state_codes: ACTIVE_STATES.join(','),
    });
    const res = await fetch(`${platform.url}/api/orders?${params}`, {
      headers: { Authorization: platform.key, Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`${platform.label} Mirakl HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const json = await res.json();
    const orders = json.orders || [];
    for (const o of orders) {
      out.push({
        miraklOrderId: o.order_id,
        commercialId: o.commercial_id,
        channel: platform.id,
        state: o.order_state,
        createdDate: o.created_date,
        customer: o.customer ? `${o.customer.firstname || ''} ${o.customer.lastname || ''}`.trim() : '',
        products: (o.order_lines || []).map((l) => ({
          title: l.product_title,
          sku: l.offer_sku || l.product_sku,
          qty: l.quantity,
        })),
      });
    }
    if (orders.length < max) break;
    offset += max;
  }
  return out;
}

module.exports = { fetchPlatformOrders, ACTIVE_STATES };
