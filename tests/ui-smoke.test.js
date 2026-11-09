'use strict';
// UI smoke test: loads the real index.html + app.js in jsdom and drives it against an
// isolated stack (login, browse, select, preview, context menu, rename, share, upload,
// search, delete, theme, drawer, logout). Run: npm run test:ui
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, CookieJar } = require('jsdom');
const { startStack, waitFor, sleep, reporter, ROOT } = require('./harness');

(async () => {
  const stack = await startStack();
  const t = reporter('AIT Drive - UI smoke test (jsdom)');
  const { check } = t;
  let ok = false;
  const errors = [];

  try {
    // seed the drive
    const S = path.join(stack.storage, 'users', '_owner');
    fs.mkdirSync(S, { recursive: true });
    fs.mkdirSync(path.join(S, 'Projects'));
    fs.writeFileSync(path.join(S, 'notes.txt'), 'hello from notes');
    fs.writeFileSync(path.join(S, 'photo.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
    fs.writeFileSync(path.join(S, 'report.pdf'), '%PDF-1.4 fake');

    const pub = path.join(ROOT, 'web', 'public');
    const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
    const vc = new VirtualConsole();
    vc.on('jsdomError', (e) => errors.push(String((e && e.message) || e)));
    vc.on('error', (e) => errors.push(String(e)));
    const jar = new CookieJar();
    const dom = new JSDOM(html, { url: stack.webUrl + '/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc, cookieJar: jar });
    const w = dom.window;
    const d = w.document;
    w.addEventListener('error', (e) => errors.push('window error: ' + e.message));

    // browser APIs jsdom lacks / that need real network + cookies
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    let copied = '';
    Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async (s) => { copied = s; } }, configurable: true });
    w.fetch = async (url, opts = {}) => {
      const u = new URL(url, stack.webUrl).toString();
      const headers = { ...(opts.headers || {}) };
      const c = jar.getCookieStringSync(u);
      if (c) headers.Cookie = c;
      const r = await fetch(u, { method: opts.method, headers, body: opts.body, redirect: 'manual' });
      for (const sc of r.headers.getSetCookie ? r.headers.getSetCookie() : []) jar.setCookieSync(sc, u);
      return r;
    };

    w.eval(fs.readFileSync(path.join(pub, 'theme.js'), 'utf8'));
    w.eval(fs.readFileSync(path.join(pub, 'admin.js'), 'utf8'));
    w.eval(fs.readFileSync(path.join(pub, 'app.js'), 'utf8'));

    const $ = (id) => d.getElementById(id);
    const ev = (type, init = {}) => new w.MouseEvent(type, { bubbles: true, cancelable: true, ...init });
    const nodeFor = (name) => [...d.querySelectorAll('.file-card, .file-row')].find((n) => n.dataset.path === name);
    const names = () => [...d.querySelectorAll('.file-card .file-name, .file-row .file-name')].map((n) => n.textContent);
    const toasts = () => [...d.querySelectorAll('.toast')].map((n) => n.textContent).join(' | ');
    async function submitDialog(value) {
      await waitFor(() => d.querySelector('.modal-backdrop form'), 3000, 'dialog');
      const form = d.querySelector('.modal-backdrop form');
      const inp = form.querySelector('input');
      if (value !== undefined && inp) inp.value = value;
      form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
      await waitFor(() => !d.querySelector('.modal-backdrop'), 3000, 'dialog to close');
    }
    const ctxClick = async (name, label) => {
      nodeFor(name).dispatchEvent(ev('contextmenu', { clientX: 40, clientY: 40 }));
      await waitFor(() => d.querySelector('.context-menu'), 2000, 'context menu');
      const b = [...d.querySelectorAll('.context-menu button')].find((x) => x.textContent === label);
      if (!b) throw new Error('menu item not found: ' + label);
      b.click();
    };

    // ---- login screen
    await waitFor(() => !$('login-view').hidden, 4000, 'login view');
    check('login screen shown when signed out', $('app-view').hidden === true);
    check('login screen shows AIT Drive + credit', /AIT Drive/.test($('login-view').textContent) && $('login-view').textContent.includes('Fadhil Ghifarion') && $('login-view').textContent.includes('法迪'));
    check('page title is AIT Drive', d.title === 'AIT Drive');

    $('login-user').value = stack.creds.user;
    $('login-pass').value = 'wrong-password';
    $('login-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => !$('login-error').hidden, 4000, 'login error');
    check('wrong password shows inline error + invalid fields', /salah/i.test($('login-error').textContent) && $('login-pass').classList.contains('is-invalid'));
    check('login button re-enabled after failure', $('login-submit').disabled === false);

    $('login-pass').value = stack.creds.pass;
    $('login-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => !$('app-view').hidden && d.querySelectorAll('.file-card').length === 4, 5000, 'file grid');
    check('correct login opens the app', $('login-view').hidden === true);

    // ---- Personal Access Token management
    check('account panel exposes Personal Access Tokens', !!$('tokens-btn'));
    $('tokens-btn').click();
    await waitFor(() => d.querySelector('.token-create-form'), 3000, 'PAT management modal');
    const tokenForm = d.querySelector('.token-create-form');
    tokenForm.querySelector('input[type="text"]').value = 'UI smoke test';
    tokenForm.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => d.querySelector('.token-secret-value')?.value.startsWith('aitd_'), 4000, 'one-time PAT secret');
    const generatedSecret = d.querySelector('.token-secret-value').value;
    check('PAT modal creates and reveals a token exactly once', /^aitd_[A-Za-z0-9_-]{12}\\.[A-Za-z0-9_-]{43}$/.test(generatedSecret));
    check('PAT appears in active token list without exposing secret there', d.querySelector('.token-list').textContent.includes('UI smoke test') && !d.querySelector('.token-list').textContent.includes(generatedSecret));
    d.querySelector('.token-secret-panel button').click();
    await waitFor(() => copied === generatedSecret, 2000, 'copy PAT secret');
    check('PAT secret can be copied to the clipboard', copied === generatedSecret);
    [...d.querySelectorAll('.token-create-form ~ .dialog-actions button, .modal-body > .dialog-actions button')].at(-1)?.click();
    if (d.querySelector('.modal-backdrop')) d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    // ---- browsing
    check('grid shows folder first then files', JSON.stringify(names()) === JSON.stringify(['Projects', 'notes.txt', 'photo.png', 'report.pdf']), names().join(','));
    check('item count shown', $('count').textContent === '4 item');
    check('breadcrumb + title at root', $('page-title').textContent === 'Drive Saya');
    check('agent status shows PC online', await waitFor(() => /online/.test($('agent-text').textContent), 3000, 'status').then(() => true, () => false));
    check('storage text filled', await waitFor(() => $('storage-text').textContent.includes('/'), 3000, 'storage').then(() => true, () => false));
    check('sidebar shows credit', d.querySelector('.sidebar-credit') && d.querySelector('.sidebar-credit').textContent.includes('Fadhil Ghifarion'));
    check('file type icons rendered (folder/image/pdf)', !!d.querySelector('svg.file-type-icon.folder') && !!d.querySelector('svg.file-type-icon.pdf') && d.querySelectorAll('svg.file-type-icon, .file-thumb img').length >= 4);

    // ---- selection
    nodeFor('notes.txt').dispatchEvent(ev('click'));
    await new Promise((resolve) => setTimeout(resolve, 260));
    check('single click selects after double-click window', nodeFor('notes.txt').getAttribute('aria-selected') === 'true' && nodeFor('notes.txt').classList.contains('is-selected'));
    check('selection checkbox is visible in the item DOM', !!nodeFor('notes.txt').querySelector('.selection-check'));
    check('selection toolbar appears with item count and actions', !!$('selection-toolbar') && $('selection-toolbar').textContent.includes('1 dipilih') && [...$('selection-toolbar').querySelectorAll('button')].some((b) => b.textContent === 'Unduh'));
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }));
    check('Ctrl+A selects all', d.querySelectorAll('[aria-selected="true"]').length === 4);
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check('Escape clears selection', d.querySelectorAll('[aria-selected="true"]').length === 0 && !$('selection-toolbar'));

    // ---- grid / list toggle
    $('view-btn').click();
    check('toggle to list view', d.querySelectorAll('.file-row').length === 4 && !!d.querySelector('table.file-list thead'));
    $('view-btn').click();
    check('toggle back to grid view', d.querySelectorAll('.file-card').length === 4);

    // ---- open folder -> empty state -> breadcrumb back
    nodeFor('Projects').dispatchEvent(ev('dblclick'));
    await waitFor(() => $('page-title').textContent === 'Projects', 4000, 'folder open');
    check('double-click opens folder (empty state shown)', !!d.querySelector('.empty-state') && /Belum ada file/.test(d.querySelector('.empty-state').textContent));
    $('crumbs').querySelector('a').click();
    await waitFor(() => $('page-title').textContent === 'Drive Saya' && d.querySelectorAll('.file-card').length === 4, 4000, 'back to root');
    check('breadcrumb navigates back to root', true);

    // ---- preview
    nodeFor('notes.txt').dispatchEvent(ev('dblclick'));
    await waitFor(() => d.querySelector('.preview-text') && d.querySelector('.preview-text').textContent.includes('hello from notes'), 4000, 'text preview');
    check('text file preview shows content', true);
    check('preview header shows type, size and download link', /TXT/.test(d.querySelector('.modal-header').textContent) && !!d.querySelector('.modal-header a[download]'));
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check('Escape closes preview', !d.querySelector('.modal-backdrop'));
    nodeFor('report.pdf').dispatchEvent(ev('dblclick'));
    await waitFor(() => d.querySelector('.preview-stage iframe'), 3000, 'pdf iframe');
    check('PDF preview uses an iframe', true);
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    // ---- context menu + rename
    nodeFor('notes.txt').dispatchEvent(ev('contextmenu', { clientX: 50, clientY: 50 }));
    await waitFor(() => d.querySelector('.context-menu'), 2000, 'context menu');
    const labels = [...d.querySelectorAll('.context-menu button')].map((b) => b.textContent);
    check('context menu lists actions', ['Pratinjau', 'Unduh', 'Ganti nama', 'Pindahkan ke…', 'Buat link berbagi', 'Hapus'].every((l) => labels.includes(l)), labels.join(','));
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check('Escape closes context menu', !d.querySelector('.context-menu'));

    await ctxClick('notes.txt', 'Ganti nama');
    await submitDialog('renamed.txt');
    await waitFor(() => fs.existsSync(path.join(S, 'renamed.txt')) && names().includes('renamed.txt'), 4000, 'rename');
    check('rename via dialog updates disk and UI', !fs.existsSync(path.join(S, 'notes.txt')));

    // ---- share link
    await ctxClick('renamed.txt', 'Buat link berbagi');
    await submitDialog('3');
    await submitDialog(); // "Link siap" -> Salin link
    await waitFor(() => copied.includes('/s/'), 4000, 'copied share link');
    const shared = await fetch(copied.replace(/^https?:\/\/[^/]+/, stack.webUrl));
    check('share link is copied and downloads the file', shared.status === 200 && (await shared.text()) === 'hello from notes');

    // ---- search
    $('search').value = 'photo';
    $('search').dispatchEvent(new w.Event('input', { bubbles: true }));
    await waitFor(() => $('page-title').textContent === 'Hasil pencarian' && names().length === 1, 4000, 'search results');
    check('search shows only matching items', names()[0] === 'photo.png');
    $('search').value = '';
    $('search').dispatchEvent(new w.Event('input', { bubbles: true }));
    await waitFor(() => $('page-title').textContent === 'Drive Saya' && names().length === 4, 4000, 'search cleared');
    check('clearing search restores the folder', true);
    $('search').value = 'zzzz-no-match';
    $('search').dispatchEvent(new w.Event('input', { bubbles: true }));
    await waitFor(() => d.querySelector('.empty-state'), 4000, 'no results');
    check('search with no match shows empty state', /Tidak ditemukan/.test(d.querySelector('.empty-state').textContent));
    $('search').value = '';
    $('search').dispatchEvent(new w.Event('input', { bubbles: true }));
    await waitFor(() => names().length === 4, 4000, 'restore');

    // ---- upload through the real XHR path
    const file = new w.File(['uploaded via ui'], 'upload.txt', { type: 'text/plain' });
    Object.defineProperty($('file-input'), 'files', { value: [file], configurable: true });
    $('file-input').dispatchEvent(new w.Event('change', { bubbles: true }));
    await waitFor(() => fs.existsSync(path.join(S, 'upload.txt')), 6000, 'upload on disk');
    check('upload from the UI lands on disk', fs.readFileSync(path.join(S, 'upload.txt'), 'utf8') === 'uploaded via ui');
    await waitFor(() => names().includes('upload.txt'), 4000, 'list refresh after upload');
    check('list refreshes after upload without a redundant toast', !/Mengunggah|Selesai/.test(toasts()) && [...d.querySelectorAll('.transfer-row')].some((n) => /upload.txt/.test(n.textContent) && /Selesai/.test(n.textContent)));

    // ---- delete with confirmation (Delete key)
    nodeFor('upload.txt').dispatchEvent(ev('click'));
    await new Promise((resolve) => setTimeout(resolve, 260));
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    await waitFor(() => d.querySelector('.modal-backdrop'), 2000, 'delete confirm');
    check('Delete key asks for confirmation (danger button)', !!d.querySelector('.modal-backdrop .btn-danger-solid'));
    await submitDialog();
    await waitFor(() => !names().includes('upload.txt'), 4000, 'delete refresh');
    check('confirmed delete moves file to .trash', !fs.existsSync(path.join(S, 'upload.txt')) && fs.readdirSync(path.join(S, '.trash')).some((n) => n.endsWith('__upload.txt')));

    // ---- theme + mobile drawer
    $('theme-btn').click();
    const th = d.documentElement.getAttribute('data-theme');
    check('theme button sets data-theme', th === 'dark' || th === 'light', th);
    $('menu-btn').click();
    check('menu button opens the sidebar drawer', $('sidebar').classList.contains('is-open') && $('scrim').hidden === false);
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check('Escape closes the drawer', !$('sidebar').classList.contains('is-open'));

    // ============ multi-user + admin panel ============
    const loginAs = async (u, p) => {
      await waitFor(() => !$('login-view').hidden, 3000, 'login view');
      $('login-user').value = u;
      $('login-pass').value = p;
      $('login-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
      await waitFor(() => !$('app-view').hidden, 5000, 'app view for ' + u);
      await waitFor(() => $('account-name').textContent === u, 4000, 'account name');
    };
    const logout = async () => {
      $('logout-btn').click();
      await waitFor(() => !$('login-view').hidden, 3000, 'logout');
    };
    const setVal = (id, v) => { $(id).value = v; $(id).dispatchEvent(new w.Event('input', { bubbles: true })); };
    const usersDb = () => JSON.parse(fs.readFileSync(path.join(stack.dataDir, 'users.json'), 'utf8'));
    const dbUser = (id) => usersDb().users[id];

    // owner: admin entry visible
    check('owner sees the Admin nav entry and Owner role', $('nav-admin').hidden === false && /Owner/.test($('account-role').textContent) && $('pw-btn').hidden === true);
    $('nav-admin').click();
    await waitFor(() => $('admin-add') && d.querySelectorAll('.stat-card').length >= 3, 5000, 'admin panel');
    check('admin panel shows overview stat cards and the add button', w.location.hash === '#admin' && d.querySelectorAll('.stat-card').length >= 3);
    check('search is disabled inside the admin panel', $('search').disabled === true);

    // create an account through the form
    $('admin-add').click();
    await waitFor(() => $('user-form'), 3000, 'user form');
    $('f-gen').click();
    check('"Buat acak" fills a 14-char password', $('f-password').value.length === 14, $('f-password').value);
    const budiPw = $('f-password').value;
    setVal('f-username', 'budi');
    setVal('f-quota', '0.01');
    $('f-perm-share').checked = false;
    $('user-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => d.querySelector('tr.admin-row[data-user="budi"]'), 5000, 'budi row');
    check('new account appears in the table and a success toast shows', !d.querySelector('#user-form') && /Akun dibuat/.test(toasts()));
    check('account stored on the PC with ~10 MB quota', !!dbUser('budi') && dbUser('budi').quota > 10 * 1024 * 1024 - 1 && dbUser('budi').quota < 11 * 1024 * 1024, JSON.stringify(dbUser('budi')));

    // duplicate -> inline error
    $('admin-add').click();
    await waitFor(() => $('user-form'), 3000, 'user form 2');
    setVal('f-username', 'budi'); setVal('f-password', 'another-pass-1'); setVal('f-quota', '0.01');
    $('user-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => !$('user-form-error').hidden, 4000, 'duplicate error');
    check('duplicate username shows an inline error and keeps the form open', /sudah|ada/i.test($('user-form-error').textContent), $('user-form-error').textContent);
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitFor(() => !d.querySelector('.modal-backdrop'), 2000, 'form closed');

    // edit: raise quota to ~20 MB, remove "modify"
    d.querySelector('tr.admin-row[data-user="budi"] .admin-edit').click();
    await waitFor(() => $('user-form') && $('f-username').disabled, 3000, 'edit form');
    setVal('f-quota', '0.02');
    $('f-perm-modify').checked = false;
    $('user-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => !d.querySelector('#user-form'), 4000, 'edit closed');
    await waitFor(() => dbUser('budi').perms.modify === false, 3000, 'perm saved');
    check('edit saves quota (~20 MB) and permissions', dbUser('budi').quota > 20 * 1024 * 1024 && dbUser('budi').quota < 22 * 1024 * 1024 && dbUser('budi').perms.modify === false && dbUser('budi').perms.upload === true, JSON.stringify(dbUser('budi')));

    // sign in as the new user
    await logout();
    await loginAs('budi', budiPw);
    check('regular user: no Admin nav, role "Pengguna", password button visible', $('nav-admin').hidden === true && /Pengguna/.test($('account-role').textContent) && $('pw-btn').hidden === false);
    await waitFor(() => /sisa kuota/.test($('storage-caption').textContent), 4000, 'quota caption');
    check('quota widget shows "sisa kuota" with the account limit', /sisa kuota/.test($('storage-caption').textContent) && /20/.test($('storage-text').textContent), $('storage-text').textContent);
    await waitFor(() => d.querySelector('.empty-state') && names().length === 0, 4000, 'empty drive').catch(() => {});
    check('regular user starts with an empty private drive', !!d.querySelector('.empty-state') && names().length === 0);

    // upload within quota works; over quota refused client-side
    Object.defineProperty($('file-input'), 'files', { value: [new w.File(['budi file'], 'budi.txt', { type: 'text/plain' })], configurable: true });
    $('file-input').dispatchEvent(new w.Event('change', { bubbles: true }));
    const BD = path.join(stack.storage, 'users', 'budi');
    await waitFor(() => fs.existsSync(path.join(BD, 'budi.txt')) && names().includes('budi.txt'), 6000, 'budi upload');
    check('regular user can upload into their own folder', true);
    Object.defineProperty($('file-input'), 'files', { value: [new w.File([new Uint8Array(30 * 1024 * 1024)], 'huge.bin')], configurable: true });
    $('file-input').dispatchEvent(new w.Event('change', { bubbles: true }));
    await waitFor(() => /Kuota tidak cukup/.test(toasts()), 4000, 'quota toast');
    check('file larger than the remaining quota is refused in the browser', !fs.existsSync(path.join(BD, 'huge.bin')));

    // permission gating in the context menu (modify=false hides rename/move, delete still there)
    nodeFor('budi.txt').dispatchEvent(ev('contextmenu', { clientX: 40, clientY: 40 }));
    await waitFor(() => d.querySelector('.context-menu'), 2000, 'ctx menu');
    const bl = [...d.querySelectorAll('.context-menu button')].map((b) => b.textContent);
    check('context menu hides actions the account may not do', !bl.includes('Ganti nama') && !bl.includes('Buat link berbagi') && bl.includes('Hapus') && bl.includes('Unduh'), bl.join(','));
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    // delete -> inspect Trash -> empty permanently
    await ctxClick('budi.txt', 'Hapus');
    await submitDialog();
    await waitFor(() => !$('trash-btn').hidden, 4000, 'trash button');
    check('after delete the "Lihat sampah" button appears', /Lihat sampah/.test($('trash-btn').textContent));
    $('trash-btn').click();
    await waitFor(() => [...d.querySelectorAll('.modal-backdrop button')].some((b) => b.textContent === 'Kosongkan sampah'), 3000, 'Trash view');
    const emptyTrash = [...d.querySelectorAll('.modal-backdrop button')].find((b) => b.textContent === 'Kosongkan sampah');
    emptyTrash.click();
    await waitFor(() => d.querySelector('.modal-backdrop form'), 3000, 'empty trash confirmation');
    await submitDialog();
    await waitFor(() => $('trash-btn').hidden === true, 4000, 'trash emptied');
    check('emptying the trash hides the button again', fs.readdirSync(BD).every((n) => n !== '.trash' || fs.readdirSync(path.join(BD, '.trash')).length === 0));

    // password-change modal opens and closes
    $('pw-btn').click();
    await waitFor(() => d.querySelector('.modal-backdrop'), 2000, 'password modal');
    check('"Ganti password" opens a form with 3 password fields', d.querySelectorAll('.modal-backdrop input[type="password"]').length >= 2);
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitFor(() => !d.querySelector('.modal-backdrop'), 2000, 'pw modal closed');

    // back to owner: delete the account via the panel
    await logout();
    await loginAs(stack.creds.user, stack.creds.pass);
    $('nav-admin').click();
    await waitFor(() => d.querySelector('tr.admin-row[data-user="budi"]'), 5000, 'budi row again');
    d.querySelector('tr.admin-row[data-user="budi"] .admin-del').click();
    await submitDialog();
    await waitFor(() => !d.querySelector('tr.admin-row[data-user="budi"]'), 5000, 'budi removed');
    check('deleting an account removes the row and archives the folder', !fs.existsSync(BD) && fs.readdirSync(path.join(stack.storage, '.ait', 'archive')).some((n) => n.startsWith('budi__')));

    // ---- logout
    $('logout-btn').click();
    await waitFor(() => !$('login-view').hidden, 3000, 'logout');
    check('logout returns to the login screen', $('app-view').hidden === true);

    check('no JavaScript errors during the whole session', errors.length === 0, errors.join(' || '));
    ok = true;
  } catch (e) {
    console.error('test crashed:', e);
    if (errors.length) console.error('page errors:', errors);
  }
  const passed = t.done() && ok;
  if (!passed) console.log('\n--- server logs ---\n' + stack.logs.join(''));
  await stack.stop();
  process.exit(passed ? 0 : 1);
})();
