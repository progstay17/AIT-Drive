'use strict';
// AIT Drive - account store for the gateway (runs on Coolify).
// Accounts, scrypt password hashes, quotas and permissions live in DATA_DIR/users.json.
// DATA_DIR must be a persistent volume in Coolify (mounted at /data), otherwise accounts vanish on redeploy.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const USER_RE = /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/;
const RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
const MIN_QUOTA = 1024 * 1024; // 1 MB
const MAX_QUOTA = 1e15;
const ALL_PERMS = Object.freeze({ upload: true, modify: true, delete: true, share: true });
const DEFAULT_PERMS = Object.freeze({ upload: true, modify: true, delete: true, share: false });

function httpError(status, msg) { const e = new Error(msg); e.status = status; return e; }
function fmtBytes(n) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)) + ' ' + u[i];
}

// Opens (or creates) the store. Exits with a clear message when the folder is not writable.
function openStore(dataDir) {
  const file = path.join(dataDir, 'users.json');
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const probe = path.join(dataDir, '.write-test');
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
  } catch (e) {
    console.error(`DATA_DIR (${dataDir}) tidak bisa ditulis: ${e.message}`);
    console.error('Di Coolify tambahkan Persistent Storage (volume) yang dipasang ke /data.');
    process.exit(1);
  }
  let db = { version: 3, users: {}, nodes: {} };
  try {
    db = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!db.users || typeof db.users !== 'object') db.users = {};
    if (!db.nodes || typeof db.nodes !== 'object') db.nodes = {};
    db.version = Math.max(3, Number(db.version) || 2);
  } catch (e) {
    if (e.code !== 'ENOENT') { console.error(`Tidak bisa membaca ${file}: ${e.message}`); process.exit(1); }
  }
  let chain = Promise.resolve();
  function save() {
    chain = chain.then(async () => {
      const tmp = file + '.tmp';
      await fsp.writeFile(tmp, JSON.stringify(db, null, 2));
      await fsp.rename(tmp, file);
    });
    return chain;
  }
  return { db, save, file };
}

async function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}
async function checkPw(pw, stored) {
  const [, s, h] = String(stored || '').split('$');
  if (!s || !h) return false;
  const want = Buffer.from(h, 'base64');
  const got = await scrypt(pw, Buffer.from(s, 'base64'), want.length);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
const dummyHash = hashPw('timing-equalizer'); // unknown usernames cost the same as known ones

function normPerms(input, base) {
  const out = { ...(base || DEFAULT_PERMS) };
  if (input && typeof input === 'object') for (const k of Object.keys(ALL_PERMS)) if (k in input) out[k] = !!input[k];
  return out;
}
function parseQuota(v, role) {
  if (v === null || v === undefined || v === '') {
    if (role === 'admin') return null;
    throw httpError(400, 'Kuota wajib diisi untuk pengguna biasa.');
  }
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < MIN_QUOTA) throw httpError(400, 'Kuota minimal 1 MB.');
  if (n > MAX_QUOTA) throw httpError(400, 'Kuota terlalu besar.');
  return n;
}
function checkPassword(p) {
  if (typeof p !== 'string' || p.length < 8) throw httpError(400, 'Password minimal 8 karakter.');
  if (p.length > 200) throw httpError(400, 'Password terlalu panjang.');
}

module.exports = {
  USER_RE, RESERVED_RE, ALL_PERMS, DEFAULT_PERMS, httpError, fmtBytes,
  openStore, hashPw, checkPw, dummyHash, normPerms, parseQuota, checkPassword,
};
