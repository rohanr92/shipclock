export function getToken() { return localStorage.getItem('shipclock_token'); }
export function setToken(t) { t ? localStorage.setItem('shipclock_token', t) : localStorage.removeItem('shipclock_token'); }

export async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) {
    const err = new Error('unauthorized');
    err.unauthorized = true;
    throw err;
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export const CHANNEL_COLORS = {
  nordstrom: { bg: '#EAEDF4', fg: '#1F2A44' },
  macys: { bg: '#F9E7EB', fg: '#A81C36' },
  kohls: { bg: '#EFE9FA', fg: '#5B21B6' },
  jcpenney: { bg: '#F7EDDF', fg: '#92400E' },
  debenhams: { bg: '#E3F2EF', fg: '#0F766E' },
  unknown: { bg: '#EEF0EF', fg: '#5C6670' },
};

export function fmtCountdown(minutesLeft) {
  const m = Math.abs(Math.round(minutesLeft));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const s = h > 0 ? `${h}h ${mm}m` : `${mm}m`;
  return minutesLeft <= 0 ? `overdue ${s}` : `${s} left`;
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

// Weekend spans (as % of the created->deadline window) for the SLA rail.
export function weekendSegments(createdAt, deadline) {
  const start = new Date(createdAt).getTime();
  const end = new Date(deadline).getTime();
  const total = end - start;
  if (total <= 0) return [];
  const segs = [];
  let cur = null;
  const stepMs = 30 * 60 * 1000;
  for (let t = start; t <= end; t += stepMs) {
    const day = new Date(t).getDay(); // 0 Sun, 6 Sat
    const weekend = day === 0 || day === 6;
    if (weekend && cur === null) cur = t;
    if (!weekend && cur !== null) {
      segs.push([((cur - start) / total) * 100, ((t - start) / total) * 100]);
      cur = null;
    }
  }
  if (cur !== null) segs.push([((cur - start) / total) * 100, 100]);
  return segs;
}
