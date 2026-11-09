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
function setSessionCookie(res, payload) {
  res.setHeader('Set-Cookie',
    `sid=${encodeURIComponent(makeToken(payload))}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}${COOKIE_SECURE ? '; Secure' : ''}`);
}

// Turns a session payload into the caller's CURRENT rights (read from the account store on every
// request, so edits to quota/permissions and disabling an account take effect immediately).
function resolveCtx(sess) {
  if (sess.o) return { ctx: { id: OWNER_ID, name: sess.n || ADMIN_USER, role: 'owner', quota: null, perms: { ...ALL_PERMS } } };
  const u = USER_RE.test(String(sess.u)) ? db.users[sess.u] : null;
  if (!u) return { status: 401, error: 'Akun tidak ditemukan. Silakan masuk lagi.' };
  if (!u.active) return { status: 403, error: 'Akun dinonaktifkan. Hubungi admin.' };
  if (String(u.tv) !== String(sess.tv)) return { status: 401, error: 'Sesi tidak berlaku lagi. Silakan masuk lagi.' };
  return { ctx: { id: u.id, name: u.id, role: u.role, quota: u.quota == null ? null : u.quota, perms: u.role === 'admin' ? { ...ALL_PERMS } : { ...u.perms } } };
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
function agentJson(method, agentPath, ctx, body, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = { Authorization: `Bearer ${AGENT_TOKEN}`, ...(ctx ? userHeaders(ctx) : {}) };
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
// system call to the agent (no user): returns the JSON body or throws an httpError for the admin panel
async function agentCall(method, agentPath, body) {
  let r;
  try { r = await agentJson(method, agentPath, null, body); }
  catch { throw httpError(502, MSG_OFFLINE); }
  if (r.status === 401) throw httpError(502, MSG_TOKEN);
  if (r.status >= 400) throw httpError(r.status, (r.json && r.json.error) || 'Agent error');
  return r.json || {};
}

const FWD_REQ = ['content-type', 'content-length', 'range', 'if-range', 'if-none-match', 'if-modified-since'];
const FWD_RES = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition', 'etag', 'last-modified', 'cache-control'];

// stream a request/response through to the agent on behalf of an account
function proxy(req, res, ctx, agentPath, query) {
  const qs = query && Object.keys(query).length ? '?' + new URLSearchParams(query).toString() : '';
  const headers = { Authorization: `Bearer ${AGENT_TOKEN}`, ...userHeaders(ctx) };
  for (const h of FWD_REQ) if (req.headers[h]) headers[h] = req.headers[h];
  const up = agentLib.request({
    protocol: agent.protocol, hostname: agent.hostname, port: agentPort,
    method: req.method, path: agentBase + agentPath + qs, headers, timeout: 0,
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
  const s = sessionOf(req);
  if (!s) return res.status(401).json({ error: 'unauthenticated' });
  // CSRF: state-changing requests must carry a custom header (cannot be set cross-site without CORS)
  if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'drive') {
    return res.status(403).json({ error: 'forbidden' });
  }
  const r = resolveCtx(s);
  if (!r.ctx) return res.status(r.status).json({ error: r.error });
  req.sess = s;
  req.ctx = r.ctx;
  next();
}

// ---------- API ----------
const api = express.Router();
api.use(requireAuth);
const json1 = express.json({ limit: '1mb' });
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  if (!e.status) console.error(e);
  res.status(e.status || 500).json({ error: e.status ? e.message : 'internal error' });
});

api.get('/status', async (req, res) => {
  try { const r = await agentJson('GET', '/health', null, undefined, 4000); res.json({ agent: !!(r.json && r.json.ok) }); }
  catch { res.json({ agent: false }); }
});
api.get('/me', (req, res) => {
  const c = req.ctx;
  res.json({ id: c.id, name: c.name, role: c.role, quota: c.quota, perms: c.perms, canAdmin: c.role !== 'user', canChangePassword: c.role !== 'owner' });
});
api.post('/me/password', json1, wrap(async (req, res) => {
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

api.get('/list', (req, res) => proxy(req, res, req.ctx, '/list', { path: req.query.path || '' }));
api.get('/stats', (req, res) => proxy(req, res, req.ctx, '/stats'));
api.get('/search', (req, res) => proxy(req, res, req.ctx, '/search', { q: req.query.q || '' }));
api.get('/download', (req, res) => {
  const q = { path: req.query.path || '' };
  if (req.query.inline === '1') q.inline = '1';
  proxy(req, res, req.ctx, '/download', q);
});
api.post('/upload', (req, res) => proxy(req, res, req.ctx, '/upload', { path: req.query.path || '' }));
for (const op of ['mkdir', 'rename', 'move', 'delete']) {
  api.post('/' + op, json1, (req, res) => sendJson(req, res, 'POST', '/' + op, req.body));
}
api.get('/trash', (req, res) => proxy(req, res, req.ctx, '/trash'));
api.post('/trash/restore', json1, (req, res) => sendJson(req, res, 'POST', '/trash/restore', req.body));
api.post('/trash/empty', json1, (req, res) => sendJson(req, res, 'POST', '/trash/empty', {}));

// ---------- admin panel (owner and admins) ----------
const admin = express.Router();
admin.use(json1);
admin.use((req, res, next) => {
  if (req.ctx.role === 'user') return res.status(403).json({ error: 'Hanya admin yang boleh membuka ini.' });
  next();
});

// disk numbers + per-account usage come from the PC; if it is off the panel still works (numbers show 0)
async function pcNumbers() {
  const ids = [...Object.keys(db.users), OWNER_ID];
  try {
    const [d, us] = await Promise.all([agentCall('GET', '/sys/disk'), agentCall('POST', '/sys/usage', { ids })]);
    return { online: true, disk: d, usage: us };
  } catch (e) {
    return { online: false, disk: { total: 0, free: 0 }, usage: {}, error: e.message };
  }
}
function overviewFrom(pc, excludeId) {
  let usedUsers = 0, allocated = 0, allocatedOthers = 0;
  for (const u of Object.values(db.users)) {
    usedUsers += (pc.usage[u.id] && pc.usage[u.id].used) || 0;
    if (u.quota != null) { allocated += u.quota; if (u.id !== excludeId) allocatedOthers += u.quota; }
  }
  const capacity = pc.disk.free + usedUsers;
  return {
    online: pc.online, diskTotal: pc.disk.total, diskFree: pc.disk.free,
    ownerUsed: (pc.usage[OWNER_ID] && pc.usage[OWNER_ID].used) || 0, usedUsers,
    allocated, allocatedOthers, capacity, unallocated: Math.max(0, capacity - allocated),
    allowOverbook: ALLOW_OVERBOOK, userCount: Object.keys(db.users).length,
  };
}
async function checkAllocation(excludeId, quota) {
  if (ALLOW_OVERBOOK || quota == null) return;
  const pc = await pcNumbers();
  if (!pc.online) throw httpError(502, 'PC tidak terjangkau, jadi kapasitas disk tidak bisa diperiksa. Coba lagi saat PC menyala.');
  const o = overviewFrom(pc, excludeId);
  if (o.allocatedOthers + quota > o.capacity) {
    throw httpError(400, `Alokasi melebihi kapasitas disk. Sisa yang bisa dialokasikan: ${fmtBytes(Math.max(0, o.capacity - o.allocatedOthers))}.`);
  }
}
function publicUser(u, usage) {
  const us = (usage && usage[u.id]) || { used: 0, trash: 0 };
  return {
    id: u.id, role: u.role, active: !!u.active, quota: u.quota == null ? null : u.quota,
    perms: u.role === 'admin' ? { ...ALL_PERMS } : { ...u.perms },
    used: us.used, trash: us.trash, createdAt: u.createdAt, lastLogin: u.lastLogin || null,
  };
}
function mustManage(ctx, target, newRole) {
  if ((target && target.role === 'admin') || newRole === 'admin') {
    if (ctx.role !== 'owner') throw httpError(403, 'Hanya owner yang boleh mengelola akun admin.');
  }
}

admin.get('/overview', wrap(async (req, res) => res.json(overviewFrom(await pcNumbers()))));

admin.get('/users', wrap(async (req, res) => {
  const pc = await pcNumbers();
  const list = Object.values(db.users).map((u) => publicUser(u, pc.usage));
  list.sort((a, b) => a.id.localeCompare(b.id));
  res.json({ users: list, online: pc.online });
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
  acc.checkPassword(b.password);
  const quota = acc.parseQuota(b.quota, role);
  const perms = acc.normPerms(b.perms);
  const pw = await acc.hashPw(b.password);
  if (db.users[id]) throw httpError(409, 'Username sudah dipakai.');
  await checkAllocation(null, quota);
  if (db.users[id]) throw httpError(409, 'Username sudah dipakai.');
  const now = Date.now();
  db.users[id] = { id, role, active: b.active === false ? false : true, quota, perms, pw, tv: 1, createdAt: now, updatedAt: now };
  await saveDb();
  await agentCall('POST', `/sys/users/${id}/init`, {}).catch(() => {}); // best effort; the folder is also created lazily on first use
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
  if (quota !== (u.quota == null ? null : u.quota)) await checkAllocation(id, quota);

  u.role = newRole; u.quota = quota; u.perms = perms; u.updatedAt = Date.now();
  if (pw) { u.pw = pw; u.tv = (u.tv || 1) + 1; }
  if (active !== u.active) { u.active = active; u.tv = (u.tv || 1) + 1; } // any status change ends old sessions
  await saveDb();
  res.json(publicUser(u, (await pcNumbers()).usage));
}));

admin.delete('/users/:id', wrap(async (req, res) => {
  const id = String(req.params.id || '');
  const u = USER_RE.test(id) ? db.users[id] : null;
  if (!u) throw httpError(404, 'Pengguna tidak ditemukan.');
  mustManage(req.ctx, u, null);
  // the PC archives the folder first; if the PC is off we refuse so no data is left orphaned
  const r = await agentCall('POST', `/sys/users/${id}/archive`, {});
  delete db.users[id];
  await saveDb();
  res.json({ ok: true, archived: r.archived || null });
}));
api.use('/admin', admin);

// share links: signed, expiring, read-only download of one file, tied to the account that made it
api.post('/share', json1, (req, res) => {
  const p = String((req.body || {}).path || '');
  const days = Math.min(Math.max(parseInt((req.body || {}).days || '7', 10) || 7, 1), 30);
  if (!p) return res.status(400).json({ error: 'path required' });
  if (!req.ctx.perms.share) return res.status(403).json({ error: 'Akun kamu tidak punya izin untuk membagikan link.' });
  const token = makeToken({ k: 'share', p, u: req.sess.u, tv: req.sess.tv, o: req.sess.o ? 1 : 0, exp: Date.now() + days * 86400000 });
  res.json({ url: `${req.protocol}://${req.get('host')}/s/${token}`, days });
});
app.use('/api', api);

app.get('/s/:token', (req, res) => {
  const p = readToken(req.params.token);
  if (!p || p.k !== 'share') return res.status(404).send('Link tidak valid atau sudah kedaluwarsa.');
  const r = resolveCtx({ u: p.u, tv: p.tv, o: p.o, n: ADMIN_USER });
  if (!r.ctx) return res.status(r.status).send(r.error);
  if (!r.ctx.perms.share) return res.status(403).send('Link ini tidak berlaku lagi.');
  proxy(req, res, r.ctx, '/download', { path: p.p });
});

// ---------- static UI ----------
app.use(express.static(path.join(__dirname, 'public'), {
  index: 'index.html',
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'), // always revalidate (ETag) so UI updates show immediately
}));

// no host: dual-stack (IPv4 and IPv6), so Coolify's "localhost" healthcheck (may resolve to ::1) works too
app.listen(PORT, () => console.log(`Web listening on :${PORT}  agent=${AGENT_URL}  data=${DATA_DIR}  accounts=${Object.keys(db.users).length}${ALLOW_OVERBOOK ? '  overbook=on' : ''}`));
