'use strict';
// PAT authentication and lifecycle tests. Run: npm run test:pat
const fs = require('fs');
const path = require('path');
const { startStack, reporter } = require('./harness');

const JSON_HEADERS = { 'Content-Type': 'application/json', 'X-Requested-With': 'drive' };
function cookieClient(base) {
  let cookie = '';
  return {
    get: (url, headers = {}) => fetch(base + url, { headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } }),
    send: async (method, url, body, headers = {}) => fetch(base + url, {
      method, headers: { ...JSON_HEADERS, ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    login: async (username, password) => {
      const r = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
      if (r.ok) cookie = (r.headers.get('set-cookie') || '').split(';')[0];
      return r;
    },
    cookie: () => cookie,
  };
}
const bearer = (token) => ({ Authorization: 'Bearer ' + token });
const json = (r) => r.json();

(async () => {
  const stack = await startStack();
  const t = reporter('AIT Drive - Personal Access Token security and lifecycle');
  const { check } = t;
  const owner = cookieClient(stack.webUrl);
  try {
    await owner.login(stack.creds.user, stack.creds.pass);
    let r = await owner.send('POST', '/api/admin/users', {
      username: 'patuser', password: 'patuser-pass', quota: 8 * 1024 * 1024,
      perms: { upload: true, modify: true, delete: true, share: false },
    });
    check('create test account', r.status === 201, r.status);
    const user = cookieClient(stack.webUrl);
    await user.login('patuser', 'patuser-pass');

    r = await user.send('POST', '/api/tokens', { label: 'read only', scopes: ['read'], expiresInDays: 30 }, { 'X-Requested-With': undefined });
    check('token management keeps cookie CSRF protection', r.status === 403, r.status);

    r = await user.send('POST', '/api/tokens', { label: 'read only', scopes: ['read'], expiresInDays: 30 });
    const readData = await json(r);
    check('create scoped PAT returns secret once (201)', r.status === 201 && /^aitd_[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{43}$/.test(readData.token || ''), r.status);
    const readToken = readData.token;
    const dbFile = path.join(stack.dataDir, 'users.json');
    let db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    const readRecord = db.tokens[readData.id];
    check('only SHA-256 digest is persisted, not the token secret', !!readRecord && readRecord.hash.length === 64 && !fs.readFileSync(dbFile, 'utf8').includes(readToken));

    r = await fetch(stack.webUrl + '/api/list', { headers: bearer(readToken) });
    check('Bearer PAT lists files without browser cookie', r.status === 200, r.status);
    r = await fetch(stack.webUrl + '/api/tokens', { headers: { ...bearer(readToken), Cookie: user.cookie() } });
    check('PAT cannot manage or list personal tokens, even with a cookie present', r.status === 403, r.status);
    r = await fetch(stack.webUrl + '/api/list', { headers: { ...bearer('aitd_invalid.invalid'), Cookie: user.cookie() } });
    check('invalid Bearer never falls back to a valid browser cookie', r.status === 401, r.status);

    r = await fetch(stack.webUrl + '/api/mkdir', {
      method: 'POST', headers: { ...bearer(readToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '', name: 'blocked-by-scope' }),
    });
    check('read-only PAT cannot modify files', r.status === 403, r.status);

    r = await user.send('POST', '/api/tokens', { label: 'automation', scopes: ['read', 'upload', 'modify', 'delete'], expiresInDays: 30 });
    const writeData = await json(r);
    check('create PAT with account-permitted scopes', r.status === 201 && writeData.scopes.includes('modify'), r.status);
    const writeToken = writeData.token;
    r = await user.send('POST', '/api/tokens', { label: 'illegal share', scopes: ['share'], expiresInDays: 30 });
    check('cannot mint a scope the account does not possess', r.status === 403, r.status);

    r = await fetch(stack.webUrl + '/api/mkdir', {
      method: 'POST', headers: { ...bearer(writeToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '', name: 'created-by-pat' }),
    });
    check('Bearer write PAT can perform scoped mutation without CSRF header', r.status === 200, r.status);

    r = await owner.send('PATCH', '/api/admin/users/patuser', { perms: { modify: false } });
    check('owner can change current account permission', r.status === 200, r.status);
    r = await fetch(stack.webUrl + '/api/mkdir', {
      method: 'POST', headers: { ...bearer(writeToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '', name: 'must-stay-blocked' }),
    });
    check('permission changes take effect for existing PAT immediately', r.status === 403, r.status);
    await owner.send('PATCH', '/api/admin/users/patuser', { perms: { modify: true } });

    r = await owner.send('PATCH', '/api/admin/users/patuser', { active: false });
    check('disable account', r.status === 200, r.status);
    r = await fetch(stack.webUrl + '/api/list', { headers: bearer(writeToken) });
    check('PAT is rejected when its account is disabled', r.status === 403, r.status);
    await owner.send('PATCH', '/api/admin/users/patuser', { active: true });

    r = await user.send('DELETE', '/api/tokens/' + writeData.id);
    check('browser session can revoke its own PAT', r.status === 200, r.status);
    r = await fetch(stack.webUrl + '/api/list', { headers: bearer(writeToken) });
    check('revoked PAT is rejected', r.status === 401, r.status);

    r = await user.get('/api/tokens');
    const listData = await json(r);
    check('browser can list own tokens without exposing hashes or secrets', r.status === 200 && listData.tokens.some((x) => x.id === readData.id) && !JSON.stringify(listData).includes(readToken), r.status);

    // Simulate expiry in the persisted store, then boot a second isolated gateway on the same test DB.
    db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    db.tokens[readData.id].expiresAt = Date.now() - 1000;
    fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
    const restartedUrl = await stack.startWeb();
    r = await fetch(restartedUrl + '/api/list', { headers: bearer(readToken) });
    check('expired PAT is rejected after gateway restart', r.status === 401, r.status);

    r = await fetch(restartedUrl + '/api/list', { headers: { Cookie: user.cookie() } });
    check('existing cookie session still works after PAT support and restart', r.status === 200, r.status);
  } catch (e) {
    check('test execution completed without unexpected exception', false, e.stack || e.message);
  } finally {
    const passed = t.done();
    await stack.stop();
    if (!passed) process.exitCode = 1;
  }
})();
