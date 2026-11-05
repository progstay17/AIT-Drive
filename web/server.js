'use strict';
// AIT Drive - web gateway (deploy on Coolify). Files and accounts live on the PC agent.
//
// Who can log in:
//   * the OWNER  = ADMIN_USER / ADMIN_PASSWORD from the environment (always works, cannot be locked out)
//   * accounts created in the admin panel, verified by the agent (stored on the PC)
const express = require('express');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const path = require('path');

const PORT = parseInt(process.env.PORT || '3000', 10);
const ADMIN_USER = process.env.ADMIN_USER || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const AGENT_URL = (process.env.AGENT_URL || '').replace(/\/+$/, '');
const AGENT_TOKEN = process.env.AGENT_TOKEN || '';
const COOKIE_SECURE = (process.env.COOKIE_SECURE || 'true') === 'true';
const SESSION_HOURS = parseInt(process.env.SESSION_HOURS || '168', 10);
const OWNER_ID = '_owner';

for (const [k, v] of Object.entries({ ADMIN_USER, ADMIN_PASSWORD, SESSION_SECRET, AGENT_URL, AGENT_TOKEN })) {
  if (!v) { console.error(`Missing env var: ${k}`); process.exit(1); }
}
if (SESSION_SECRET.length < 32) { console.error('SESSION_SECRET must be at least 32 characters'); process.exit(1); }

const agent = new URL(AGENT_URL);
const agentLib = agent.protocol === 'https:' ? https : http;
const agentPort = agent.port || (agent.protocol === 'https:' ? 443 : 80);
const agentBase = agent.pathname.replace(/\/$/, '');
const MSG_OFFLINE = 'PC tidak terjangkau. Pastikan PC dan agent menyala.';
const MSG_TOKEN = 'Token agent tidak cocok. Samakan AGENT_TOKEN di web dengan agent.env.';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// ---------- helpers ----------
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
function makeToken(payload) {
  const body = b64u(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}
function readToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const exp = sign(body);
  const a = Buffer.from(sig), b = Buffer.from(exp);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
// session payloads: { u: id, tv, exp }  or  owner { u: '_owner', o: 1, n: name, exp }
const sessionOf = (req) => {
  const p = readToken(parseCookies(req).sid);
  return p && p.u && p.k !== 'share' ? p : null;
};
function userHeaders(s) {
  const h = { 'X-AIT-User': String(s.u), 'X-AIT-TV': String(s.tv == null ? '' : s.tv) };
  if (s.o) { h['X-AIT-Owner'] = '1'; h['X-AIT-Name'] = encodeURIComponent(s.n || ADMIN_USER); }
  return h;
}
function setSessionCookie(res, payload) {
  res.setHeader('Set-Cookie',
    `sid=${encodeURIComponent(makeToken(payload))}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}${COOKIE_SECURE ? '; Secure' : ''}`);
}

// ---------- security headers ----------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; frame-src 'self'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; " +
    "script-src 'self'; connect-src 'self'; object-src 'self'; base-uri 'none'; form-action 'self'");
  next();
});

