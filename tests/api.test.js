'use strict';
// API / security / multi-user tests against an isolated stack. Run: npm run test:api
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { startStack, reporter } = require('./harness');

const MB = 1024 * 1024;
const J = { 'Content-Type': 'application/json' };

function client(base) {
  const c = { cookie: '' };
  c.h = (extra = {}) => ({ 'X-Requested-With': 'drive', ...(c.cookie ? { Cookie: c.cookie } : {}), ...extra });
  c.login = async (u, p) => {
    const r = await fetch(base + '/auth/login', { method: 'POST', headers: J, body: JSON.stringify({ username: u, password: p }) });
    if (r.ok) c.cookie = (r.headers.get('set-cookie') || '').split(';')[0];
    return r;
  };
  c.get = (p, extra) => fetch(base + p, { headers: c.h(extra) });
  c.send = (m, p, body) => fetch(base + p, { method: m, headers: c.h(body !== undefined ? J : {}), body: body !== undefined ? JSON.stringify(body) : undefined });
  c.post = (p, b) => c.send('POST', '/api/' + p, b);
  c.upload = async (name, buf, dir = '') => {
    const fd = new FormData();
    fd.append('file', new Blob([buf]), name);
    const r = await fetch(base + '/api/upload?path=' + encodeURIComponent(dir), { method: 'POST', headers: c.h(), body: fd });
    let json = null; try { json = await r.json(); } catch {}
    return { status: r.status, json };
  };
  c.stats = async () => (await c.get('/api/stats')).json();
  return c;
}

// multipart upload WITHOUT a Content-Length header, so only the in-stream quota check can stop it
function chunkedUpload(base, cookie, dir, name, buf) {
  return new Promise((resolve, reject) => {
    const u = new URL(base);
    const boundary = '----ait' + crypto.randomBytes(8).toString('hex');
    const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const req = http.request({
      host: u.hostname, port: u.port, method: 'POST', path: '/api/upload?path=' + encodeURIComponent(dir),
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Transfer-Encoding': 'chunked', Cookie: cookie, 'X-Requested-With': 'drive' },
    }, (res) => {
      let d = '';
      res.on('data', (x) => (d += x));
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch {} resolve({ status: res.statusCode, json: j }); });
    });
    req.on('error', reject);
    req.write(head);
    for (let i = 0; i < buf.length; i += 64 * 1024) req.write(buf.subarray(i, i + 64 * 1024));
    req.end(tail);
  });
}

