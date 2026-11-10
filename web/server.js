'use strict';
// AIT Drive - web gateway (deploy on Coolify).
//
// Coolify is the server: login, accounts, quotas, permissions and the admin panel live here
// (DATA_DIR/users.json, a persistent volume). The PC agent only stores files and enforces the
// quota/permissions that this gateway tells it, per request.
//
// Who can log in:
//   * the OWNER  = ADMIN_USER / ADMIN_PASSWORD from the environment (cannot be locked out)
//   * accounts created in the admin panel (stored here, scrypt hashes)
const express = require('express');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const path = require('path');
const acc = require('./accounts');

const PORT = parseInt(process.env.PORT || '3000', 10);
const ADMIN_USER = process.env.ADMIN_USER || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const AGENT_URL = (process.env.AGENT_URL || '').replace(/\/+$/, '');
const AGENT_TOKEN = process.env.AGENT_TOKEN || '';
const COOKIE_SECURE = (process.env.COOKIE_SECURE || 'true') === 'true';
const SESSION_HOURS = parseInt(process.env.SESSION_HOURS || '168', 10);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const ALLOW_OVERBOOK = (process.env.ALLOW_OVERBOOK || 'false') === 'true';
const OWNER_ID = '_owner';

for (const [k, v] of Object.entries({ ADMIN_USER, ADMIN_PASSWORD, SESSION_SECRET, AGENT_URL, AGENT_TOKEN })) {
  if (!v) { console.error(`Missing env var: ${k}`); process.exit(1); }
}
if (SESSION_SECRET.length < 32) { console.error('SESSION_SECRET must be at least 32 characters'); process.exit(1); }

const { db, save: saveDb } = acc.openStore(DATA_DIR);
const { httpError, USER_RE, RESERVED_RE, ALL_PERMS, fmtBytes } = acc;
db.nodes.primary = { id: 'primary', name: (db.nodes.primary && db.nodes.primary.name) || 'Storage utama', url: AGENT_URL, token: AGENT_TOKEN, primary: true };
function getNode(id) {
  const node = db.nodes[String(id || 'primary')] || db.nodes.primary;
  return node && node.url && node.token ? node : db.nodes.primary;
}
function nodeUrl(node) { return new URL(node.url); }

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
function readToken(token, allowExpired = false) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const exp = sign(body);
  const a = Buffer.from(sig), b = Buffer.from(exp);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!p.exp || (!allowExpired && p.exp < Date.now())) return null;
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
function setSessionCookie(res, payload) {
  res.setHeader('Set-Cookie',
    `sid=${encodeURIComponent(makeToken(payload))}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}${COOKIE_SECURE ? '; Secure' : ''}`);
}

// Turns a session payload into the caller's CURRENT rights (read from the account store on every
// request, so edits to quota/permissions and disabling an account take effect immediately).
function resolveCtx(sess) {
  if (sess.o) return { ctx: { id: OWNER_ID, name: sess.n || ADMIN_USER, role: 'owner', nodeId: 'primary', quota: null, perms: { ...ALL_PERMS } } };
  const u = USER_RE.test(String(sess.u)) ? db.users[sess.u] : null;
  if (!u) return { status: 401, error: 'Akun tidak ditemukan. Silakan masuk lagi.' };
  if (!u.active) return { status: 403, error: 'Akun dinonaktifkan. Hubungi admin.' };
  if (String(u.tv) !== String(sess.tv)) return { status: 401, error: 'Sesi tidak berlaku lagi. Silakan masuk lagi.' };
  return { ctx: { id: u.id, name: u.id, role: u.role, nodeId: u.nodeId || 'primary', quota: u.quota == null ? null : u.quota, perms: u.role === 'admin' ? { ...ALL_PERMS } : { ...u.perms } } };
}