// ---------- talking to the agent ----------
function agentJson(method, agentPath, sess, body, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = { Authorization: `Bearer ${AGENT_TOKEN}`, ...(sess ? userHeaders(sess) : {}) };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = payload.length; }
    const r = agentLib.request({ protocol: agent.protocol, hostname: agent.hostname, port: agentPort, method, path: agentBase + agentPath, headers, timeout: timeoutMs }, (ur) => {
      let d = '';
      ur.on('data', (c) => (d += c));
      ur.on('end', () => {
        let json = null;
        try { json = JSON.parse(d); } catch {}
        resolve({ status: ur.statusCode, json, reason: ur.headers['x-ait-reason'] || '' });
      });
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

const FWD_REQ = ['content-type', 'content-length', 'range', 'if-range', 'if-none-match', 'if-modified-since'];
const FWD_RES = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition', 'etag', 'last-modified', 'cache-control'];

// stream a request/response through to the agent on behalf of a session
function proxy(req, res, sess, agentPath, query) {
  const qs = query && Object.keys(query).length ? '?' + new URLSearchParams(query).toString() : '';
  const headers = { Authorization: `Bearer ${AGENT_TOKEN}`, ...userHeaders(sess) };
  for (const h of FWD_REQ) if (req.headers[h]) headers[h] = req.headers[h];
  const up = agentLib.request({
    protocol: agent.protocol, hostname: agent.hostname, port: agentPort,
    method: req.method, path: agentBase + agentPath + qs, headers, timeout: 0,
  }, (ur) => {
    // 401 from the agent: bad shared token (our misconfiguration) vs. this person's session is no longer valid
    if (ur.statusCode === 401 && ur.headers['x-ait-reason'] !== 'session') {
      ur.resume();
      return res.status(502).json({ error: MSG_TOKEN });
    }
    // agent answered with an error before the whole upload was sent (e.g. 413 quota):
    // drain the rest of the client's body so the browser gets the message instead of a reset connection
    if (ur.statusCode >= 400 && !req.complete) { req.unpipe(up); req.resume(); }
    res.status(ur.statusCode);
    for (const h of FWD_RES) if (ur.headers[h]) res.setHeader(h, ur.headers[h]);
    ur.pipe(res);
  });
  up.on('error', () => {
    if (!res.headersSent) res.status(502).json({ error: MSG_OFFLINE });
    else res.destroy();
  });
  res.on('close', () => up.destroy());
  req.pipe(up);
}

// small JSON request through to the agent (body already parsed)
function sendJson(req, res, method, agentPath, body, query) {
  agentJson(method, agentPath + (query && Object.keys(query).length ? '?' + new URLSearchParams(query).toString() : ''), req.sess, body)
    .then(({ status, json, reason }) => {
      if (status === 401 && reason !== 'session') return res.status(502).json({ error: MSG_TOKEN });
      res.status(status).json(json || {});
    })
    .catch(() => res.status(502).json({ error: MSG_OFFLINE }));
}

// ---------- auth ----------
const fails = new Map(); // ip -> {n, until}
function rateLimited(ip) {
  const f = fails.get(ip);
  return f && f.n >= 5 && f.until > Date.now();
}
function noteFail(ip) {
  const f = fails.get(ip);
  if (!f || f.until < Date.now()) fails.set(ip, { n: 1, until: Date.now() + 15 * 60 * 1000 });
  else f.n++;
}

app.post('/auth/login', express.json({ limit: '10kb' }), async (req, res) => {
  const ip = req.ip;
  if (rateLimited(ip)) return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi nanti.' });
  const username = typeof (req.body || {}).username === 'string' ? req.body.username.trim() : '';
  const password = typeof (req.body || {}).password === 'string' ? req.body.password : '';
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;

  // 1) owner from the environment
  const nameIsOwner = safeEqual(username, ADMIN_USER);
  const ownerOk = (safeEqual(username, ADMIN_USER) & safeEqual(password, ADMIN_PASSWORD)) === 1;
  if (ownerOk) {
    fails.delete(ip);
    setSessionCookie(res, { u: OWNER_ID, o: 1, n: ADMIN_USER, exp });
    return res.json({ ok: true });
  }
  if (nameIsOwner) { noteFail(ip); return res.status(401).json({ error: 'Username atau password salah.' }); }

  // 2) accounts created in the admin panel (checked by the agent on the PC)
  try {
    const r = await agentJson('POST', '/admin/verify', null, { username, password });
    if (r.status === 401 && r.reason === 'token') return res.status(502).json({ error: MSG_TOKEN });
    if (r.status === 200 && r.json && r.json.id) {
      fails.delete(ip);
      setSessionCookie(res, { u: r.json.id, tv: r.json.tv, exp });
      return res.json({ ok: true });
    }
    if (r.status === 403) return res.status(403).json({ error: (r.json && r.json.error) || 'Akun dinonaktifkan.' });
    noteFail(ip);
    return res.status(401).json({ error: 'Username atau password salah.' });
  } catch {
    return res.status(502).json({ error: MSG_OFFLINE }); // PC off: not the user's fault, no rate-limit penalty
  }
});
app.post('/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', `sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${COOKIE_SECURE ? '; Secure' : ''}`);
  res.json({ ok: true });
});
app.get('/auth/me', (req, res) => res.json({ authenticated: !!sessionOf(req) }));

