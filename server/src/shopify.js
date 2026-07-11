const { DateTime } = require('luxon');
const config = require('./config');

// Shipment has genuinely left / progressed with the carrier.
// Anything below this (LABEL_PURCHASED, LABEL_PRINTED, CONFIRMED, SUBMITTED,
// FULFILLED, MARKED_AS_FULFILLED) counts as "label only", not shipped.
const IN_TRANSIT_STATUSES = new Set([
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'ATTEMPTED_DELIVERY',
  'DELIVERED',
  'PICKED_UP',
  'READY_FOR_PICKUP',
]);

// Carrier has the package but reported a delay. Counts as shipped (SLA met),
// but is surfaced separately with its own alert email.
const DELAYED_STATUSES = new Set(['DELAYED']);

const ORDERS_QUERY = `
query Orders($cursor: String, $q: String) {
  orders(first: 50, after: $cursor, query: $q, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      legacyResourceId
      name
      createdAt
      cancelledAt
      note
      customAttributes { key value }
      displayFulfillmentStatus
      lineItems(first: 25) {
        nodes {
          title quantity sku variantTitle
          variant { inventoryQuantity inventoryItem { tracked } }
        }
      }
      fulfillments(first: 10) {
        displayStatus
        createdAt
        trackingInfo(first: 5) { company number url }
      }
    }
  }
}`;

async function gql(query, variables) {
  if (!config.SHOPIFY_STORE || !config.SHOPIFY_TOKEN) {
    throw new Error('SHOPIFY_STORE / SHOPIFY_ADMIN_TOKEN not configured');
  }
  const url = `https://${config.SHOPIFY_STORE}/admin/api/${config.SHOPIFY_API_VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': config.SHOPIFY_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`Shopify GraphQL: ${JSON.stringify(json.errors)}`);
  return json.data;
}

function attr(node, keyLike) {
  const hit = (node.customAttributes || []).find(
    (a) => a.key && a.key.toLowerCase().replace(/[\s_-]/g, '') === keyLike
  );
  return hit ? hit.value : null;
}

// Extract Mirakl order id + channel from note attributes or the order note text.
function parseMirakl(node) {
  let miraklId = attr(node, 'miraklorderid') || attr(node, 'miraklid');
  let channel = config.normalizeChannel(attr(node, 'channel'));

  const note = node.note || '';
  if (!miraklId) {
    const m = note.match(/Mirakl order[:\s]+([A-Za-z0-9][A-Za-z0-9-]{4,})/i);
    if (m) miraklId = m[1];
  }
  if (!channel) {
    const m = note.match(/\(([^)]+)\)/); // e.g. "(Nordstrom - Menina Step)"
    channel = config.normalizeChannel(m ? m[1] : note);
  }
  return { miraklId, channel };
}

function shipState(node) {
  const fulfillments = node.fulfillments || [];
  if (fulfillments.length === 0) return { state: 'unfulfilled', display: null, tracking: [] };

  let best = 'label_created';
  let display = null;
  const tracking = [];
  for (const f of fulfillments) {
    if (IN_TRANSIT_STATUSES.has(f.displayStatus)) {
      best = 'in_transit';
      display = f.displayStatus;
    } else if (DELAYED_STATUSES.has(f.displayStatus)) {
      if (best !== 'in_transit') { best = 'delayed'; display = f.displayStatus; }
    } else if (f.displayStatus && !display) {
      display = f.displayStatus;
    }
    for (const t of f.trackingInfo || []) {
      tracking.push({ company: t.company, number: t.number, url: t.url });
    }
  }
  return { state: best, display, tracking };
}

// Fetch all orders created in the lookback window; return only Mirakl-imported ones.
async function fetchMiraklShopifyOrders(lookbackDays) {
  const since = DateTime.utc().minus({ days: lookbackDays }).toISODate();
  const q = `created_at:>=${since}`;
  const results = [];
  let cursor = null;
  let pages = 0;

  do {
    const data = await gql(ORDERS_QUERY, { cursor, q });
    const conn = data.orders;
    for (const node of conn.nodes) {
      const { miraklId, channel } = parseMirakl(node);
      if (!miraklId) continue; // not a Mirakl-imported order
      const ship = shipState(node);
      results.push({
        orderKey: node.id,
        legacyId: node.legacyResourceId,
        name: node.name,
        createdAt: node.createdAt,
        cancelled: !!node.cancelledAt,
        channel: channel || 'unknown',
        miraklOrderId: miraklId,
        products: (node.lineItems?.nodes || []).map((li) => ({
          title: li.title,
          variant: li.variantTitle,
          sku: li.sku,
          qty: li.quantity,
          stock: li.variant ? li.variant.inventoryQuantity : null,
          tracked: li.variant?.inventoryItem?.tracked ?? false,
        })),
        shipState: ship.state,
        displayStatus: ship.display,
        tracking: ship.tracking,
      });
    }
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
    pages += 1;
  } while (cursor && pages < 40);

  return results;
}

module.exports = { fetchMiraklShopifyOrders, IN_TRANSIT_STATUSES, DELAYED_STATUSES };