const TOKEN_SCOPES = new Set(['read', 'upload', 'modify', 'delete', 'share']);
function resolvePat(value) {
  const match = /^aitd_([A-Za-z0-9_-]{12})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match) return { status: 401, error: 'Token tidak valid.' };
  const [, id, secret] = match;
  const record = db.tokens[id];
  if (!record || record.revokedAt || (record.expiresAt && record.expiresAt <= Date.now())) return { status: 401, error: 'Token tidak valid atau sudah kedaluwarsa.' };
  const digest = crypto.createHash('sha256').update(secret).digest();
  const stored = Buffer.from(String(record.hash || ''), 'hex');
  if (stored.length !== digest.length || !crypto.timingSafeEqual(stored, digest)) return { status: 401, error: 'Token tidak valid.' };
  if (!record.lastUsedAt || Date.now() - record.lastUsedAt > 60000) {
    record.lastUsedAt = Date.now();
    saveDb().catch((e) => console.error('saveDb failed', e));
  }

  let account;
  if (record.accountId === OWNER_ID) {
    // PATs are file-client credentials only, even when minted by the owner session.
    account = { id: OWNER_ID, name: ADMIN_USER, role: 'user', nodeId: 'primary', quota: null, perms: { ...ALL_PERMS } };
  } else {
    const u = USER_RE.test(String(record.accountId)) ? db.users[record.accountId] : null;
    if (!u) return { status: 401, error: 'Akun token tidak ditemukan.' };
    if (!u.active) return { status: 403, error: 'Akun dinonaktifkan. Hubungi admin.' };
    account = { id: u.id, name: u.id, role: 'user', nodeId: u.nodeId || 'primary', quota: u.quota == null ? null : u.quota, perms: u.role === 'admin' ? { ...ALL_PERMS } : { ...u.perms } };
  }
  const perms = {};
  for (const key of Object.keys(ALL_PERMS)) perms[key] = !!account.perms[key] && record.scopes.includes(key);
  return { ctx: { ...account, perms }, record };
}
// what the agent needs to know about the caller (the agent trusts only the shared AGENT_TOKEN)
function userHeaders(c) {
  return {
    'X-AIT-User': c.id,
    'X-AIT-Quota': c.quota == null ? '' : String(c.quota),
    'X-AIT-Perms': Object.keys(c.perms).filter((k) => c.perms[k]).join(','),
  };
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
function agentJson(method, agentPath, ctx, body, timeoutMs = 8000, nodeId) {
  return new Promise((resolve, reject) => {
    const node = getNode(nodeId || (ctx && ctx.nodeId));
    const target = nodeUrl(node);
    const lib = target.protocol === 'https:' ? https : http;
    const port = target.port || (target.protocol === 'https:' ? 443 : 80);
    const base = target.pathname.replace(/\/$/, '');
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = { Authorization: `Bearer ${node.token}`, ...(ctx ? userHeaders(ctx) : {}) };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = payload.length; }
    const r = lib.request({ protocol: target.protocol, hostname: target.hostname, port, method, path: base + agentPath, headers, timeout: timeoutMs }, (ur) => {
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
// system call to the agent (no user): returns the JSON body or throws an httpError for the admin panel
async function agentCall(method, agentPath, body, nodeId = 'primary') {
  let r;
  try { r = await agentJson(method, agentPath, null, body, 8000, nodeId); }
  catch { throw httpError(502, MSG_OFFLINE); }
  if (r.status === 401) throw httpError(502, MSG_TOKEN);
  if (r.status >= 400) throw httpError(r.status, (r.json && r.json.error) || 'Agent error');
  return r.json || {};
}

const FWD_REQ = ['content-type', 'content-length', 'range', 'if-range', 'if-none-match', 'if-modified-since'];
const FWD_RES = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition', 'etag', 'last-modified', 'cache-control'];

// stream a request/response through to the agent on behalf of an account
function proxy(req, res, ctx, agentPath, query) {
  const node = getNode(ctx && ctx.nodeId);
  const target = nodeUrl(node);
  const lib = target.protocol === 'https:' ? https : http;
  const port = target.port || (target.protocol === 'https:' ? 443 : 80);
  const base = target.pathname.replace(/\/$/, '');
  const qs = query && Object.keys(query).length ? '?' + new URLSearchParams(query).toString() : '';
  const headers = { Authorization: `Bearer ${node.token}`, ...userHeaders(ctx) };
  for (const h of FWD_REQ) if (req.headers[h]) headers[h] = req.headers[h];
  const up = lib.request({
    protocol: target.protocol, hostname: target.hostname, port,
    method: req.method, path: base + agentPath + qs, headers, timeout: 0,
  }, (ur) => {
    // 401 from the agent means the shared token is wrong (our misconfiguration)
    if (ur.statusCode === 401) {
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
function sendJson(req, res, method, agentPath, body) {
  agentJson(method, agentPath, req.ctx, body)
    .then(({ status, json }) => {
      if (status === 401) return res.status(502).json({ error: MSG_TOKEN });
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

  // 2) accounts created in the admin panel (stored on this server)
  const id = username.toLowerCase();
  const u = USER_RE.test(id) ? db.users[id] : null;
  const ok = await acc.checkPw(password, u ? u.pw : await acc.dummyHash);
  if (!u || !ok) { noteFail(ip); return res.status(401).json({ error: 'Username atau password salah.' }); }
  if (!u.active) return res.status(403).json({ error: 'Akun dinonaktifkan. Hubungi admin.' });
  fails.delete(ip);
  u.lastLogin = Date.now();
  saveDb().catch((e) => console.error('saveDb failed', e));
  setSessionCookie(res, { u: u.id, tv: u.tv, exp });
  res.json({ ok: true });
});
app.post('/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', `sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${COOKIE_SECURE ? '; Secure' : ''}`);
  res.json({ ok: true });
});
app.get('/auth/me', (req, res) => res.json({ authenticated: !!sessionOf(req) }));

function requireAuth(req, res, next) {
  // An Authorization header is authoritative: never fall back to a browser cookie if it is malformed or invalid.
  if (req.headers.authorization !== undefined) {
    const match = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization));
    if (!match) return res.status(401).json({ error: 'unauthenticated' });
    const r = resolvePat(match[1]);
    if (!r.ctx) return res.status(r.status).json({ error: r.error });
    req.authType = 'pat';
    req.tokenRecord = r.record;
    req.ctx = r.ctx;
    return next();
  }
  const sess = sessionOf(req);
  if (!sess) return res.status(401).json({ error: 'unauthenticated' });
  // CSRF protection remains mandatory for cookie-authenticated state changes.
  if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'drive') {
    return res.status(403).json({ error: 'forbidden' });
  }
  const r = resolveCtx(sess);
  if (!r.ctx) return res.status(r.status).json({ error: r.error });
  req.authType = 'session';
  req.sess = sess;
  req.ctx = r.ctx;
  next();
}
function requireSessionAuth(req, res, next) {
  if (req.authType !== 'session') return res.status(403).json({ error: 'Gunakan sesi browser untuk mengelola personal access token.' });
  next();
}
function requireScope(scope) {
  return (req, res, next) => {
    if (req.authType === 'pat' && scope !== 'read' && !req.tokenRecord.scopes.includes(scope)) {
      return res.status(403).json({ error: 'Token tidak memiliki scope ' + scope + '.' });
    }
    if (req.authType === 'pat' && scope === 'read' && !req.tokenRecord.scopes.includes('read')) {
      return res.status(403).json({ error: 'Token tidak memiliki scope read.' });
    }
    next();
  };
}

// ---------- API ----------
const api = express.Router();
api.use(requireAuth);
const json1 = express.json({ limit: '1mb' });
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  if (!e.status) console.error(e);
  res.status(e.status || 500).json({ error: e.status ? e.message : 'internal error' });
});

api.post('/token/revoke-self', wrap(async (req, res) => {
  if (req.authType !== 'pat' || !req.tokenRecord) throw httpError(403, 'Endpoint ini hanya untuk mencabut PAT yang sedang digunakan.');
  delete db.tokens[req.tokenRecord.id];
  await saveDb();
  res.json({ ok: true });
}));

api.get('/tokens', requireSessionAuth, (req, res) => {
  const tokens = Object.values(db.tokens).filter((t) => t.accountId === req.ctx.id)
    .map(({ id, label, scopes, createdAt, expiresAt, revokedAt }) => ({ id, label, scopes, createdAt, expiresAt, revokedAt: revokedAt || null }));
  tokens.sort((a, b) => b.createdAt - a.createdAt);
  res.json({ tokens });
});
api.post('/tokens', requireSessionAuth, json1, wrap(async (req, res) => {
  const body = req.body || {};
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  if (!label || label.length > 80) throw httpError(400, 'Nama token wajib diisi (maksimal 80 karakter).');
  const requested = body.scopes === undefined ? ['read'] : body.scopes;
  if (!Array.isArray(requested) || requested.some((x) => typeof x !== 'string' || !TOKEN_SCOPES.has(x))) throw httpError(400, 'Daftar scope token tidak valid.');
  const scopes = [...new Set(['read', ...requested])];
  for (const scope of scopes) {
    if (scope !== 'read' && !req.ctx.perms[scope]) throw httpError(403, 'Akun tidak memiliki izin ' + scope + '.');
  }
  const days = body.expiresInDays === undefined ? 365 : Number(body.expiresInDays);
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw httpError(400, 'Masa berlaku token harus 1–3650 hari.');
  const id = b64u(crypto.randomBytes(9));
  const secret = b64u(crypto.randomBytes(32));
  const token = 'aitd_' + id + '.' + secret;
  const now = Date.now();
  db.tokens[id] = {
    id, accountId: req.ctx.id, label, scopes,
    hash: crypto.createHash('sha256').update(secret).digest('hex'),
    createdAt: now, expiresAt: now + days * 86400000,
  };
  await saveDb();
  res.status(201).json({ id, label, token, scopes, createdAt: now, expiresAt: db.tokens[id].expiresAt });
}));
api.delete('/tokens/:id', requireSessionAuth, wrap(async (req, res) => {
  const record = db.tokens[String(req.params.id || '')];
  if (!record || record.accountId !== req.ctx.id) throw httpError(404, 'Token tidak ditemukan.');
  delete db.tokens[record.id];
  await saveDb();
  res.json({ ok: true });
}));

api.get('/status', requireScope('read'), async (req, res) => {
  try { const r = await agentJson('GET', '/health', req.ctx, undefined, 4000); res.json({ agent: !!(r.json && r.json.ok) }); }
  catch { res.json({ agent: false }); }
});
api.get('/me', requireScope('read'), (req, res) => {
  const c = req.ctx;
  res.json({ id: c.id, name: c.name, role: c.role, quota: c.quota, perms: c.perms, canAdmin: c.role !== 'user', canChangePassword: c.role !== 'owner' });
});
api.post('/me/password', requireSessionAuth, json1, wrap(async (req, res) => {
  const c = req.ctx;
  if (c.role === 'owner') throw httpError(400, 'Password owner diubah lewat ADMIN_PASSWORD di server.');
  const { current, next } = req.body || {};
  if (typeof next !== 'string' || next.length < 8 || next.length > 200) throw httpError(400, 'Password baru minimal 8 karakter.');
  const u = db.users[c.id];
  if (!(await acc.checkPw(typeof current === 'string' ? current : '', u.pw))) throw httpError(400, 'Password saat ini salah.');
  u.pw = await acc.hashPw(next);
  u.tv = (u.tv || 1) + 1;
  u.updatedAt = Date.now();
  await saveDb();
  res.json({ ok: true, relogin: true });
}));

api.get('/list', requireScope('read'), (req, res) => proxy(req, res, req.ctx, '/list', { path: req.query.path || '' }));
api.get('/stats', requireScope('read'), (req, res) => proxy(req, res, req.ctx, '/stats'));
api.get('/search', requireScope('read'), (req, res) => proxy(req, res, req.ctx, '/search', { q: req.query.q || '' }));
api.get('/download', requireScope('read'), (req, res) => {
  const q = { path: req.query.path || '' };
  if (req.query.inline === '1') q.inline = '1';
  proxy(req, res, req.ctx, '/download', q);
});
api.post('/upload', requireScope('upload'), (req, res) => proxy(req, res, req.ctx, '/upload', { path: req.query.path || '' }));
for (const op of ['mkdir', 'rename', 'move']) {
  api.post('/' + op, requireScope('modify'), json1, (req, res) => sendJson(req, res, 'POST', '/' + op, req.body));
}
api.post('/delete', requireScope('delete'), json1, (req, res) => sendJson(req, res, 'POST', '/delete', req.body));
api.get('/trash', requireScope('read'), (req, res) => proxy(req, res, req.ctx, '/trash'));
api.post('/trash/restore', requireScope('delete'), json1, (req, res) => sendJson(req, res, 'POST', '/trash/restore', req.body));
api.post('/trash/empty', requireScope('delete'), json1, (req, res) => sendJson(req, res, 'POST', '/trash/empty', {}));

// ---------- admin panel (owner and admins) ----------
const admin = express.Router();
admin.use(json1);
admin.use((req, res, next) => {
  if (req.ctx.role === 'user') return res.status(403).json({ error: 'Hanya admin yang boleh membuka ini.' });
  next();
});

// disk numbers + per-account usage come from the PC; if it is off the panel still works (numbers show 0)
async function pcNumbers(nodeId = 'primary') {
  const ids = [...Object.keys(db.users), OWNER_ID];
  try {
    const [d, us] = await Promise.all([agentCall('GET', '/sys/disk', undefined, nodeId), agentCall('POST', '/sys/usage', { ids: ids.filter((id) => (nodeId === 'primary' && id === OWNER_ID) || (db.users[id] && (db.users[id].nodeId || 'primary') === nodeId)) }, nodeId)]);
    return { online: true, disk: d, usage: us };
  } catch (e) {
    return { online: false, disk: { total: 0, free: 0 }, usage: {}, error: e.message };
  }
}
function overviewFrom(pc, excludeId, nodeId = 'primary') {
  let usedUsers = 0, allocated = 0, allocatedOthers = 0;
  const nodeUsers = Object.values(db.users).filter((u) => (u.nodeId || 'primary') === nodeId);
  for (const u of nodeUsers) {
    usedUsers += (pc.usage[u.id] && pc.usage[u.id].used) || 0;
    if (u.quota != null) { allocated += u.quota; if (u.id !== excludeId) allocatedOthers += u.quota; }
  }
  const capacity = pc.disk.free + usedUsers;
  return {
    online: pc.online, diskTotal: pc.disk.total, diskFree: pc.disk.free,
    ownerUsed: (pc.usage[OWNER_ID] && pc.usage[OWNER_ID].used) || 0, usedUsers,
    allocated, allocatedOthers, capacity, unallocated: Math.max(0, capacity - allocated),
    allowOverbook: ALLOW_OVERBOOK, userCount: nodeUsers.length,
  };
}
async function checkAllocation(excludeId, quota, nodeId = 'primary') {
  if (ALLOW_OVERBOOK || quota == null) return;
  const pc = await pcNumbers(nodeId);
  if (!pc.online) throw httpError(502, 'PC tidak terjangkau, jadi kapasitas disk tidak bisa diperiksa. Coba lagi saat PC menyala.');
  const o = overviewFrom(pc, excludeId, nodeId);
  if (o.allocatedOthers + quota > o.capacity) {
    throw httpError(400, `Alokasi melebihi kapasitas disk. Sisa yang bisa dialokasikan: ${fmtBytes(Math.max(0, o.capacity - o.allocatedOthers))}.`);
  }
}
function publicUser(u, usage) {
  const us = (usage && usage[u.id]) || { used: 0, trash: 0 };
  return {
    id: u.id, nodeId: u.nodeId || 'primary', role: u.role, active: !!u.active, quota: u.quota == null ? null : u.quota,
    perms: u.role === 'admin' ? { ...ALL_PERMS } : { ...u.perms },
    used: us.used, trash: us.trash, createdAt: u.createdAt, lastLogin: u.lastLogin || null,
  };
}
function mustManage(ctx, target, newRole) {
  if ((target && target.role === 'admin') || newRole === 'admin') {
    if (ctx.role !== 'owner') throw httpError(403, 'Hanya owner yang boleh mengelola akun admin.');
  }
}

admin.get('/nodes', wrap(async (req, res) => {
  const nodes = await Promise.all(Object.values(db.nodes).map(async (n) => {
    const pc = await pcNumbers(n.id);
    return { id: n.id, name: n.name, primary: !!n.primary, online: pc.online, diskTotal: pc.disk.total, diskFree: pc.disk.free, accounts: Object.values(db.users).filter((u) => (u.nodeId || 'primary') === n.id).length };
  }));
  res.json({ nodes });
}));

admin.post('/nodes', wrap(async (req, res) => {
  if (req.ctx.role !== 'owner') throw httpError(403, 'Hanya owner yang boleh menambahkan storage node.');
  const b = req.body || {};
  const id = String(b.id || '').trim().toLowerCase();
  const name = String(b.name || '').trim();
  const url = String(b.url || '').trim().replace(/\/+$/, '');
  const token = String(b.token || '');
  if (!/^[a-z0-9][a-z0-9_-]{1,30}$/.test(id) || id === 'primary' || db.nodes[id]) throw httpError(400, 'ID node tidak valid atau sudah digunakan.');
  if (!name || name.length > 80) throw httpError(400, 'Nama storage wajib diisi (maksimal 80 karakter).');
  let parsed;
  try { parsed = new URL(url); } catch { throw httpError(400, 'URL storage tidak valid.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) || token.length < 24) throw httpError(400, 'Storage remote wajib memakai HTTPS dan token minimal 24 karakter. HTTP hanya diizinkan untuk loopback.');
  db.nodes[id] = { id, name, url, token, primary: false, createdAt: Date.now() };
  await saveDb();
  res.status(201).json({ id, name, primary: false });
}));

admin.get('/overview', wrap(async (req, res) => res.json(overviewFrom(await pcNumbers()))));

admin.get('/tokens', wrap(async (req, res) => {
  if (req.ctx.role !== 'owner') throw httpError(403, 'Hanya owner yang boleh mengelola token semua akun.');
  const tokens = Object.values(db.tokens).map((t) => {
    const user = t.accountId === OWNER_ID ? null : db.users[t.accountId];
    return {
      id: t.id, accountId: t.accountId,
      accountName: t.accountId === OWNER_ID ? ADMIN_USER : t.accountId,
      accountActive: t.accountId === OWNER_ID ? true : !!(user && user.active),
      label: t.label, scopes: t.scopes, createdAt: t.createdAt,
      expiresAt: t.expiresAt || null, lastUsedAt: t.lastUsedAt || null,
      revokedAt: t.revokedAt || null,
    };
  }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  res.json({ tokens });
}));

admin.delete('/tokens/account/:accountId', wrap(async (req, res) => {
  if (req.ctx.role !== 'owner') throw httpError(403, 'Hanya owner yang boleh mencabut token semua akun.');
  const accountId = String(req.params.accountId || '');
  if (accountId !== OWNER_ID && !USER_RE.test(accountId)) throw httpError(400, 'ID akun tidak valid.');
  const ids = Object.values(db.tokens).filter((token) => token.accountId === accountId).map((token) => token.id);
  if (!ids.length) throw httpError(404, 'Tidak ada token untuk akun tersebut.');
  for (const id of ids) delete db.tokens[id];
  await saveDb();
  res.json({ ok: true, revoked: ids.length, accountId });
}));

admin.delete('/tokens/:id', wrap(async (req, res) => {
  if (req.ctx.role !== 'owner') throw httpError(403, 'Hanya owner yang boleh mencabut token semua akun.');
  const id = String(req.params.id || '');
  const record = db.tokens[id];
  if (!record) throw httpError(404, 'Token tidak ditemukan.');
  delete db.tokens[id];
  await saveDb();
  res.json({ ok: true, accountId: record.accountId });
}));

admin.get('/users', wrap(async (req, res) => {
  const nodeIds = Object.keys(db.nodes);
  const pcs = await Promise.all(nodeIds.map((id) => pcNumbers(id)));
  const usage = Object.assign({}, ...pcs.map((pc) => pc.usage));
  const list = Object.values(db.users).map((u) => publicUser(u, usage));
  list.sort((a, b) => a.id.localeCompare(b.id));
  // Keep the legacy `online` field tied to primary; per-node status is exposed by /nodes.
  res.json({ users: list, online: !!pcs[nodeIds.indexOf('primary')]?.online });
}));

admin.post('/users', wrap(async (req, res) => {
  const b = req.body || {};
  const id = String(b.username || '').trim().toLowerCase();
  if (id === ADMIN_USER.trim().toLowerCase()) throw httpError(400, 'Username itu dipakai oleh akun owner. Pilih username lain.');
  if (!USER_RE.test(id) || RESERVED_RE.test(id.split('.')[0])) {
    throw httpError(400, 'Username 3-32 karakter: huruf kecil, angka, titik, minus, garis bawah (harus diawali dan diakhiri huruf/angka).');
  }
  const role = b.role === 'admin' ? 'admin' : 'user';
  mustManage(req.ctx, null, role);
  const nodeId = String(b.nodeId || 'primary');
  if (!db.nodes[nodeId]) throw httpError(400, 'Storage node tidak ditemukan.');
  acc.checkPassword(b.password);
  const quota = acc.parseQuota(b.quota, role);
  const perms = acc.normPerms(b.perms);
  const pw = await acc.hashPw(b.password);
  if (db.users[id]) throw httpError(409, 'Username sudah dipakai.');
  await checkAllocation(null, quota, nodeId);
  if (db.users[id]) throw httpError(409, 'Username sudah dipakai.');
  const now = Date.now();
  db.users[id] = { id, nodeId, role, active: b.active === false ? false : true, quota, perms, pw, tv: 1, createdAt: now, updatedAt: now };
  await saveDb();
  await agentCall('POST', `/sys/users/${id}/init`, {}, nodeId).catch(() => {}); // best effort; the folder is also created lazily on first use
  res.status(201).json(publicUser(db.users[id], null));
}));

admin.patch('/users/:id', wrap(async (req, res) => {
  const id = String(req.params.id || '');
  const u = USER_RE.test(id) ? db.users[id] : null;
  if (!u) throw httpError(404, 'Pengguna tidak ditemukan.');
  const b = req.body || {};
  const newRole = 'role' in b ? (b.role === 'admin' ? 'admin' : 'user') : u.role;
  mustManage(req.ctx, u, newRole);

  let quota = u.quota == null ? null : u.quota;
  if ('quota' in b || newRole !== u.role) quota = acc.parseQuota('quota' in b ? b.quota : quota, newRole);
  const perms = acc.normPerms(b.perms, u.perms);
  let pw = null;
  if (b.password !== undefined && b.password !== '') { acc.checkPassword(b.password); pw = await acc.hashPw(b.password); }
  const active = 'active' in b ? !!b.active : u.active;
  const nextNodeId = 'nodeId' in b ? String(b.nodeId || 'primary') : (u.nodeId || 'primary');
  if (!db.nodes[nextNodeId]) throw httpError(400, 'Storage node tidak ditemukan.');
  if (nextNodeId !== (u.nodeId || 'primary')) {
    const sourceUsage = await agentCall('POST', '/sys/usage', { ids: [id] }, u.nodeId || 'primary').catch(() => null);
    if (!sourceUsage || !sourceUsage[id]) throw httpError(502, 'Storage asal tidak bisa diverifikasi. Penempatan akun tidak diubah.');
    const used = sourceUsage[id].used || 0;
    if (used > 0) throw httpError(409, 'Akun masih memiliki data. Pemindahan storage memerlukan migrasi data terverifikasi; penempatan tidak diubah agar file tetap aman.');
    await agentCall('POST', `/sys/users/${id}/init`, {}, nextNodeId);
  }
  if (quota !== (u.quota == null ? null : u.quota) || nextNodeId !== (u.nodeId || 'primary')) await checkAllocation(id, quota, nextNodeId);

  u.role = newRole; u.quota = quota; u.perms = perms; u.nodeId = nextNodeId; u.updatedAt = Date.now();
  if (pw) { u.pw = pw; u.tv = (u.tv || 1) + 1; }
  if (active !== u.active) { u.active = active; u.tv = (u.tv || 1) + 1; } // any status change ends old sessions
  await saveDb();
  res.json(publicUser(u, (await pcNumbers(nextNodeId)).usage));
}));

admin.delete('/users/:id', wrap(async (req, res) => {
  const id = String(req.params.id || '');
  const u = USER_RE.test(id) ? db.users[id] : null;
  if (!u) throw httpError(404, 'Pengguna tidak ditemukan.');
  mustManage(req.ctx, u, null);
  // the PC archives the folder first; if the PC is off we refuse so no data is left orphaned
  const r = await agentCall('POST', `/sys/users/${id}/archive`, {}, u.nodeId || 'primary');
  delete db.users[id];
  await saveDb();
  res.json({ ok: true, archived: r.archived || null });
}));
api.use('/admin', admin);

// share links: signed, expiring, read-only downloads tied to the account that made them.
api.post('/share', requireScope('share'), json1, wrap(async (req, res) => {
  const body = req.body || {};
  const p = String(body.path || '');
  const days = Math.min(Math.max(parseInt(body.days || '7', 10) || 7, 1), 30);
  if (!p) throw httpError(400, 'path required');
  if (!req.ctx.perms.share) throw httpError(403, 'Akun kamu tidak punya izin untuk membagikan link.');
  db.shortLinks = db.shortLinks && typeof db.shortLinks === 'object' ? db.shortLinks : {};
  const requestedSlug = body.slug == null || body.slug === '' ? '' : String(body.slug).trim().toLowerCase()
    .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (body.slug != null && body.slug !== '' && (requestedSlug.length < 3 || requestedSlug.length > 48 || /^(info|download)$/.test(requestedSlug))) {
    throw httpError(400, 'Custom URL harus 3–48 karakter, memakai huruf kecil, angka, atau tanda hubung, dan bukan kata yang dicadangkan.');
  }
  if (requestedSlug && db.shortLinks[requestedSlug]) throw httpError(409, 'Custom URL sudah digunakan. Pilih nama lain.');
  const account = req.ctx.id === OWNER_ID ? null : db.users[req.ctx.id];
  const token = makeToken({ k: 'share', p, u: req.ctx.id, tv: account ? account.tv : undefined, o: req.ctx.id === OWNER_ID ? 1 : 0, exp: Date.now() + days * 86400000 });
  // The short code is only an alias. The signed token remains the authority for expiry/revocation.
  let slug = requestedSlug;
  if (!slug) do { slug = b64u(crypto.randomBytes(6)); } while (db.shortLinks[slug]);
  db.shortLinks[slug] = { token, createdAt: Date.now(), accountId: req.ctx.id, custom: !!requestedSlug };
  await saveDb();
  res.json({ url: `${req.protocol}://${req.get('host')}/go/${slug}`, days, short: true, custom: !!requestedSlug, slug });
}));

// Manage only the share links created by the authenticated account.
api.get('/shares', requireScope('share'), (req, res) => {
  if (!req.ctx.perms.share) return res.status(403).json({ error: 'Akun kamu tidak punya izin mengelola link berbagi.' });
  const links = db.shortLinks && typeof db.shortLinks === 'object' ? db.shortLinks : {};
  const items = Object.entries(links).filter(([, entry]) => entry && entry.accountId === req.ctx.id).map(([slug, entry]) => {
    const payload = readToken(entry.token, true);
    return {
      slug, url: `${req.protocol}://${req.get('host')}/go/${slug}`,
      path: payload && payload.k === 'share' ? payload.p : '',
      createdAt: Number(entry.createdAt) || 0,
      expiresAt: payload && payload.k === 'share' ? payload.exp : 0,
      custom: !!entry.custom,
      status: !payload || payload.k !== 'share' ? 'invalid' : payload.exp <= Date.now() ? 'expired' : 'active',
    };
  }).sort((a, b) => b.createdAt - a.createdAt);
  res.json({ items });
});
api.delete('/shares/:slug', requireScope('share'), wrap(async (req, res) => {
  if (!req.ctx.perms.share) throw httpError(403, 'Akun kamu tidak punya izin mengelola link berbagi.');
  const slug = String(req.params.slug || '');
  const entry = db.shortLinks && db.shortLinks[slug];
  if (!entry || entry.accountId !== req.ctx.id) throw httpError(404, 'Link tidak ditemukan atau bukan milik akun kamu.');
  delete db.shortLinks[slug];
  await saveDb();
  res.json({ ok: true, slug });
}));
app.use('/api', api);

// Public share metadata. The signed token is the only access credential; no session or account
// information is exposed to the recipient.
app.get('/s/:token/info', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const p = readToken(req.params.token, true);
  if (!p || p.k !== 'share') return res.status(404).json({ status: 'invalid', message: 'Link tidak ditemukan atau tidak valid.' });
  if (p.exp <= Date.now()) return res.status(410).json({ status: 'expired', expiresAt: p.exp, message: 'Masa berlaku link ini sudah berakhir.' });
  const resolved = resolveCtx({ u: p.u, tv: p.tv, o: p.o, n: ADMIN_USER });
  if (!resolved.ctx || !resolved.ctx.perms.share) {
    return res.status(410).json({ status: 'unavailable', message: 'Link ini sudah tidak tersedia. Minta pemiliknya membuat link baru.' });
  }
  const relativePath = String(p.p || '');
  const fileName = path.posix.basename(relativePath);
  const parentPath = path.posix.dirname(relativePath);
  if (!fileName || fileName === '.' || fileName === '..') {
    return res.status(404).json({ status: 'invalid', message: 'Informasi file pada link ini tidak valid.' });
  }
  let listing;
  try {
    listing = await agentJson('GET', '/list?path=' + encodeURIComponent(parentPath === '.' ? '' : parentPath), resolved.ctx);
  } catch {
    return res.status(503).json({ status: 'unavailable', message: MSG_OFFLINE });
  }
  if (listing.status !== 200 || !listing.json) {
    return res.status(listing.status === 401 ? 502 : 503).json({ status: 'unavailable', message: listing.status === 401 ? MSG_TOKEN : MSG_OFFLINE });
  }
  const item = (Array.isArray(listing.json.items) ? listing.json.items : []).find((entry) => entry.name === fileName);
  if (!item) return res.status(410).json({ status: 'unavailable', message: 'File atau folder sudah tidak tersedia.' });
  const isFolder = item.type === 'dir';
  res.json({
    status: 'active',
    name: isFolder ? fileName + '.zip' : fileName,
    itemType: isFolder ? 'folder' : 'file',
    size: isFolder ? null : (Number.isFinite(item.size) ? item.size : null),
    expiresAt: p.exp,
  });
});

app.get('/s/:token/download', (req, res) => {
  const p = readToken(req.params.token, true);
  if (!p || p.k !== 'share') return res.status(404).send('Link tidak valid.');
  if (p.exp <= Date.now()) return res.status(410).send('Masa berlaku link ini sudah berakhir.');
  const resolved = resolveCtx({ u: p.u, tv: p.tv, o: p.o, n: ADMIN_USER });
  if (!resolved.ctx || !resolved.ctx.perms.share) return res.status(410).send('Link ini sudah tidak tersedia.');
  proxy(req, res, resolved.ctx, '/download', { path: p.p });
});

// Short aliases resolve internally; never redirect recipients to the long signed token URL.
function shortShareToken(req, res, next) {
  // Short-link metadata and downloads must never be cached by browsers or intermediary proxies.
  res.setHeader('Cache-Control', 'no-store');
  const entry = db.shortLinks && db.shortLinks[String(req.params.slug || '')];
  if (!entry || !entry.token) return res.status(404).json({ status: 'invalid', message: 'Link singkat tidak ditemukan.' });
  req.shareToken = entry.token;
  next();
}
app.get('/go/:slug/info', shortShareToken, (req, res) => {
  req.params.token = req.shareToken;
  // Reuse the same validation/metadata path as legacy signed links.
  const p = readToken(req.shareToken, true);
  if (!p || p.k !== 'share') return res.status(404).json({ status: 'invalid', message: 'Link tidak valid.' });
  if (p.exp <= Date.now()) return res.status(410).json({ status: 'expired', expiresAt: p.exp, message: 'Masa berlaku link ini sudah berakhir.' });
  const resolved = resolveCtx({ u: p.u, tv: p.tv, o: p.o, n: ADMIN_USER });
  if (!resolved.ctx || !resolved.ctx.perms.share) return res.status(410).json({ status: 'unavailable', message: 'Link ini sudah tidak tersedia. Minta pemiliknya membuat link baru.' });
  const relativePath = String(p.p || '');
  const fileName = path.posix.basename(relativePath), parentPath = path.posix.dirname(relativePath);
  if (!fileName || fileName === '.' || fileName === '..') return res.status(404).json({ status: 'invalid', message: 'Informasi file pada link ini tidak valid.' });
  agentJson('GET', '/list?path=' + encodeURIComponent(parentPath === '.' ? '' : parentPath), resolved.ctx)
    .then(({ status, json }) => {
      if (status !== 200 || !json) return res.status(status === 401 ? 502 : 503).json({ status: 'unavailable', message: status === 401 ? MSG_TOKEN : MSG_OFFLINE });
      const item = (Array.isArray(json.items) ? json.items : []).find((entry) => entry.name === fileName);
      if (!item) return res.status(410).json({ status: 'unavailable', message: 'File atau folder sudah tidak tersedia.' });
      const isFolder = item.type === 'dir';
      res.json({ status: 'active', name: isFolder ? fileName + '.zip' : fileName, itemType: isFolder ? 'folder' : 'file', size: isFolder ? null : (Number.isFinite(item.size) ? item.size : null), expiresAt: p.exp });
    }).catch(() => res.status(503).json({ status: 'unavailable', message: MSG_OFFLINE }));
});
app.get('/go/:slug/download', shortShareToken, (req, res) => {
  const p = readToken(req.shareToken, true);
  if (!p || p.k !== 'share') return res.status(404).send('Link tidak valid.');
  if (p.exp <= Date.now()) return res.status(410).send('Masa berlaku link ini sudah berakhir.');
  const resolved = resolveCtx({ u: p.u, tv: p.tv, o: p.o, n: ADMIN_USER });
  if (!resolved.ctx || !resolved.ctx.perms.share) return res.status(410).send('Link ini sudah tidak tersedia.');
  proxy(req, res, resolved.ctx, '/download', { path: p.p });
});
app.get('/go/:slug', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'share.html'));
});

// Share URLs show a page first; the recipient starts the transfer explicitly.
app.get('/s/:token', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'share.html'));
});

// ---------- static UI ----------
app.use(express.static(path.join(__dirname, 'public'), {
  index: 'index.html',
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'), // always revalidate (ETag) so UI updates show immediately
}));

// no host: dual-stack (IPv4 and IPv6), so Coolify's "localhost" healthcheck (may resolve to ::1) works too
app.listen(PORT, () => console.log(`Web listening on :${PORT}  agent=${AGENT_URL}  data=${DATA_DIR}  accounts=${Object.keys(db.users).length}${ALLOW_OVERBOOK ? '  overbook=on' : ''}`));