function requireAuth(req, res, next) {
  const s = sessionOf(req);
  if (!s) return res.status(401).json({ error: 'unauthenticated' });
  // CSRF: state-changing requests must carry a custom header (cannot be set cross-site without CORS)
  if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'drive') {
    return res.status(403).json({ error: 'forbidden' });
  }
  req.sess = s;
  next();
}

// ---------- API ----------
const api = express.Router();
api.use(requireAuth);
const json1 = express.json({ limit: '1mb' });

api.get('/status', async (req, res) => {
  try { const r = await agentJson('GET', '/health', null, undefined, 4000); res.json({ agent: !!(r.json && r.json.ok) }); }
  catch { res.json({ agent: false }); }
});
api.get('/me', (req, res) => sendJson(req, res, 'GET', '/me'));
api.post('/me/password', json1, (req, res) => sendJson(req, res, 'POST', '/me/password', req.body));

api.get('/list', (req, res) => proxy(req, res, req.sess, '/list', { path: req.query.path || '' }));
api.get('/stats', (req, res) => proxy(req, res, req.sess, '/stats'));
api.get('/search', (req, res) => proxy(req, res, req.sess, '/search', { q: req.query.q || '' }));
api.get('/download', (req, res) => {
  const q = { path: req.query.path || '' };
  if (req.query.inline === '1') q.inline = '1';
  proxy(req, res, req.sess, '/download', q);
});
api.post('/upload', (req, res) => proxy(req, res, req.sess, '/upload', { path: req.query.path || '' }));
for (const op of ['mkdir', 'rename', 'move', 'delete']) {
  api.post('/' + op, json1, (req, res) => sendJson(req, res, 'POST', '/' + op, req.body));
}
api.post('/trash/empty', json1, (req, res) => sendJson(req, res, 'POST', '/trash/empty', {}));

// admin panel: the agent decides whether this session may do it (role admin/owner)
api.use('/admin', json1, (req, res) => {
  if (req.method === 'POST' && req.path === '/users') {
    const wanted = String((req.body || {}).username || '').trim().toLowerCase();
    if (wanted && wanted === ADMIN_USER.trim().toLowerCase()) {
      return res.status(400).json({ error: 'Username itu dipakai oleh akun owner. Pilih username lain.' });
    }
  }
  const hasBody = req.method !== 'GET' && req.method !== 'DELETE';
  sendJson(req, res, req.method, '/admin' + req.path, hasBody ? req.body : undefined, req.query);
});

// share links: signed, expiring, read-only download of one file, tied to the account that made it
api.post('/share', json1, async (req, res) => {
  const p = String((req.body || {}).path || '');
  const days = Math.min(Math.max(parseInt((req.body || {}).days || '7', 10) || 7, 1), 30);
  if (!p) return res.status(400).json({ error: 'path required' });
  try {
    const me = await agentJson('GET', '/me', req.sess);
    if (me.status === 401 && me.reason !== 'session') return res.status(502).json({ error: MSG_TOKEN });
    if (me.status !== 200) return res.status(me.status).json(me.json || {});
    if (!(me.json.perms && me.json.perms.share)) return res.status(403).json({ error: 'Akun kamu tidak punya izin untuk membagikan link.' });
  } catch { return res.status(502).json({ error: MSG_OFFLINE }); }
  const token = makeToken({ k: 'share', p, u: req.sess.u, tv: req.sess.tv, o: req.sess.o ? 1 : 0, exp: Date.now() + days * 86400000 });
  res.json({ url: `${req.protocol}://${req.get('host')}/s/${token}`, days });
});
app.use('/api', api);

app.get('/s/:token', (req, res) => {
  const p = readToken(req.params.token);
  if (!p || p.k !== 'share') return res.status(404).send('Link tidak valid atau sudah kedaluwarsa.');
  proxy(req, res, { u: p.u, tv: p.tv, o: p.o, n: ADMIN_USER }, '/download', { path: p.p });
});

// ---------- static UI ----------
app.use(express.static(path.join(__dirname, 'public'), {
  index: 'index.html',
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'), // always revalidate (ETag) so UI updates show immediately
}));

// tanpa host: dual-stack (IPv4 dan IPv6), supaya "localhost" milik healthcheck Coolify (bisa ::1) juga terjangkau
app.listen(PORT, () => console.log(`Web listening on :${PORT}  agent=${AGENT_URL}`));
