const path = require('path');
const express = require('express');
const cron = require('node-cron');
const config = require('./config');
const routes = require('./routes');
const auth = require('./auth');
const { runPoll, runDailySummary } = require('./poller');

const app = express();
app.use(express.json());
app.use('/api/auth', auth.router);
app.use('/api', auth.requireAuth, routes);

// Serve the built dashboard (client/dist) in production
const dist = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(dist));
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(dist, 'index.html'), (err) => {
    if (err) res.status(200).send('ShipClock API running. Build the client (cd client && npm run build) for the dashboard.');
  });
});

app.listen(config.PORT, () => {
  console.log(`ShipClock listening on http://localhost:${config.PORT}`);
  console.log(`Polling every ${config.POLL_MINUTES} min · TZ ${config.TZ}`);
  console.log(`Mirakl platforms configured: ${config.miraklPlatforms().map((p) => p.label).join(', ') || 'none'}`);
});

// Poll on boot (small delay), then on schedule
setTimeout(() => {
  runPoll('boot').then(
    (d) => console.log('[poll:boot]', JSON.stringify(d)),
    (e) => console.error('[poll:boot] failed:', e.message)
  );
}, 4000);

cron.schedule(`*/${config.POLL_MINUTES} * * * *`, () => {
  runPoll('cron').then(
    (d) => console.log('[poll]', JSON.stringify(d)),
    (e) => console.error('[poll] failed:', e.message)
  );
});

// Daily morning summary at 8:00 AM in the configured timezone (Florida/ET by default)
cron.schedule('0 8 * * *', () => {
  runDailySummary('cron').then(
    (d) => console.log('[summary]', JSON.stringify(d)),
    (e) => console.error('[summary] failed:', e.message)
  );
}, { timezone: config.TZ });
