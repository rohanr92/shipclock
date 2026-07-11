# ShipClock — Mirakl → Shopify 48h Ship SLA Monitor

Watches every Shopify order imported from Mirakl (Nordstrom, Macy's, Kohl's, JCPenney, Debenhams) and emails your team when an order is not **in transit with the carrier** within **48 business hours** (Saturday and Sunday excluded). A label alone does not count — the carrier must have scanned the package (Shopify fulfillment status `IN_TRANSIT` or later).

It also cross-checks both directions: if an active order exists on a Mirakl marketplace but no Shopify order carries that Mirakl order ID (the import bridge missed it), you get an email naming the marketplace.

## What it does every 15 minutes

1. Pulls recent Shopify orders (GraphQL Admin API) and keeps only Mirakl-imported ones — detected from the `mirakl_order_id` note attribute or the "Mirakl order XXXX (Nordstrom - ...)" note text.
2. Computes each order's deadline: order time + 48 business hours in America/New_York, skipping Sat/Sun entirely.
3. Reads carrier status from Shopify fulfillments. `LABEL_PURCHASED` / `LABEL_PRINTED` / `CONFIRMED` = **not shipped**. `IN_TRANSIT`, `OUT_FOR_DELIVERY`, `DELIVERED`, `PICKED_UP` = shipped.
4. Emails all recipients when:
   - 🔴 **Overdue** — past deadline, not in transit (repeats every 12h until resolved)
   - 🟠 **At risk** — inside the final 8h window (optional, once)
   - 🟣 **Missing in Shopify** — order on a Mirakl marketplace with no matching Shopify order after a 3h grace period
   Emails include product name, size/variant, SKU, qty, Shopify order number + ID, Mirakl order ID, marketplace, placed time, deadline, and how late it is.
5. Serves a live dashboard with countdown rails (weekends shown hatched = clock paused), filters by marketplace/status, alert log, and live-editable settings.

## Setup

Requirements: Node 18+.

```bash
cd server
cp .env.example .env     # fill in credentials (see below)
npm install
cd ../client
npm install
npm run build            # builds the dashboard into client/dist
cd ../server
npm start                # dashboard at http://localhost:4780
```

### Credentials

**Shopify** — Admin → Settings → Apps → Develop apps → create app with scopes `read_orders`, `read_fulfillments`. Put the store domain and `shpat_...` token in `.env`.

**Mirakl (each marketplace)** — Seller portal → profile menu (top right) → **API key**. The URL is the seller portal domain, e.g. `https://nordstrom-prod.mirakl.net`, `https://macys-prod.mirakl.net`, `https://kohls-prod.mirakl.net`, `https://jcpenney-prod.mirakl.net`. Only filled-in platforms are polled; leave the rest blank.

**Email (SMTP)** — any SMTP works. Gmail: enable 2FA → create an App Password → host `smtp.gmail.com`, port 587. Amazon SES / Resend / Zoho SMTP also work. Recipients go in `ALERT_EMAILS` (comma separated) and can be changed live in the dashboard Settings tab. Use "Send test email" there to verify.

### Deploying (Railway / VPS)

- **Railway**: push this folder to a repo, set root to `server`, add a build step `cd ../client && npm install && npm run build`, or simply commit `client/dist`. Set all env vars in Railway. Add a volume or accept that `shipclock.db` resets on redeploy (alerts may re-send once — dedupe rebuilds itself).
- **VPS (pm2)**: `pm2 start server/src/index.js --name shipclock`.

## Important behavior notes

- **"In transit" depends on Shopify recognizing the carrier.** With USPS/UPS/FedEx labels (Shopify Shipping, PirateShip with correct carrier name) Shopify tracks scan events and moves the fulfillment to `IN_TRANSIT` automatically. If a tracking number is entered with an unrecognized carrier, Shopify may never report transit and the order will alert as unshipped — which is arguably what you want, but be aware.
- **Weekend math**: an order placed Friday 3pm is due Tuesday 3pm. An order placed Saturday starts its clock Monday 00:00.
- **Dedup / repeats**: overdue alerts repeat every `repeat_hours` (default 12) until the order goes in transit. At-risk alerts send once. Missing-in-Shopify alerts respect the grace period, then repeat on the same interval until matched.
- All thresholds (SLA hours, at-risk window, repeat interval, grace period, lookback window, recipients) are editable in the dashboard without restarting.

## Development

```bash
# terminal 1
cd server && npm run dev
# terminal 2 (hot-reload dashboard on :5173, proxies /api to :4780)
cd client && npm run dev
```
