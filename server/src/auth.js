const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { DateTime } = require('luxon');
const { db } = require('./db');
const mailer = require('./mailer');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  is_admin INTEGER DEFAULT 0,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER,
  expires_at TEXT
);
`);

// Seed the first admin account if no users exist yet.
// Change this password after first login (Settings -> Change my password).
const SEED_EMAIL = 'rohan@rohanofficial.com';
const SEED_PASS = 'IlovemymotheR92@';
if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 0) {
  db.prepare('INSERT INTO users (email, pass_hash, is_admin, created_at) VALUES (?, ?, 1, ?)').run(
    SEED_EMAIL.toLowerCase(),
    bcrypt.hashSync(SEED_PASS, 10),
    DateTime.utc().toISO()
  );
  console.log(`Seeded admin user ${SEED_EMAIL}`);
}

const SESSION_DAYS = 30;

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    userId,
    DateTime.utc().plus({ days: SESSION_DAYS }).toISO()
  );
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(DateTime.utc().toISO());
  return token;
}

function userForToken(token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`
    )
    .get(token, DateTime.utc().toISO());
  return row || null;
}

// Middleware: every /api route (except /api/auth/login) requires a valid session.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const user = userForToken(token);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  req.user = user;
  req.token = token;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) return res.status(403).json({ error: 'Admin only' });
  next();
}

const router = express.Router();

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.pass_hash)) {
    return res.status(401).json({ error: 'Wrong email or password' });
  }
  const token = createSession(user.id);
  res.json({ token, email: user.email, isAdmin: !!user.is_admin });
});

router.post('/logout', requireAuth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ email: req.user.email, isAdmin: !!req.user.is_admin });
});

router.post('/change-password', requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  if (!next || String(next).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current || '', user.pass_hash)) {
    return res.status(401).json({ error: 'Current password is wrong' });
  }
  db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(bcrypt.hashSync(next, 10), req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(req.user.id, req.token);
  res.json({ ok: true });
});

// ---- Team management (admin only) ----
router.get('/users', requireAuth, requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT id, email, is_admin, created_at FROM users ORDER BY id').all();
  res.json(rows.map((r) => ({ id: r.id, email: r.email, isAdmin: !!r.is_admin, createdAt: r.created_at })));
});

router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  const { email, password, isAdmin } = req.body || {};
  const em = String(email || '').trim().toLowerCase();
  if (!em || !em.includes('@')) return res.status(400).json({ error: 'Valid email required' });
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(em)) {
    return res.status(400).json({ error: 'That email already has an account' });
  }
  db.prepare('INSERT INTO users (email, pass_hash, is_admin, created_at) VALUES (?, ?, ?, ?)').run(
    em,
    bcrypt.hashSync(String(password), 10),
    isAdmin ? 1 : 0,
    DateTime.utc().toISO()
  );
  let emailSent = false;
  let emailError = null;
  try {
    const origin = req.headers.origin || req.headers.referer || '';
    await mailer.sendWelcome(em, String(password), origin.replace(/\/$/, ''));
    emailSent = true;
  } catch (e) {
    emailError = e.message;
  }
  res.json({ ok: true, emailSent, emailError });
});

router.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.user.id) return res.status(400).json({ error: "You can't delete your own account" });
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.is_admin) {
    const admins = db.prepare('SELECT COUNT(*) c FROM users WHERE is_admin = 1').get().c;
    if (admins <= 1) return res.status(400).json({ error: 'Cannot delete the last admin' });
  }
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = { router, requireAuth };