(async () => {
  // fake an old single-drive (v1) layout so the migration runs when the agent boots
  const stack = await startStack({
    seed: (S) => {
      fs.writeFileSync(path.join(S, 'legacy.txt'), 'legacy');
      fs.mkdirSync(path.join(S, 'OldFolder'));
      fs.writeFileSync(path.join(S, 'OldFolder', 'a.txt'), 'old a');
      fs.mkdirSync(path.join(S, '.trash'));
      fs.writeFileSync(path.join(S, '.trash', '2020-01-01__gone.txt'), 'gone');
    },
  });
  const t = reporter('AIT Drive - API, security and multi-user tests');
  const { check } = t;
  const B = stack.webUrl;
  const A = stack.agentUrl;
  const S = stack.storage;
  const OWN = path.join(S, 'users', '_owner');
  let ok = false;

  try {
    // ============================================================ migration from v1
    check('v1 files migrated into users/_owner', fs.existsSync(path.join(OWN, 'legacy.txt')) && fs.existsSync(path.join(OWN, 'OldFolder', 'a.txt')) && fs.existsSync(path.join(OWN, '.trash', '2020-01-01__gone.txt')));
    check('storage root now only holds users/ and .ait/', JSON.stringify(fs.readdirSync(S).sort()) === JSON.stringify(['.ait', 'users']), fs.readdirSync(S).join(','));

    // ============================================================ owner: auth basics
    const own = client(B);
    let r = await own.get('/api/list');
    check('unauthenticated /api/list is 401', r.status === 401, r.status);
    r = await own.login(stack.creds.user, 'wrong-password');
    check('wrong owner password is 401', r.status === 401, r.status);
    r = await own.login(stack.creds.user, stack.creds.pass);
    check('owner login is 200 (HttpOnly cookie)', r.status === 200 && /HttpOnly/i.test(r.headers.get('set-cookie')), r.status);
    r = await own.get('/auth/me');
    check('/auth/me reports authenticated', (await r.json()).authenticated === true);
    r = await fetch(B + '/api/mkdir', { method: 'POST', headers: { Cookie: own.cookie, ...J }, body: '{}' });
    check('POST without CSRF header is 403', r.status === 403, r.status);
    r = await own.get('/api/me');
    let me = await r.json();
    check('owner /api/me: role owner, all perms, no quota, can admin', me.role === 'owner' && me.canAdmin && me.quota === null && Object.values(me.perms).every(Boolean) && me.name === stack.creds.user && me.canChangePassword === false, JSON.stringify(me));
    r = await own.get('/api/download?path=legacy.txt');
    check('owner sees migrated legacy file', (await r.text()) === 'legacy');

    // ============================================================ owner: file operations
    r = await own.post('mkdir', { path: '', name: 'Docs' });
    check('mkdir Docs', r.status === 200, r.status);
    r = await own.post('mkdir', { path: '', name: 'bad/name' });
    check('mkdir with "/" in name rejected', r.status === 400, r.status);
    r = await own.post('mkdir', { path: '', name: 'Docs' });
    check('mkdir duplicate is 409', r.status === 409, r.status);
    let u = await own.upload('hello.txt', 'hello cloud drive', 'Docs');
    check('upload hello.txt', JSON.stringify(u.json.saved) === '["hello.txt"]', JSON.stringify(u.json));
    u = await own.upload('hello.txt', 'hello cloud drive', 'Docs');
    check('duplicate upload is auto-renamed', JSON.stringify(u.json.saved) === '["hello (1).txt"]', JSON.stringify(u.json));
    const big = crypto.randomBytes(3 * MB);
    await own.upload('big.bin', big, 'Docs');
    r = await own.get('/api/download?path=Docs/big.bin');
    const got = Buffer.from(await r.arrayBuffer());
    check('3 MB upload/download round-trip is byte-identical', crypto.createHash('sha256').update(got).digest('hex') === crypto.createHash('sha256').update(big).digest('hex'));
    check('no leftover .part files', !fs.readdirSync(path.join(OWN, 'Docs')).some((n) => n.endsWith('.part')));
    r = await own.get('/api/list?path=Docs');
    let d = await r.json();
    check('list shows 3 files', d.items && d.items.length === 3, d.items && d.items.map((i) => i.name).join(', '));
    u = await own.upload('nested/deep/inside.txt', 'nested folder upload', 'Docs');
    check('folder-style multipart path creates nested subfolders', u.status === 200 && fs.readFileSync(path.join(OWN, 'Docs', 'nested', 'deep', 'inside.txt'), 'utf8') === 'nested folder upload', JSON.stringify(u.json));
    r = await own.get('/api/download?path=Docs/hello.txt', { Range: 'bytes=0-4' });
    check('range request returns 206 + "hello"', r.status === 206 && (await r.text()) === 'hello', r.status);

    r = await own.get('/api/list?path=' + encodeURIComponent('../../agent'));
    check('path traversal (list) rejected', r.status === 400, r.status);
    r = await own.get('/api/download?path=' + encodeURIComponent('../../../agent/server.js'));
    check('path traversal (download) rejected', r.status === 400, r.status);
    r = await own.get('/api/download?path=' + encodeURIComponent('Docs/../../../agent/server.js'));
    check('path traversal (nested ..) rejected', r.status === 400, r.status);
    r = await own.get('/api/list?path=' + encodeURIComponent('.trash'));
    check('.trash not browsable', r.status === 400, r.status);

    r = await own.post('rename', { path: 'Docs/hello.txt', newName: 'renamed.txt' });
    check('rename', r.status === 200, r.status);
    r = await own.post('rename', { path: 'Docs/renamed.txt', newName: '../evil.txt' });
    check('rename with ../ rejected', r.status === 400, r.status);
    await own.post('mkdir', { path: '', name: 'Archive' });
    r = await own.post('move', { path: 'Docs/renamed.txt', dest: 'Archive' });
    check('move file into Archive', r.status === 200 && fs.existsSync(path.join(OWN, 'Archive', 'renamed.txt')), r.status);
    r = await own.post('move', { path: 'Docs', dest: 'Docs' });
    check('moving a folder into itself rejected', r.status === 400, r.status);
    r = await own.get('/api/search?q=renam');
    d = await r.json();
    check('search finds renamed.txt', d.items && d.items.some((i) => i.name === 'renamed.txt' && i.path === 'Archive/renamed.txt'));
    d = await own.stats();
    check('owner stats: no quota, total/free/used present', d.quota === null && d.total > 0 && d.free > 0 && d.used >= 3 * MB, JSON.stringify(d));

    r = await own.post('share', { path: 'Archive/renamed.txt', days: 1 });
    d = await r.json();
    const ownSlug = d.url.split('/').pop();
    check('new share URL uses a short /go/ alias', d.short === true && typeof d.url === 'string' && d.url.startsWith('http') && d.url.includes('/go/') && ownSlug.length <= 12, d.url);
    r = await fetch(B + '/go/' + ownSlug);
    const sharePage = await r.text();
    check('short share URL opens a landing page without login', r.status === 200 && sharePage.includes('/share.js') && sharePage.includes('Mulai download'), r.status);
    r = await fetch(B + '/go/' + ownSlug + '/info');
    check('short share metadata is not cacheable', r.headers.get('cache-control') === 'no-store', r.headers.get('cache-control'));
    d = await r.json();
    check('short share metadata exposes file details and expiry', r.status === 200 && d.status === 'active' && d.name === 'renamed.txt' && d.expiresAt > Date.now(), JSON.stringify(d));
    r = await fetch(B + '/go/' + ownSlug + '/download');
    check('short share download requires explicit download endpoint', r.status === 200 && (await r.text()) === 'hello cloud drive', r.status);
    r = await fetch(B + '/go/' + ownSlug + 'x/info');
    check('unknown short alias is rejected', r.status === 404, r.status);
    r = await own.get('/api/shares');
    d = await r.json();
    check('share manager lists links created by this account', r.status === 200 && d.items.some((item) => item.slug === ownSlug && item.path === 'Archive/renamed.txt' && item.status === 'active'), JSON.stringify(d));
    r = await own.send('DELETE', '/api/shares/' + encodeURIComponent(ownSlug));
    check('owner can revoke an owned share link', r.status === 200 && (await r.json()).ok === true, r.status);
    r = await fetch(B + '/go/' + ownSlug + '/info');
    check('revoked short alias is no longer resolvable', r.status === 404, r.status);
    r = await own.get('/api/shares');
    d = await r.json();
    check('revoked link is removed from share manager', r.status === 200 && !d.items.some((item) => item.slug === ownSlug), JSON.stringify(d));

    r = await fetch(A + '/list');
    check('agent without token is 401', r.status === 401, r.status);
    r = await fetch(A + '/list', { headers: { Authorization: 'Bearer wrong' } });
    check('agent with wrong token is 401', r.status === 401, r.status);
    r = await fetch(A + '/list', { headers: { Authorization: 'Bearer ' + stack.token } });
    check('agent with the right token but no user identity is rejected', r.status === 401, r.status);

    r = await fetch(A + '/admin/users', { headers: { Authorization: 'Bearer ' + stack.token, 'X-AIT-User': '_owner' } });
    check('the agent has no account/admin API anymore (storage only)', r.status === 404, r.status);
    r = await fetch(A + '/sys/disk', { headers: { Authorization: 'Bearer ' + stack.token } });
    d = await r.json();
    check('agent /sys/disk reports disk numbers to the gateway', r.status === 200 && d.total > 0 && d.free > 0, JSON.stringify(d));
    r = await fetch(A + '/sys/disk');
    check('agent /sys/* needs the token too (401)', r.status === 401, r.status);
    r = await own.post('delete', { path: 'Docs' });
    check('delete returns 200', r.status === 200, r.status);
    check('deleted folder is kept in the owner\'s .trash on disk', fs.readdirSync(path.join(OWN, '.trash')).some((n) => n.endsWith('__Docs')));
    r = await own.get('/api/list?path=');
    d = await r.json();
    check('Docs gone from root listing, .trash hidden', !d.items.some((i) => i.name === 'Docs' || i.name === '.trash'), d.items.map((i) => i.name).join(', '));
    r = await own.get('/api/trash');
    d = await r.json();
    const trashedDocs = d.items && d.items.find((item) => item.name === 'Docs');
    check('Trash lists deleted folder and remembers its original path', !!trashedDocs && trashedDocs.originalPath === 'Docs', JSON.stringify(d.items));
    r = await own.post('trash/restore', { id: trashedDocs.id });
    check('restore returns folder to its original path', r.status === 200 && fs.existsSync(path.join(OWN, 'Docs', 'big.bin')), r.status);
    r = await own.get('/api/download?path=Docs');
    const zipBytes = Buffer.from(await r.arrayBuffer());
    check('downloading a folder returns a ZIP archive', r.status === 200 && (r.headers.get('content-disposition') || '').includes('Docs.zip') && zipBytes[0] === 0x50 && zipBytes[1] === 0x4b, r.status + ' ' + zipBytes.subarray(0, 4).toString('hex'));
    r = await own.post('delete', { path: 'Docs' });
    check('restored folder can be deleted again', r.status === 200, r.status);
    r = await own.post('trash/empty', {});
    check('owner can empty trash', r.status === 200 && !fs.existsSync(path.join(OWN, '.trash')) , r.status);

    // ============================================================ admin panel API
    r = await own.get('/api/admin/overview');
    const ovw = await r.json();
    check('overview: disk numbers, capacity, overbook off by default', r.status === 200 && ovw.diskTotal > 0 && ovw.capacity > 0 && ovw.allowOverbook === false && ovw.userCount === 0, JSON.stringify(ovw));

    const mk = (c, body) => c.send('POST', '/api/admin/users', body);
    const basePerms = { upload: true, modify: true, delete: true, share: false };
    r = await mk(own, { username: 'AB', password: 'password-1', quota: 2 * MB });
    check('username too short rejected (400)', r.status === 400, r.status);
    r = await mk(own, { username: 'bad name', password: 'password-1', quota: 2 * MB });
    check('username with space rejected (400)', r.status === 400, r.status);
    r = await mk(own, { username: 'con', password: 'password-1', quota: 2 * MB });
    check('reserved Windows name rejected (400)', r.status === 400, r.status);
    r = await mk(own, { username: stack.creds.user, password: 'password-1', quota: 2 * MB });
    check('username equal to the owner name rejected (400)', r.status === 400, r.status);
    r = await mk(own, { username: 'shorty', password: 'short', quota: 2 * MB });
    check('password under 8 chars rejected (400)', r.status === 400, r.status);
    r = await mk(own, { username: 'noquota', password: 'password-1' });
    check('regular user without quota rejected (400)', r.status === 400, r.status);
    r = await mk(own, { username: 'tiny', password: 'password-1', quota: 100 });
    check('quota under 1 MB rejected (400)', r.status === 400, r.status);

    r = await mk(own, { username: 'alice', password: 'alice-pass-1', quota: 2 * MB, perms: basePerms });
    let alice = await r.json();
    check('create alice (2 MB quota) is 201', r.status === 201 && alice.id === 'alice' && alice.quota === 2 * MB && alice.perms.share === false, JSON.stringify(alice));
    check('alice folder created on disk', fs.existsSync(path.join(S, 'users', 'alice')));
    r = await mk(own, { username: 'alice', password: 'alice-pass-1', quota: 2 * MB });
    check('duplicate username is 409', r.status === 409, r.status);
    r = await mk(own, { username: 'bob', password: 'bob-pass-123', quota: 2 * MB, perms: { upload: false, modify: false, delete: false, share: false } });
    check('create bob (read-only) is 201', r.status === 201, r.status);
    r = await mk(own, { username: 'carol', password: 'carol-pass-1', quota: 2 * MB, perms: { upload: true, modify: true, delete: true, share: true } });
    check('create carol (can share) is 201', r.status === 201, r.status);

    r = await own.post('admin/nodes', { id: 'secondary', name: 'Storage secondary', url: A, token: stack.token });
    check('owner can register a secondary storage node', r.status === 201, r.status);
    r = await mk(own, { username: 'nodeuser', password: 'nodeuser-pass', quota: 2 * MB, nodeId: 'secondary' });
    check('new account can be assigned to secondary storage', r.status === 201 && (await r.json()).nodeId === 'secondary', r.status);
    const nodeUser = client(B);
    await nodeUser.login('nodeuser', 'nodeuser-pass');
    u = await nodeUser.upload('node-file.txt', 'stored on secondary');
    check('account file requests route to the assigned node', u.status === 200 && fs.readFileSync(path.join(S, 'users', 'nodeuser', 'node-file.txt'), 'utf8') === 'stored on secondary', JSON.stringify(u));
    r = await own.send('PATCH', '/api/admin/users/nodeuser', { nodeId: 'primary' });
    check('reassignment with existing data is rejected safely (409)', r.status === 409, r.status);
    r = await own.get('/api/admin/nodes');
    d = await r.json();
    check('admin node inventory reports per-node account counts', r.status === 200 && d.nodes.some((n) => n.id === 'secondary' && n.accounts === 1), JSON.stringify(d.nodes));
    r = await own.send('DELETE', '/api/admin/users/nodeuser');
    check('delete archives account data from its assigned node', r.status === 200 && !fs.existsSync(path.join(S, 'users', 'nodeuser')), r.status);

    r = await own.get('/api/admin/users');
    d = await r.json();
    check('user list has 3 accounts, no password material', d.users.length === 3 && !JSON.stringify(d).includes('scrypt') && !JSON.stringify(d).includes('"pw"'), JSON.stringify(d).slice(0, 200));
    check('password is stored hashed (scrypt) in the gateway data folder (not on the PC)', fs.readFileSync(path.join(stack.dataDir, 'users.json'), 'utf8').includes('scrypt$') && !fs.readFileSync(path.join(stack.dataDir, 'users.json'), 'utf8').includes('alice-pass-1'));

    // ============================================================ alice: isolation + quota
    const al = client(B);
    r = await al.login('ALICE', 'wrong');
    check('user wrong password is 401', r.status === 401, r.status);
    r = await al.login('ALICE', 'alice-pass-1');
    check('user login works (username is case-insensitive)', r.status === 200, r.status);
    me = await (await al.get('/api/me')).json();
    check('alice /api/me: role user, quota 2 MB, cannot admin', me.role === 'user' && me.quota === 2 * MB && me.canAdmin === false && me.canChangePassword === true, JSON.stringify(me));
    r = await al.get('/api/list?path=');
    d = await r.json();
    check('alice starts with an empty private drive (owner files invisible)', d.items.length === 0, JSON.stringify(d.items));

    u = await al.upload('a.bin', crypto.randomBytes(1 * MB));
    check('alice uploads 1 MB', u.status === 200 && u.json.saved[0] === 'a.bin', JSON.stringify(u));
    u = await al.upload('b.bin', crypto.randomBytes(1.5 * MB));
    check('upload over quota is refused up-front (413)', u.status === 413 && /Kuota/.test(u.json.error), JSON.stringify(u));
    u = await chunkedUpload(B, al.cookie, '', 'c.bin', crypto.randomBytes(1.5 * MB));
    check('over-quota upload with unknown size is stopped while streaming (413)', u.status === 413 && /Kuota/.test(u.json.error), JSON.stringify(u));
    check('refused uploads leave nothing behind', JSON.stringify(fs.readdirSync(path.join(S, 'users', 'alice'))) === '["a.bin"]', fs.readdirSync(path.join(S, 'users', 'alice')).join(','));
    d = await al.stats();
    check('usage rolled back after refused uploads (exactly 1 MB)', d.used === 1 * MB && d.quota === 2 * MB && d.total === 2 * MB, JSON.stringify(d));
    u = await al.upload('d.bin', crypto.randomBytes(943718));
    check('upload that fits in the remaining quota works', u.status === 200, JSON.stringify(u));
    d = await al.stats();
    check('free space = quota - used', d.used === 1 * MB + 943718 && d.free === 2 * MB - d.used, JSON.stringify(d));

    r = await al.post('delete', { path: 'a.bin' });
    check('alice can delete (soft delete)', r.status === 200, r.status);
    d = await al.stats();
    check('trash still counts against the quota', d.used === 1 * MB + 943718 && d.trash === 1 * MB, JSON.stringify(d));
    u = await al.upload('e.bin', crypto.randomBytes(0.5 * MB));
    check('cannot upload while the trash fills the quota (413)', u.status === 413, JSON.stringify(u));
    r = await al.post('trash/empty', {});
    check('emptying the trash is 200', r.status === 200, r.status);
    d = await al.stats();
    check('emptying the trash frees the quota', d.used === 943718 && d.trash === 0, JSON.stringify(d));
    u = await al.upload('e.bin', crypto.randomBytes(0.5 * MB));
    check('upload works again after emptying the trash', u.status === 200, JSON.stringify(u));

    r = await al.get('/api/search?q=legacy');
    d = await r.json();
    check('alice cannot find owner files by search', d.items.length === 0);
    r = await al.get('/api/download?path=' + encodeURIComponent('../_owner/legacy.txt'));
    check('alice cannot reach the owner folder by ../ (400)', r.status === 400, r.status);
    r = await al.get('/api/list?path=' + encodeURIComponent('../bob'));
    check('alice cannot reach another user by ../ (400)', r.status === 400, r.status);
    r = await al.get('/api/admin/users');
    check('regular user cannot read the admin API (403)', r.status === 403, r.status);
    r = await al.send('POST', '/api/admin/users', { username: 'evil', password: 'password-1', quota: 2 * MB });
    check('regular user cannot create accounts (403)', r.status === 403, r.status);
    r = await al.post('share', { path: 'e.bin', days: 1 });
    check('alice has no share permission (403)', r.status === 403, r.status);

    // ============================================================ bob: read-only
    fs.writeFileSync(path.join(S, 'users', 'bob', 'readme.txt'), 'read me');
    const bo = client(B);
    await bo.login('bob', 'bob-pass-123');
    me = await (await bo.get('/api/me')).json();
    check('bob /api/me shows no write permissions', me.perms.upload === false && me.perms.modify === false && me.perms.delete === false && me.perms.share === false, JSON.stringify(me.perms));
    r = await bo.get('/api/download?path=readme.txt');
    check('read-only user can still download', (await r.text()) === 'read me');
    u = await bo.upload('x.txt', 'x');
    check('read-only: upload is 403', u.status === 403 && /izin/.test(u.json.error), JSON.stringify(u));
    r = await bo.post('mkdir', { path: '', name: 'F' });
    check('read-only: mkdir is 403', r.status === 403, r.status);
    r = await bo.post('rename', { path: 'readme.txt', newName: 'r2.txt' });
    check('read-only: rename is 403', r.status === 403, r.status);
    r = await bo.post('move', { path: 'readme.txt', dest: '' });
    check('read-only: move is 403', r.status === 403, r.status);
    r = await bo.post('delete', { path: 'readme.txt' });
    check('read-only: delete is 403', r.status === 403, r.status);
    r = await bo.post('trash/empty', {});
    check('read-only: empty trash is 403', r.status === 403, r.status);
    check('read-only: nothing changed on disk', JSON.stringify(fs.readdirSync(path.join(S, 'users', 'bob'))) === '["readme.txt"]');

    // ============================================================ carol: sharing is per account
    const ca = client(B);
    await ca.login('carol', 'carol-pass-1');
    await ca.upload('doc.txt', 'carol doc');
    r = await ca.post('share', { path: 'doc.txt', days: 1, slug: 'Mining Bayu' });
    d = await r.json();
    check('carol (share permission) can choose a normalized custom URL', r.status === 200 && d.custom === true && d.slug === 'mining-bayu' && d.url.endsWith('/go/mining-bayu'), JSON.stringify(d));
    const carolTok = d.slug;
    r = await ca.post('share', { path: 'doc.txt', days: 1, slug: 'mining-bayu' });
    check('custom URL collision is rejected (409)', r.status === 409, r.status);
    r = await ca.post('share', { path: 'doc.txt', days: 1, slug: 'info' });
    check('reserved custom URL is rejected (400)', r.status === 400, r.status);
    r = await fetch(B + '/go/' + carolTok);
    check('carol share link opens the public landing page', r.status === 200 && (await r.text()).includes('Mulai download'), r.status);
    r = await fetch(B + '/go/' + carolTok + '/info');
    d = await r.json();
    check('carol share landing page exposes her file metadata', r.status === 200 && d.status === 'active' && d.name === 'doc.txt', JSON.stringify(d));
    r = await fetch(B + '/go/' + carolTok + '/download');
    check('carol share link downloads HER file without login', r.status === 200 && (await r.text()) === 'carol doc', r.status);
    r = await ca.get('/api/shares');
    d = await r.json();
    check('share manager is available to regular users with Share permission', r.status === 200 && d.items.some((item) => item.slug === carolTok && item.path === 'doc.txt'), JSON.stringify(d));
    r = await own.get('/api/shares');
    d = await r.json();
    check('share manager does not expose another account links', r.status === 200 && !d.items.some((item) => item.slug === carolTok), JSON.stringify(d));
    r = await own.send('DELETE', '/api/shares/' + encodeURIComponent(carolTok));
    check('another account cannot revoke Carol share link', r.status === 404, r.status);
    r = await ca.send('DELETE', '/api/shares/' + encodeURIComponent(carolTok));
    check('Carol can revoke her own share link', r.status === 200, r.status);
    r = await fetch(B + '/go/' + carolTok + '/info');
    check('Carol revoked alias is gone', r.status === 404, r.status);
    r = await ca.post('share', { path: 'doc.txt', days: 1, slug: 'carol-disabled-test' });
    d = await r.json();
    const carolDisabledTok = d.slug;
    check('Carol can create a second link for account lifecycle coverage', r.status === 200, JSON.stringify(d));

    // ============================================================ admins vs owner
    r = await mk(own, { username: 'dana', password: 'dana-pass-12', role: 'admin' });
    check('owner creates an admin without quota (201)', r.status === 201 && (await r.json()).quota === null, r.status);
    r = await mk(own, { username: 'dave', password: 'dave-pass-12', role: 'admin' });
    const da = client(B); await da.login('dana', 'dana-pass-12');
    me = await (await da.get('/api/me')).json();
    check('admin /api/me: canAdmin, all perms', me.role === 'admin' && me.canAdmin === true && Object.values(me.perms).every(Boolean), JSON.stringify(me));
    r = await mk(da, { username: 'erin', password: 'erin-pass-12', quota: 2 * MB });
    check('admin can create regular users', r.status === 201, r.status);
    r = await mk(da, { username: 'mallory', password: 'password-12', role: 'admin' });
    check('admin cannot create another admin (403)', r.status === 403, r.status);
    r = await da.send('PATCH', '/api/admin/users/dave', { active: false });
    check('admin cannot edit another admin (403)', r.status === 403, r.status);
    r = await da.send('DELETE', '/api/admin/users/dave');
    check('admin cannot delete another admin (403)', r.status === 403, r.status);
    r = await da.send('PATCH', '/api/admin/users/erin', { quota: 3 * MB });
    check('admin can edit regular users', r.status === 200 && (await r.json()).quota === 3 * MB, r.status);

    // ============================================================ editing permissions + quota live
    r = await own.send('PATCH', '/api/admin/users/bob', { perms: { upload: true } });
    check('owner grants bob upload (partial perms merge)', r.status === 200 && (await r.json()).perms.upload === true);
    u = await bo.upload('x.txt', 'x');
    check('permission change takes effect immediately, same session', u.status === 200, JSON.stringify(u));
    r = await bo.post('delete', { path: 'x.txt' });
    check('...while other permissions stay off', r.status === 403, r.status);
    r = await own.send('PATCH', '/api/admin/users/bob', { quota: 1 * MB });
    check('owner lowers bob quota', r.status === 200, r.status);
    u = await bo.upload('y.bin', crypto.randomBytes(1.2 * MB));
    check('lowered quota is enforced immediately (413)', u.status === 413, JSON.stringify(u));
    r = await own.send('PATCH', '/api/admin/users/bob', { quota: 5 });
    check('quota under 1 MB rejected on edit', r.status === 400, r.status);
    r = await own.send('PATCH', '/api/admin/users/nobody', { quota: 2 * MB });
    check('editing a missing user is 404', r.status === 404, r.status);

    // ============================================================ disk allocation ("booking")
    const cap = (await (await own.get('/api/admin/overview')).json()).capacity;
    r = await mk(own, { username: 'huge', password: 'password-12', quota: cap + 1024 * MB });
    const huge = await r.json();
    check('quota above the disk capacity is refused (400)', r.status === 400 && /Alokasi/.test(huge.error), JSON.stringify(huge));
    const over = (await (await own.get('/api/admin/overview')).json());
    const half = Math.floor((over.capacity - over.allocated) * 0.6);
    r = await mk(own, { username: 'big1', password: 'password-12', quota: half });
    check('a big but available quota is accepted', r.status === 201, r.status);
    r = await mk(own, { username: 'big2', password: 'password-12', quota: half });
    check('the next one would overbook the disk, so it is refused', r.status === 400 && /Alokasi/.test((await r.json()).error), r.status);
    r = await own.send('DELETE', '/api/admin/users/big1');
    check('deleting big1 frees its allocation', r.status === 200, r.status);
    r = await mk(own, { username: 'big2', password: 'password-12', quota: half });
    check('...so big2 now fits', r.status === 201, r.status);
    await own.send('DELETE', '/api/admin/users/big2');
    const ov2 = await (await own.get('/api/admin/overview')).json();
    const listNow = (await (await own.get('/api/admin/users')).json()).users;
    const sumQ = listNow.reduce((a, x) => a + (x.quota || 0), 0);
    check('overview totals: allocated equals the sum of live quotas', ov2.allocated === sumQ && ov2.userCount === listNow.length && sumQ > 0, JSON.stringify({ ov2, sumQ }));

    // ============================================================ account lifecycle
    r = await own.send('PATCH', '/api/admin/users/alice', { active: false });
    check('owner disables alice', r.status === 200 && (await r.json()).active === false, r.status);
    r = await al.get('/api/list?path=');
    check('disabled account: existing session is refused (403)', r.status === 403, r.status);
    r = await client(B).login('alice', 'alice-pass-1');
    check('disabled account: login is refused (403) with a clear message', r.status === 403 && /nonaktif/i.test((await r.json()).error), r.status);
    await own.send('PATCH', '/api/admin/users/alice', { active: true });
    r = await al.get('/api/list?path=');
    check('re-enabling does not revive the old session (401)', r.status === 401, r.status);
    const al2 = client(B);
    r = await al2.login('alice', 'alice-pass-1');
    check('alice can log in again after re-enabling', r.status === 200, r.status);

    r = await own.send('PATCH', '/api/admin/users/alice', { password: 'alice-NEW-pass-2' });
    check('admin resets alice password', r.status === 200, r.status);
    r = await al2.get('/api/list?path=');
    check('password reset signs out existing sessions (401)', r.status === 401, r.status);
    r = await client(B).login('alice', 'alice-pass-1');
    check('old password no longer works', r.status === 401, r.status);
    const al3 = client(B);
    r = await al3.login('alice', 'alice-NEW-pass-2');
    check('new password works', r.status === 200, r.status);

    r = await al3.post('me/password', { current: 'nope', next: 'brand-new-pass-3' });
    check('self password change needs the right current password (400)', r.status === 400, r.status);
    r = await al3.post('me/password', { current: 'alice-NEW-pass-2', next: 'short' });
    check('self password change enforces 8+ chars (400)', r.status === 400, r.status);
    r = await al3.post('me/password', { current: 'alice-NEW-pass-2', next: 'brand-new-pass-3' });
    check('self password change works', r.status === 200 && (await r.json()).relogin === true, r.status);
    r = await al3.get('/api/list?path=');
    check('...and ends the current session (401)', r.status === 401, r.status);
    r = await client(B).login('alice', 'brand-new-pass-3');
    check('login with the self-chosen password', r.status === 200, r.status);
    r = await own.post('me/password', { current: stack.creds.pass, next: 'whatever-12345' });
    check('owner password cannot be changed from the UI (400)', r.status === 400, r.status);

    r = await own.send('PATCH', '/api/admin/users/carol', { active: false });
    r = await fetch(B + '/go/' + carolDisabledTok + '/info');
    d = await r.json();
    check('share links of a disabled account show unavailable status', r.status === 410 && d.status === 'unavailable', JSON.stringify(d));

    r = await own.send('DELETE', '/api/admin/users/bob');
    const del = await r.json();
    check('delete account archives its data instead of destroying it', r.status === 200 && del.archived && !fs.existsSync(path.join(S, 'users', 'bob')) && fs.existsSync(path.join(S, '.ait', 'archive', del.archived, 'readme.txt')), JSON.stringify(del));
    r = await bo.get('/api/list?path=');
    check('deleted account: old session is refused (401)', r.status === 401, r.status);
    r = await client(B).login('bob', 'bob-pass-123');
    check('deleted account: cannot log in (401)', r.status === 401, r.status);
    r = await mk(own, { username: 'bob', password: 'bob-pass-456', quota: 2 * MB });
    check('a deleted username can be created again with a fresh folder', r.status === 201 && fs.readdirSync(path.join(S, 'users', 'bob')).length === 0, r.status);

    // ============================================================ overbooking mode
    const stack2 = await startStack({ webEnv: { ALLOW_OVERBOOK: 'true' } });
    try {
      const o2 = client(stack2.webUrl);
      await o2.login(stack2.creds.user, stack2.creds.pass);
      const ovb = await (await o2.get('/api/admin/overview')).json();
      check('ALLOW_OVERBOOK=true is reported by the overview', ovb.allowOverbook === true);
      r = await o2.send('POST', '/api/admin/users', { username: 'whale', password: 'password-12', quota: ovb.capacity * 10 });
      check('with overbooking on, a quota above disk capacity is accepted', r.status === 201, r.status);
    } finally { await stack2.stop(); }

    // ============================================================ accounts live in the gateway volume
    const web2 = await stack.startWeb();
    const re = client(web2);
    r = await re.login('alice', 'brand-new-pass-3');
    check('accounts survive a gateway restart (same data volume)', r.status === 200, r.status);
    me = await (await re.get('/api/me')).json();
    check('...with the same quota and permissions', me.quota === 2 * MB && me.role === 'user', JSON.stringify(me));

    // ============================================================ static UI, branding, headers
    r = await fetch(B + '/');
    const html = await r.text();
    check('index served with AIT Drive branding', r.status === 200 && html.includes('<title>AIT Drive</title>'));
    check('credit "Fadhil Ghifarion 法迪 for AIT" present (UTF-8 intact)', html.includes('Fadhil Ghifarion') && html.includes('法迪') && html.includes('for AIT'));
    check('no leftover old brand name', !/fieldnote/i.test(html));
    const csp = r.headers.get('content-security-policy') || '';
    check('CSP header set (script-src self, no unsafe-inline scripts)', csp.includes("script-src 'self'") && !/script-src[^;]*unsafe-inline/.test(csp));
    check('static files revalidate (Cache-Control: no-cache)', (r.headers.get('cache-control') || '').includes('no-cache'));
    for (const f of ['/style.css', '/app.js', '/admin.js', '/theme.js']) {
      const x = await fetch(B + f);
      check(`static ${f} is 200`, x.status === 200, x.status);
    }

    // ============================================================ logout
    r = await own.send('POST', '/auth/logout');
    check('logout is 200', r.status === 200, r.status);
    r = await fetch(B + '/api/list', { headers: { Cookie: 'sid=' } });
    check('after logout the api is 401', r.status === 401, r.status);

    // ============================================================ misconfiguration + outages
    const badWeb = await stack.startWeb({ AGENT_TOKEN: 'wrong-token-wrong-token-wrong-token' });
    const bad = client(badWeb);
    await bad.login(stack.creds.user, stack.creds.pass);
    r = await bad.get('/api/list?path=');
    d = await r.json();
    check('wrong AGENT_TOKEN (owner session) gives 502 with a clear message', r.status === 502 && /Token agent/.test(d.error), r.status + ' ' + JSON.stringify(d));
    const badUser = client(badWeb);
    r = await badUser.login('alice', 'brand-new-pass-3');
    check('regular users can log in even with a wrong AGENT_TOKEN (login is local)', r.status === 200, r.status);
    r = await badUser.get('/api/list?path=');
    d = await r.json();
    check('...and their file calls then show the token message (502)', r.status === 502 && /Token agent/.test(d.error), r.status + ' ' + JSON.stringify(d));

    const offWeb = await stack.startWeb({ AGENT_URL: 'http://127.0.0.1:1' });
    const offUser = client(offWeb);
    r = await offUser.login('alice', 'brand-new-pass-3');
    check('regular users can log in while the PC is offline (accounts are on the server)', r.status === 200, r.status);
    r = await offUser.get('/api/list?path=');
    check('...and file calls say "PC tidak terjangkau" (502)', r.status === 502 && /PC tidak terjangkau/.test((await r.json()).error), r.status);
    r = await offUser.get('/api/me');
    me = await r.json();
    check('/api/me still works with the PC offline', r.status === 200 && me.id === 'alice', r.status);
    const offOwnerAdmin = client(offWeb);
    await offOwnerAdmin.login(stack.creds.user, stack.creds.pass);
    r = await offOwnerAdmin.get('/api/admin/users');
    d = await r.json();
    check('admin panel keeps working with the PC offline (users listed, online:false)', r.status === 200 && d.users.length > 0 && d.online === false, r.status);
    r = await offOwnerAdmin.send('POST', '/api/admin/users', { username: 'offline1', password: 'password-12', quota: 2 * MB });
    check('creating a quota account offline is refused (capacity cannot be checked)', r.status === 502, r.status);
    r = await offOwnerAdmin.send('DELETE', '/api/admin/users/carol');
    check('deleting an account offline is refused so its data is not orphaned', r.status === 502, r.status);
    const offOwner = client(offWeb);
    r = await offOwner.login(stack.creds.user, stack.creds.pass);
    check('owner can still log in while the PC is offline', r.status === 200, r.status);
    r = await offOwner.get('/api/list?path=');
    check('...and sees a clear offline error', r.status === 502 && /PC tidak terjangkau/.test((await r.json()).error), r.status);
    r = await offOwner.get('/api/status');
    check('/api/status reports agent:false when the PC is off', (await r.json()).agent === false);

    // ============================================================ brute force (separate gateway)
    const rlWeb = await stack.startWeb();
    const rl = client(rlWeb);
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await rl.login('alice', 'nope-' + i)).status;
    check('6th failed login is rate limited (429)', last === 429, last);
    r = await rl.login(stack.creds.user, stack.creds.pass);
    check('even the correct password is blocked while rate limited', r.status === 429, r.status);

    ok = true;
  } catch (e) {
    console.error('test crashed:', e);
  }
  const passed = t.done() && ok;
  if (!passed) console.log('\n--- server logs ---\n' + stack.logs.join(''));
  await stack.stop();
  process.exit(passed ? 0 : 1);
})();
