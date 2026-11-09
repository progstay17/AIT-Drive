'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const HDR = { 'X-Requested-With': 'drive' };
  const COARSE = window.matchMedia('(pointer: coarse)').matches;
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  let cwd = '';
  let items = [];
  let nodes = [];
  let view = lsGet('view') === 'list' ? 'list' : 'grid';
  let searching = false;
  let term = '';
  let selected = new Set();
  let lastIndex = -1;
  let suppressClickUntil = 0;
  let me = null;          // { id, name, role, quota, perms, canAdmin, canChangePassword }
  let adminMode = false;
  let lastStats = null;
  const can = (p) => !!(me && me.perms && me.perms[p]);

  // ---------------------------------------------------------------- utils
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const fmtSize = (n) => {
    if (!n) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (n >= 1024 && i < 4) { n /= 1024; i++; }
    return (n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)) + ' ' + u[i];
  };
  const fmtDate = (ms) => new Date(ms).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  const join = (a, b) => (a ? a + '/' + b : b);
  const parentOf = (p) => p.split('/').slice(0, -1).join('/');
  const extOf = (n) => (n.includes('.') ? n.split('.').pop().toLowerCase() : '');
  const qs = (o) => new URLSearchParams(o).toString();
  const dlUrl = (p, inline) => '/api/download?' + qs(inline ? { path: p, inline: '1' } : { path: p });

  const EXT = {
    image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'],
    video: ['mp4', 'webm', 'mov', 'mkv', 'm4v'],
    audio: ['mp3', 'wav', 'ogg', 'm4a', 'flac'],
    pdf: ['pdf'],
    doc: ['doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'ppt', 'pptx'],
    zip: ['zip', 'rar', '7z', 'tar', 'gz'],
    text: ['txt', 'md', 'json', 'csv', 'log', 'js', 'ts', 'py', 'html', 'css', 'xml', 'yml', 'yaml', 'ini', 'sh', 'sql'],
  };
  // icon = CSS class / svg key, preview = how the modal renders it
  function typeOf(it) {
    if (it.type === 'dir') return { icon: 'folder', preview: null };
    const e = extOf(it.name);
    if (EXT.image.includes(e)) return { icon: 'image', preview: 'image' };
    if (EXT.video.includes(e)) return { icon: 'video', preview: 'video' };
    if (EXT.audio.includes(e)) return { icon: 'other', preview: 'audio' };
    if (EXT.pdf.includes(e)) return { icon: 'pdf', preview: 'pdf' };
    if (EXT.doc.includes(e)) return { icon: 'doc', preview: null };
    if (EXT.zip.includes(e)) return { icon: 'zip', preview: null };
    if (EXT.text.includes(e)) return { icon: 'other', preview: 'text' };
    return { icon: 'other', preview: null };
  }

  // ---------------------------------------------------------------- icons (static markup only)
  const PAGE = '<path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M14 3v5h5"/>';
  const LABEL = (t) => `<text x="12" y="17" text-anchor="middle" font-size="5.4" font-weight="600" font-family="IBM Plex Mono, monospace" fill="currentColor" stroke="none">${t}</text>`;
  const ICONS = {
    folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" fill="currentColor" fill-opacity=".2"/>',
    image: '<rect x="4" y="5" width="16" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.4"/><path d="m4.5 17 4.5-4.2 3.2 3 2.3-2 5 4.2"/>',
    video: PAGE + '<path d="M10.2 11.4v5l4-2.5z"/>',
    pdf: PAGE + LABEL('PDF'),
    doc: PAGE + LABEL('DOC'),
    zip: PAGE + '<path d="M11 10h2M11 12.5h2"/><rect x="10" y="14.5" width="4" height="3.5" rx="1"/>',
    other: PAGE + '<path d="M9 12.5h6M9 15.5h4"/>',
  };
  const UI = {
    upload: '<path d="M12 16V5M7.5 9.5 12 5l4.5 4.5M5 19h14"/>',
    cloudOff: '<path d="M7 18a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17 9.5a3.8 3.8 0 0 1 .5 7.5"/><path d="m4 4 16 16"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5M12 16h.01"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
    warning: '<path d="M10.3 4.8 2.9 17.5A1.7 1.7 0 0 0 4.4 20h15.2a1.7 1.7 0 0 0 1.5-2.5L13.7 4.8a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 16h.01"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
  };
  function svg(inner, cls, size) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '1.7');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    if (cls) s.setAttribute('class', cls);
    if (size) { s.setAttribute('width', size); s.setAttribute('height', size); }
    s.innerHTML = inner;
    return s;
  }
  const fileIcon = (key) => svg(ICONS[key] || ICONS.other, 'file-type-icon ' + key);

  // ---------------------------------------------------------------- toasts
  function toast(o) {
    const kind = ['success', 'error', 'info', 'warning'].includes(o.kind) ? o.kind : 'success';
    const icon = (k) => k === 'error' ? UI.alert : k === 'warning' ? UI.warning : k === 'info' ? UI.info : UI.check;
    const t = el('div', 'toast toast-' + kind);
    t.setAttribute('role', kind === 'error' || kind === 'warning' ? 'alert' : 'status');
    t.setAttribute('aria-atomic', 'true');
    const mark = el('span', 'toast-mark');
    mark.appendChild(svg(icon(kind), null, 18));
    const body = el('div', 'toast-body');
    const title = el('div', 'toast-title', o.title || '');
    const msg = el('div', 'toast-message', o.message || '');
    body.append(title, msg);
    let fill = null;
    if (o.progress) {
      const track = el('div', 'progress-track');
      fill = el('div', 'progress-value');
      track.appendChild(fill);
      body.appendChild(track);
    }
    const actions = el('div', 'toast-actions');
    body.appendChild(actions);
    const close = el('button', 'btn btn-ghost btn-icon btn-sm toast-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Tutup notifikasi');
    close.appendChild(svg(UI.close, null, 14));
    t.append(mark, body, close);
    $('toasts').appendChild(t);

    let timer = null, remaining = o.timeout || 0, startedAt = 0, removed = false;
    const stopTimer = () => {
      if (!timer) return;
      clearTimeout(timer); timer = null;
      remaining = Math.max(0, remaining - (Date.now() - startedAt));
    };
    const startTimer = () => {
      if (!remaining || timer || removed || document.hidden) return;
      startedAt = Date.now();
      timer = setTimeout(() => ctl.close(), remaining);
    };
    const ctl = {
      el: t,
      close() {
        if (removed) return;
        removed = true; stopTimer();
        document.removeEventListener('visibilitychange', onVisibility);
        t.classList.add('is-leaving');
        const finish = () => t.remove();
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
        else t.addEventListener('transitionend', finish, { once: true });
        setTimeout(finish, 220);
      },
      setProgress(p) { if (fill) fill.style.setProperty('--progress', Math.max(0, Math.min(100, p)) + '%'); },
      update(patch) {
        if (patch.kind) {
          const next = ['success', 'error', 'info', 'warning'].includes(patch.kind) ? patch.kind : 'success';
          t.className = 'toast toast-' + next;
          t.setAttribute('role', next === 'error' || next === 'warning' ? 'alert' : 'status');
          mark.replaceChildren(svg(icon(next), null, 18));
        }
        if (patch.title != null) title.textContent = patch.title;
        if (patch.message != null) msg.textContent = patch.message;
        if (patch.hideProgress && fill) { fill.parentNode.remove(); fill = null; }
      },
      addAction(label, fn) {
        const b = el('button', 'btn btn-secondary btn-sm', label);
        b.type = 'button';
        b.onclick = () => { fn(); };
        actions.appendChild(b);
      },
      autoClose(ms) { stopTimer(); remaining = Math.max(0, ms); startTimer(); },
    };
    t.addEventListener('pointerenter', stopTimer);
    t.addEventListener('pointerleave', startTimer);
    t.addEventListener('focusin', stopTimer);
    t.addEventListener('focusout', (e) => { if (!t.contains(e.relatedTarget)) startTimer(); });
    const onVisibility = () => { if (document.hidden) stopTimer(); else startTimer(); };
    document.addEventListener('visibilitychange', onVisibility);
    close.onclick = ctl.close;
    startTimer();
    return ctl;
  }
  const ok = (title, message) => toast({ kind: 'success', title, message, timeout: 3600 });
  const fail = (title, message) => toast({ kind: 'error', title, message, timeout: 7000 });
  const info = (title, message) => toast({ kind: 'info', title, message, timeout: 5000 });
  const warn = (title, message) => toast({ kind: 'warning', title, message, timeout: 6500 });

  // ---------------------------------------------------------------- api
  async function api(path, opts = {}) {
    const r = await fetch(path, { credentials: 'same-origin', ...opts, headers: { ...HDR, ...(opts.headers || {}) } });
    if (r.status === 401) { showLogin(); throw new Error('Sesi berakhir, silakan masuk lagi'); }
    let data = null;
    try { data = await r.json(); } catch {}
    if (!r.ok) { const e = new Error((data && data.error) || 'Terjadi kesalahan'); e.status = r.status; throw e; }
    return data;
  }
  const post = (p, body) => api('/api/' + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const send = (method, p, body) => api(p, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  // ---------------------------------------------------------------- modals
  const modalStack = [];
  function openModal(build, opts = {}) {
    const prev = document.activeElement;
    const back = el('div', 'modal-backdrop');
    const box = el('div', 'modal' + (opts.small ? ' modal-sm' : ''));
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    back.appendChild(box);
    $('modal-root').appendChild(back);
    const m = { onclose: null, closed: false };
    m.close = (result) => {
      if (m.closed) return;
      m.closed = true;
      back.remove();
      const i = modalStack.indexOf(m);
      if (i >= 0) modalStack.splice(i, 1);
      if (prev && prev.focus) prev.focus();
      if (m.onclose) m.onclose(result === undefined ? null : result);
    };
    back.addEventListener('mousedown', (e) => { if (e.target === back) m.close(null); });
    modalStack.push(m);
    build(box, m.close);
    return m;
  }

  function dialog(o) {
    return new Promise((resolve) => {
      const m = openModal((box, close) => {
        const head = el('div', 'modal-header');
        head.appendChild(el('h2', 'modal-title', o.title));
        box.appendChild(head);
        const form = el('form', 'modal-body');
        if (o.message) form.appendChild(el('p', 'dialog-message muted', o.message));
        let input = null;
        if (o.input) {
          input = el('input', 'input');
          input.value = o.value || '';
          input.placeholder = o.placeholder || '';
          input.setAttribute('aria-label', o.title);
          if (o.readonly) input.readOnly = true;
          form.appendChild(input);
        }
        const actions = el('div', 'dialog-actions');
        const cancel = el('button', 'btn btn-secondary', o.cancel || 'Batal');
        cancel.type = 'button';
        cancel.onclick = () => close(null);
        const confirmBtn = el('button', 'btn ' + (o.danger ? 'btn-danger-solid' : 'btn-primary'), o.confirm || 'OK');
        confirmBtn.type = 'submit';
        actions.append(cancel, confirmBtn);
        form.appendChild(actions);
        form.addEventListener('submit', (e) => { e.preventDefault(); close(input ? input.value : true); });
        box.appendChild(form);
        setTimeout(() => { (input || confirmBtn).focus(); if (input) input.select(); }, 0);
      }, { small: true });
      m.onclose = resolve;
    });
  }

  // ---------------------------------------------------------------- views / auth
  function showLogin() {
    me = null; adminMode = false;
    $('app-view').hidden = true;
    $('login-view').hidden = false;
    clearInterval(pollTimer);
  }
  function showApp() { $('login-view').hidden = true; $('app-view').hidden = false; }

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('login-error');
    const u = $('login-user'), p = $('login-pass');
    err.hidden = true; u.classList.remove('is-invalid'); p.classList.remove('is-invalid');
    const btn = $('login-submit');
    btn.disabled = true; $('login-spinner').hidden = false; $('login-label').textContent = 'Masuk…';
    try {
      const r = await fetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u.value, password: p.value }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Gagal masuk');
      p.value = '';
      start();
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
      u.classList.add('is-invalid'); p.classList.add('is-invalid');
    } finally {
      btn.disabled = false; $('login-spinner').hidden = true; $('login-label').textContent = 'Masuk';
    }
  });
  $('logout-btn').addEventListener('click', async () => {
    try { await fetch('/auth/logout', { method: 'POST', headers: HDR }); } catch {}
    showLogin();
  });

  // ---------------------------------------------------------------- navigation
  const hashPath = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent).join('/');
  function nav(p) {
    const h = '#/' + p.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    if (location.hash === h) route(); else location.hash = h;
    closeDrawer();
  }
  function route() {
    if (location.hash === '#admin' && me && me.canAdmin) {
      adminMode = true; selected = new Set(); items = []; nodes = [];
      $('crumbs').replaceChildren(); $('count').textContent = '';
      admin.show();
      $('search').value = ''; $('search').disabled = true;
    } else {
      if (location.hash === '#admin') { location.hash = '#/'; return; }
      adminMode = false;
      load(hashPath());
    }
    $('search').disabled = adminMode;
    $('nav-drive').classList.toggle('is-active', !adminMode);
    $('nav-admin').classList.toggle('is-active', adminMode);
    if (adminMode) $('nav-admin').setAttribute('aria-current', 'page'); else $('nav-admin').removeAttribute('aria-current');
    if (adminMode) $('nav-drive').removeAttribute('aria-current'); else $('nav-drive').setAttribute('aria-current', 'page');
  }
  window.addEventListener('hashchange', () => { if (!$('app-view').hidden && me) route(); });
  $('nav-admin').addEventListener('click', () => closeDrawer());
  $('nav-drive').addEventListener('click', (e) => { e.preventDefault(); nav(''); });

  // ---------------------------------------------------------------- loading
  async function load(path) {
    searching = false; term = ''; $('search').value = '';
    $('content').classList.add('loading-fade');
    try {
      const d = await api('/api/list?' + qs({ path }));
      cwd = d.path;
      items = d.items.map((i) => ({ ...i, full: join(cwd, i.name), where: cwd }));
      selected = new Set(); lastIndex = -1;
      render();
    } catch (e) {
      if (e.message === 'Sesi berakhir, silakan masuk lagi') return;
      cwd = path; items = []; nodes = [];
      renderCrumbs();
      renderError(e);
    } finally {
      $('content').classList.remove('loading-fade');
    }
  }
  async function doSearch(t) {
    t = t.trim();
    if (!t) { searching = false; term = ''; return load(cwd); }
    $('content').classList.add('loading-fade');
    try {
      const d = await api('/api/search?' + qs({ q: t }));
      searching = true; term = t;
      items = d.items.map((i) => ({ ...i, full: i.path, where: parentOf(i.path) }));
      selected = new Set(); lastIndex = -1;
      render();
    } catch (e) { fail('Pencarian gagal', e.message); }
    finally { $('content').classList.remove('loading-fade'); }
  }
  const refresh = () => (searching ? doSearch(term) : load(cwd));

  let searchTimer;
  $('search').addEventListener('input', (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => doSearch(e.target.value), 250); });

  // ---------------------------------------------------------------- rendering
  function renderCrumbs() {
    const c = $('crumbs');
    c.replaceChildren();
    if (searching) {
      $('page-title').textContent = 'Hasil pencarian';
      const a = el('a', null, 'Drive Saya'); a.href = '#/'; a.onclick = (e) => { e.preventDefault(); $('search').value = ''; nav(''); };
      c.append(a, el('span', 'breadcrumb-sep', '/'), el('span', null, `“${term}”`));
      c.lastChild.setAttribute('aria-current', 'page');
      return;
    }
    const parts = cwd ? cwd.split('/') : [];
    $('page-title').textContent = parts.length ? parts[parts.length - 1] : 'Drive Saya';
    const add = (label, target, last) => {
      if (c.childNodes.length) c.appendChild(el('span', 'breadcrumb-sep', '/'));
      if (last) { const s = el('span', null, label); s.setAttribute('aria-current', 'page'); c.appendChild(s); return; }
      const a = el('a', null, label);
      a.href = '#/' + target.split('/').filter(Boolean).map(encodeURIComponent).join('/');
      a.onclick = (e) => { e.preventDefault(); nav(target); };
      c.appendChild(a);
    };
    add('Drive Saya', '', parts.length === 0);
    let acc = '';
    parts.forEach((p, i) => { acc = join(acc, p); add(p, acc, i === parts.length - 1); });
  }

  function stateBlock(kind, iconInner, title, copy, btnLabel, btnFn) {
    const box = el('div', kind === 'error' ? 'error-state' : 'empty-state');
    const ill = el('div', 'empty-illustration');
    ill.appendChild(svg(iconInner, null, 32));
    box.append(ill, el('h2', 'empty-title', title), el('p', 'empty-copy', copy));
    if (btnLabel) {
      const b = el('button', 'btn ' + (kind === 'error' ? 'btn-secondary' : 'btn-primary'), btnLabel);
      b.type = 'button'; b.onclick = btnFn; box.appendChild(b);
    }
    return box;
  }
  function renderError(e) {
    $('count').textContent = '';
    const offline = e.status === 502 || /PC tidak/.test(e.message);
    $('content').replaceChildren(stateBlock('error', UI.cloudOff,
      offline ? 'Koneksi terputus' : 'Gagal memuat',
      offline ? 'PC tidak terjangkau. Pastikan PC menyala dan agent berjalan.' : e.message,
      'Coba lagi', () => load(cwd)));
  }

  function render() {
    renderCrumbs();
    const box = $('content');
    box.replaceChildren();
    nodes = [];
    $('count').textContent = items.length ? `${items.length} item` : '';
    if (!items.length) {
      box.appendChild(searching
        ? stateBlock('empty', UI.alert, 'Tidak ditemukan', `Tidak ada hasil untuk “${term}”.`)
        : can('upload')
          ? stateBlock('empty', UI.upload, 'Belum ada file', 'Unggah file pertama kamu untuk memulai.', 'Unggah file', () => $('file-input').click())
          : stateBlock('empty', UI.upload, 'Belum ada file', 'Folder ini kosong.'));
      return;
    }
    box.appendChild(view === 'grid' ? buildGrid() : buildList());
    updateSelection();
  }

  function syncSelectionToolbar() {
    const box = $('content');
    const old = $('selection-toolbar');
    if (old) old.remove();
    if (!selected.size || adminMode || !items.length) return;
    const list = selectedItems();
    const bar = el('div', 'selection-toolbar');
    bar.id = 'selection-toolbar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Aksi item terpilih');
    const count = el('strong', 'selection-count', list.length + ' dipilih');
    bar.appendChild(count);
    const action = (label, fn, cls = 'btn btn-secondary btn-sm') => {
      const b = el('button', cls, label); b.type = 'button'; b.onclick = fn; bar.appendChild(b); return b;
    };
    action('Pilih semua', () => { selected = new Set(items.map((it) => it.full)); updateSelection(); });
    action('Buka', () => { if (list.length === 1) openItem(list[0]); }, 'btn btn-secondary btn-sm' + (list.length !== 1 ? ' is-hidden' : ''));
    action('Unduh', () => { for (const it of list) startDownload(it); });
    if (list.length === 1 && can('share')) action('Bagikan', () => share(list[0]));
    if (can('modify')) action('Pindahkan', () => move(list));
    if (can('delete')) action('Hapus', () => del(list), 'btn btn-danger-solid btn-sm');
    action('Batal pilih', () => { selected.clear(); lastIndex = -1; updateSelection(); }, 'btn btn-ghost btn-sm');
    box.insertBefore(bar, box.firstChild);
  }

  const subText = (it) => (it.type === 'dir' ? 'Folder' : fmtSize(it.size)) + (searching ? ' · ' + (it.where || 'Drive Saya') : '');

  function buildGrid() {
    const grid = el('div', 'file-grid');
    grid.setAttribute('role', 'listbox');
    grid.setAttribute('aria-multiselectable', 'true');
    items.forEach((it, i) => {
      const t = typeOf(it);
      const card = el('div', 'file-card');
      const thumb = el('div', 'file-thumb');
      if (t.icon === 'image' && it.size > 0 && it.size <= 2 * 1024 * 1024) {
        const img = el('img'); img.loading = 'lazy'; img.alt = ''; img.src = dlUrl(it.full, true);
        img.onerror = () => thumb.replaceChildren(fileIcon('image'));
        thumb.appendChild(img);
      } else thumb.appendChild(fileIcon(t.icon));
      const meta = el('div', 'file-meta');
      const text = el('div');
      text.append(el('div', 'file-name', it.name), el('div', 'file-sub', subText(it)));
      meta.appendChild(text);
      card.append(thumb, meta);
      addSelectionControl(card, i);
      bindItem(card, i);
      grid.appendChild(card);
    });
    return grid;
  }
  function buildList() {
    const wrap = el('div', 'file-list-wrap');
    const table = el('table', 'file-list');
    const thead = el('thead'); const hr = el('tr');
    for (const h of ['Nama', 'Ukuran', 'Diubah']) { const th = el('th', null, h); th.scope = 'col'; hr.appendChild(th); }
    thead.appendChild(hr); table.appendChild(thead);
    const tbody = el('tbody');
    items.forEach((it, i) => {
      const t = typeOf(it);
      const tr = el('tr', 'file-row');
      const td = el('td', 'col-name');
      const meta = el('div', 'file-meta');
      const text = el('div');
      text.appendChild(el('div', 'file-name', it.name));
      if (searching) text.appendChild(el('div', 'file-sub', it.where || 'Drive Saya'));
      meta.append(fileIcon(t.icon), text);
      const check = selectionControl(i);
      meta.insertBefore(check, meta.firstChild);
      td.appendChild(meta);
      tr.append(td, el('td', 'col-num', it.type === 'dir' ? '—' : fmtSize(it.size)), el('td', 'col-num', fmtDate(it.mtime)));
      bindItem(tr, i);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); wrap.appendChild(table);
    return wrap;
  }

  // ---------------------------------------------------------------- selection + item events
  function selectionControl(i) {
    const it = items[i];
    const b = el('button', 'selection-check');
    b.type = 'button';
    b.setAttribute('aria-label', 'Pilih ' + it.name);
    b.setAttribute('aria-pressed', selected.has(it.full) ? 'true' : 'false');
    b.appendChild(svg(UI.check, null, 14));
    b.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (selected.has(it.full)) selected.delete(it.full);
      else { selected.add(it.full); lastIndex = i; }
      updateSelection();
    });
    return b;
  }
  function addSelectionControl(node, i) { node.appendChild(selectionControl(i)); }
  function bindItem(node, i) {
    const it = items[i];
    nodes[i] = node;
    node.tabIndex = 0;
    node.setAttribute('role', 'option');
    node.dataset.path = it.full;
    node.title = it.name;
    node.addEventListener('click', (e) => {
      if (Date.now() < suppressClickUntil) return;
      select(i, e);
    });
    node.addEventListener('dblclick', () => openItem(it));
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); openItem(it); }
      else if (e.key === ' ') { e.preventDefault(); select(i, e); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); focusNode(i + 1); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); focusNode(i - 1); }
      else if (e.key === 'F10' && e.shiftKey) { e.preventDefault(); ctxFromNode(node, i); }
    });
    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (e.clientX === 0 && e.clientY === 0) return ctxFromNode(node, i);
      ctxFor(i, e.clientX, e.clientY);
    });
    let timer;
    node.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      timer = setTimeout(() => { suppressClickUntil = Date.now() + 700; ctxFor(i, t.clientX, t.clientY); }, 520);
    }, { passive: true });
    for (const ev of ['touchend', 'touchmove', 'touchcancel']) node.addEventListener(ev, () => clearTimeout(timer), { passive: true });
  }
  function focusNode(i) { if (nodes[i]) nodes[i].focus(); }
  function ctxFromNode(node, i) { const r = node.getBoundingClientRect(); ctxFor(i, r.left + Math.min(r.width / 2, 120), r.top + r.height / 2); }
  function ctxFor(i, x, y) {
    if (!selected.has(items[i].full)) { selected = new Set([items[i].full]); lastIndex = i; updateSelection(); }
    showCtx(x, y, selectedItems());
  }
  function select(i, e) {
    const it = items[i];
    if (e && e.shiftKey && lastIndex >= 0) {
      const [a, b] = [Math.min(lastIndex, i), Math.max(lastIndex, i)];
      selected = new Set(items.slice(a, b + 1).map((x) => x.full));
    } else if (e && (e.ctrlKey || e.metaKey)) {
      selected.has(it.full) ? selected.delete(it.full) : selected.add(it.full);
      lastIndex = i;
    } else {
      selected = new Set([it.full]); lastIndex = i;
    }
    updateSelection();
  }
  function updateSelection() {
    nodes.forEach((n, i) => {
      if (!n) return;
      const s = selected.has(items[i].full);
      n.classList.toggle('is-selected', s);
      n.setAttribute('aria-selected', s ? 'true' : 'false');
      const check = n.querySelector('.selection-check');
      if (check) {
        check.classList.toggle('is-checked', s);
        check.setAttribute('aria-pressed', s ? 'true' : 'false');
        check.setAttribute('aria-label', (s ? 'Batalkan pilihan ' : 'Pilih ') + items[i].name);
      }
    });
    syncSelectionToolbar();
  }
  const selectedItems = () => items.filter((i) => selected.has(i.full));

  // ---------------------------------------------------------------- open / preview
  function openItem(it) {
    if (it.type === 'dir') return nav(it.full);
    preview(it);
  }
  function preview(it) {
    const t = typeOf(it);
    const url = dlUrl(it.full, true);
    const ext = extOf(it.name).toUpperCase() || 'FILE';
    openModal((box, close) => {
      const head = el('div', 'modal-header');
      const left = el('div', 'modal-head-text');
      left.append(el('h2', 'modal-title', it.name), el('div', 'file-sub', `${ext} · ${fmtSize(it.size)} · Diubah ${fmtDate(it.mtime)}`));
      const right = el('div', 'modal-head-actions');
      const dl = el('a', 'btn btn-secondary btn-sm', 'Unduh'); dl.href = dlUrl(it.full); dl.setAttribute('download', '');
      const x = el('button', 'btn btn-ghost btn-icon btn-sm'); x.type = 'button'; x.setAttribute('aria-label', 'Tutup'); x.appendChild(svg(UI.close, null, 16)); x.onclick = () => close(null);
      right.append(dl, x);
      head.append(left, right);
      const body = el('div', 'modal-body');
      const stage = el('div', 'preview-stage');
      if (t.preview === 'image') { const m = el('img'); m.src = url; m.alt = it.name; stage.appendChild(m); }
      else if (t.preview === 'video') { const v = el('video'); v.src = url; v.controls = true; v.autoplay = true; stage.appendChild(v); }
      else if (t.preview === 'audio') { const a = el('audio'); a.src = url; a.controls = true; a.autoplay = true; stage.appendChild(a); }
      else if (t.preview === 'pdf') { const f = el('iframe'); f.src = url; f.title = it.name; stage.appendChild(f); }
      else if (t.preview === 'text' && it.size <= 1024 * 1024) {
        const pre = el('pre', 'preview-text', 'Memuat…'); stage.appendChild(pre);
        fetch(url, { credentials: 'same-origin' }).then((r) => (r.ok ? r.text() : Promise.reject())).then((tx) => { pre.textContent = tx; }).catch(() => { pre.textContent = 'Gagal memuat pratinjau.'; });
      } else {
        const info = el('div', 'preview-info');
        const msg = t.preview === 'text' ? 'File terlalu besar untuk pratinjau.' : 'Pratinjau tidak tersedia untuk tipe file ini.';
        info.append(fileIcon(t.icon), el('strong', null, it.name), el('div', 'file-sub', `${ext} · ${fmtSize(it.size)}`), el('p', 'muted', msg));
        const b = el('a', 'btn btn-primary', 'Unduh file'); b.href = dlUrl(it.full); b.setAttribute('download', '');
        info.appendChild(b);
        stage.appendChild(info);
      }
      body.appendChild(stage);
      box.append(head, body);
      x.focus();
    });
  }

  // ---------------------------------------------------------------- context menu
  let ctxEl = null;
  function hideCtx() { if (ctxEl) { ctxEl.remove(); ctxEl = null; } }
  function showCtx(x, y, list) {
    hideCtx();
    const m = el('div', 'context-menu');
    m.setAttribute('role', 'menu');
    const head = el('div', 'context-head');
    head.append(el('div', 'file-name', list.length === 1 ? list[0].name : `${list.length} item`), el('div', 'eyebrow', 'Dipilih'));
    m.appendChild(head);
    const add = (label, fn, danger) => {
      const b = el('button', danger ? 'is-danger' : null, label);
      b.type = 'button'; b.setAttribute('role', 'menuitem');
      b.onclick = () => { hideCtx(); fn(); };
      m.appendChild(b);
    };
    if (list.length === 1) {
      const it = list[0];
      add(it.type === 'dir' ? 'Buka' : 'Pratinjau', () => openItem(it));
      add(it.type === 'dir' ? 'Unduh folder (.zip)' : 'Unduh', () => startDownload(it));
      if (can('modify')) add('Ganti nama', () => rename(it));
      if (can('modify')) add('Pindahkan ke…', () => move(list));
      if (can('share')) add(it.type === 'dir' ? 'Bagikan folder' : 'Buat link berbagi', () => share(it));
    } else if (can('modify')) {
      add('Pindahkan ke…', () => move(list));
    }
    if (can('delete')) {
      m.appendChild(el('hr'));
      add(list.length === 1 ? 'Hapus' : `Hapus ${list.length} item`, () => del(list), true);
    }
    document.body.appendChild(m);
    ctxEl = m;
    const w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + 'px';
    m.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + 'px';
    const btns = [...m.querySelectorAll('button')];
    if (btns[0]) btns[0].focus();
    m.addEventListener('keydown', (e) => {
      const idx = btns.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); btns[(idx + 1) % btns.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); btns[(idx - 1 + btns.length) % btns.length].focus(); }
    });
  }
  document.addEventListener('mousedown', (e) => { if (ctxEl && !ctxEl.contains(e.target)) hideCtx(); });
  document.addEventListener('scroll', hideCtx, true);
  window.addEventListener('resize', hideCtx);
  window.addEventListener('blur', hideCtx);

  // ---------------------------------------------------------------- file operations
  async function rename(it) {
    const n = await dialog({ title: 'Ganti nama', input: true, value: it.name, confirm: 'Simpan' });
    if (!n || n === it.name) return;
    try { await post('rename', { path: it.full, newName: n }); ok('Nama diubah', n); refresh(); } catch (e) { fail('Gagal mengganti nama', e.message); }
  }
  async function move(list) {
    const initial = parentOf(list[0].full);
    const dest = await new Promise((resolve) => {
      const modal = openModal((box, close) => {
        box.classList.add('folder-picker-modal');
        const head = el('div', 'modal-header');
        head.append(el('h2', 'modal-title', 'Pindahkan ke folder'), el('p', 'muted folder-picker-help', 'Jelajahi folder tujuan. File baru dipindahkan setelah kamu konfirmasi.'));
        box.appendChild(head);
        const body = el('div', 'modal-body folder-picker');
        const crumbs = el('nav', 'folder-picker-crumbs');
        crumbs.setAttribute('aria-label', 'Lokasi tujuan');
        const listBox = el('div', 'folder-picker-list');
        const status = el('p', 'muted folder-picker-status', 'Memuat folder…');
        const actions = el('div', 'dialog-actions folder-picker-actions');
        const cancel = el('button', 'btn btn-secondary', 'Batal');
        cancel.type = 'button'; cancel.onclick = () => close(null);
        const choose = el('button', 'btn btn-primary', 'Pindahkan ke sini');
        choose.type = 'button';
        actions.append(cancel, choose);
        body.append(crumbs, status, listBox, actions);
        box.appendChild(body);
        let current = initial;
        choose.onclick = () => close(current);
        async function browse(path) {
          current = path; status.textContent = 'Memuat folder…'; listBox.replaceChildren(); choose.disabled = true;
          crumbs.replaceChildren();
          const parts = path ? path.split('/') : [];
          const crumb = (label, target, last) => {
            if (crumbs.childNodes.length) crumbs.appendChild(el('span', 'breadcrumb-sep', '/'));
            const b = el('button', 'folder-crumb' + (last ? ' is-current' : ''), label);
            b.type = 'button'; b.disabled = last; b.onclick = () => browse(target); crumbs.appendChild(b);
          };
          crumb('Drive Saya', '', parts.length === 0);
          let acc = '';
          parts.forEach((part, index) => { acc = join(acc, part); crumb(part, acc, index === parts.length - 1); });
          try {
            const data = await api('/api/list?' + qs({ path }));
            if (current !== path) return;
            const folders = (data.items || []).filter((item) => item.type === 'dir').sort((a, b) => a.name.localeCompare(b.name));
            status.textContent = folders.length ? 'Ketuk folder untuk membukanya' : 'Tidak ada subfolder di lokasi ini';
            for (const folder of folders) {
              const row = el('button', 'folder-picker-item'); row.type = 'button';
              row.append(svg(ICONS.folder, 'folder-picker-icon', 20), el('span', 'folder-picker-name', folder.name), svg('<path d="m9 18 6-6-6-6"/>', 'folder-picker-arrow', 16));
              row.onclick = () => browse(join(path, folder.name)); listBox.appendChild(row);
            }
            choose.disabled = false;
          } catch (e) { status.textContent = 'Folder tidak bisa dimuat: ' + e.message; }
        }
        browse(initial);
        modalStack[modalStack.length - 1].onclose = resolve;
      });
    });
    if (dest === null) return;
    let moved = 0;
    for (const it of list) {
      try { await post('move', { path: it.full, dest }); moved++; } catch (e) { fail(`Gagal memindahkan ${it.name}`, e.message); }
    }
    if (moved) ok('Dipindahkan', `${moved} item`);
    refresh();
  }
  async function del(list) {
    if (!can('delete')) return fail('Tidak diizinkan', 'Akun kamu tidak punya izin menghapus.');
    const label = list.length === 1 ? `“${list[0].name}”` : `${list.length} item`;
    const yes = await dialog({ title: 'Hapus?', message: `${label} akan dipindah ke folder .trash di PC.`, confirm: 'Hapus', danger: true });
    if (!yes) return;
    let n = 0;
    for (const it of list) {
      try { await post('delete', { path: it.full }); n++; } catch (e) { fail(`Gagal menghapus ${it.name}`, e.message); }
    }
    if (n) ok('Dihapus', `${n} item dipindah ke .trash`);
    refresh(); loadStats();
  }
  async function share(it) {
    const kind = it.type === 'dir' ? 'folder' : 'file';
    const days = await dialog({ title: 'Bagikan ' + kind, message: 'Siapa pun yang memiliki link dapat ' + (it.type === 'dir' ? 'mengunduh folder ini sebagai ZIP beserta isinya' : 'mengunduh file ini') + '. Link berlaku 1–30 hari.', input: true, value: '7', confirm: 'Buat link' });
    if (!days) return;
    try {
      const d = await post('share', { path: it.full, days: parseInt(days, 10) || 7 });
      const link = await dialog({ title: 'Link siap', message: `Berlaku ${d.days} hari.`, input: true, value: d.url, readonly: true, confirm: 'Salin link' });
      if (link === null) return;
      try { await navigator.clipboard.writeText(d.url); ok('Link disalin', `Berlaku ${d.days} hari`); }
      catch { fail('Tidak bisa menyalin otomatis', 'Salin manual dari kotak link.'); }
    } catch (e) { fail('Gagal membuat link', e.message); }
  }
  async function mkdir() {
    if (!can('modify')) return fail('Tidak diizinkan', 'Akun kamu tidak punya izin membuat folder.');
    const n = await dialog({ title: 'Folder baru', input: true, placeholder: 'Nama folder', confirm: 'Buat' });
    if (!n) return;
    try { await post('mkdir', { path: cwd, name: n }); refresh(); } catch (e) { fail('Gagal membuat folder', e.message); }
  }
  $('mkdir-btn').onclick = mkdir;
  $('mkdir-btn-top').onclick = mkdir;

  // ---------------------------------------------------------------- view + theme
  function applyViewIcons() {
    $('view-icon-grid').hidden = view !== 'grid';
    $('view-icon-list').hidden = view !== 'list';
  }
  $('view-btn').onclick = () => { view = view === 'grid' ? 'list' : 'grid'; lsSet('view', view); applyViewIcons(); render(); };
  $('theme-btn').onclick = () => {
    const root = document.documentElement;
    const cur = root.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next); lsSet('theme', next);
  };

  // ---------------------------------------------------------------- upload
  const pickFiles = () => $('file-input').click();
  $('upload-btn').onclick = () => { pickFiles(); closeDrawer(); };
  $('upload-btn-top').onclick = pickFiles;
  $('file-input').onchange = (e) => { uploadFiles([...e.target.files]); e.target.value = ''; };
  $('folder-upload-btn').onclick = () => $('folder-input').click();
  $('folder-input').onchange = (e) => { uploadFiles([...e.target.files]); e.target.value = ''; };

  let afterTimer;
  function afterUpload(dest) {
    clearTimeout(afterTimer);
    afterTimer = setTimeout(() => { if (!adminMode && !searching && cwd === dest) load(cwd); loadStats(); }, 400);
  }
  async function uploadFiles(files) {
    if (!can('upload')) return fail('Tidak diizinkan', 'Akun kamu tidak punya izin mengunggah.');
    const dest = cwd;
    for (const entry of files) {
      const file = entry && entry.file ? entry.file : entry;
      const relativePath = entry && entry.file ? entry.path : (file.webkitRelativePath || file.name);
      if (!file) continue;
      if (lastStats && lastStats.free != null && file.size > lastStats.free) {
        fail(file.name, `Kuota tidak cukup. Sisa ${fmtSize(lastStats.free)}, file ini ${fmtSize(file.size)}.`);
        continue;
      }
      await uploadOne(file, dest, relativePath);
    }
  }
  // ---------------------------------------------------------------- transfer manager
  const transfers = [];
  let transferPanel = null;
  let transferButton = null;
  const transferLabel = (t) => t.kind === 'upload' ? 'Unggah' : 'Unduh';
  function ensureTransferUI() {
    if (transferButton) return;
    transferButton = el('button', 'btn btn-secondary btn-sm transfer-trigger', 'Transfer');
    transferButton.type = 'button';
    transferButton.setAttribute('aria-label', 'Buka pengelola transfer');
    transferButton.onclick = () => {
      ensureTransferPanel();
      transferPanel.hidden = !transferPanel.hidden;
      renderTransfers();
    };
    document.querySelector('.topbar-actions').insertBefore(transferButton, document.querySelector('.topbar-actions').firstChild);
    ensureTransferPanel();
  }
  function ensureTransferPanel() {
    if (transferPanel) return;
    transferPanel = el('section', 'transfer-panel');
    transferPanel.hidden = true;
    transferPanel.setAttribute('aria-label', 'Pengelola transfer');
    const head = el('div', 'transfer-head');
    head.append(el('div', 'transfer-heading', 'Pengelola transfer'), el('button', 'btn btn-ghost btn-icon btn-sm', '×'));
    head.lastChild.type = 'button'; head.lastChild.setAttribute('aria-label', 'Tutup pengelola transfer');
    head.lastChild.onclick = () => { transferPanel.hidden = true; };
    const summary = el('div', 'transfer-summary');
    const list = el('div', 'transfer-list');
    const foot = el('div', 'transfer-foot');
    const clear = el('button', 'btn btn-ghost btn-sm', 'Bersihkan selesai'); clear.type = 'button';
    clear.onclick = () => { for (let i = transfers.length - 1; i >= 0; i--) if (['done','error','cancelled'].includes(transfers[i].state)) transfers.splice(i, 1); renderTransfers(); };
    foot.appendChild(clear);
    transferPanel.append(head, summary, list, foot);
    document.body.appendChild(transferPanel);
  }
  function addTransfer(kind, name, detail) {
    ensureTransferUI();
    const task = { id: Date.now() + Math.random(), kind, name, detail: detail || '', state: 'active', progress: 0, message: 'Menyiapkan…', xhr: null };
    transfers.unshift(task);
    renderTransfers();
    transferPanel.hidden = false;
    return task;
  }
  function updateTransfer(task, patch) {
    Object.assign(task, patch);
    renderTransfers();
  }
  function renderTransfers() {
    if (!transferPanel) return;
    const active = transfers.filter(t => t.state === 'active').length;
    transferPanel.querySelector('.transfer-summary').textContent = active ? active + ' transfer sedang berjalan' : transfers.length + ' aktivitas';
    const list = transferPanel.querySelector('.transfer-list');
    list.replaceChildren();
    if (!transfers.length) { list.appendChild(el('p', 'muted transfer-empty', 'Belum ada aktivitas transfer.')); return; }
    for (const task of transfers.slice(0, 40)) {
      const row = el('article', 'transfer-row');
      const top = el('div', 'transfer-row-top');
      const name = el('div', 'transfer-name', task.name);
      const state = el('span', 'transfer-state transfer-' + task.state, task.state === 'active' ? task.progress + '%' : task.state === 'done' ? 'Selesai' : task.state === 'cancelled' ? 'Dibatalkan' : 'Gagal');
      top.append(name, state);
      const meta = el('div', 'transfer-meta', transferLabel(task) + (task.detail ? ' · ' + task.detail : '') + ' · ' + task.message);
      const track = el('div', 'progress-track');
      const fill = el('div', 'progress-value'); fill.style.setProperty('--progress', task.progress + '%'); track.appendChild(fill);
      row.append(top, meta, track);
      if (task.state === 'active' && task.xhr) {
        const cancel = el('button', 'btn btn-ghost btn-sm transfer-cancel', 'Batalkan'); cancel.type = 'button';
        cancel.onclick = () => task.xhr && task.xhr.abort();
        row.appendChild(cancel);
      } else if (task.state === 'error' && task.retry) {
        const retry = el('button', 'btn btn-secondary btn-sm', 'Coba lagi'); retry.type = 'button'; retry.onclick = task.retry; row.appendChild(retry);
      }
      list.appendChild(row);
    }
  }
  function startDownload(it, existingTask) {
    const task = existingTask || addTransfer('download', it.name, it.type === 'dir' ? 'Folder ZIP' : fmtSize(it.size));
    const x = new XMLHttpRequest(); task.xhr = x;
    x.open('GET', dlUrl(it.full));
    x.responseType = 'blob';
    x.setRequestHeader('X-Requested-With', 'drive');
    x.onprogress = (e) => {
      if (!e.lengthComputable) { updateTransfer(task, { message: 'Mengunduh…' }); return; }
      updateTransfer(task, { progress: Math.round(e.loaded / e.total * 100), message: fmtSize(e.loaded) + ' / ' + fmtSize(e.total) });
    };
    x.onload = () => {
      task.xhr = null;
      if (x.status >= 200 && x.status < 300) {
        const blob = x.response;
        const url = URL.createObjectURL(blob);
        const a = el('a'); a.href = url; a.download = it.type === 'dir' ? it.name + '.zip' : it.name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        updateTransfer(task, { state: 'done', progress: 100, message: fmtSize(blob.size) });
      } else {
        let msg = 'Gagal mengunduh';
        try { msg = JSON.parse(x.responseText).error || msg; } catch {}
        updateTransfer(task, { state: 'error', message: msg });
        task.retry = () => { task.state = 'active'; task.progress = 0; task.message = 'Mencoba ulang…'; startDownload(it, task); renderTransfers(); };
      }
    };
    x.onerror = () => { task.xhr = null; updateTransfer(task, { state: 'error', message: 'Koneksi terputus' }); };
    x.onabort = () => { task.xhr = null; updateTransfer(task, { state: 'cancelled', message: 'Dibatalkan' }); };
    x.send();
    return task;
  }

  function uploadOne(file, dest, relativePath) {
    return new Promise((resolve) => {
      const task = addTransfer('upload', file.name, relativePath || file.name);
      const x = new XMLHttpRequest(); task.xhr = x;
      const fd = new FormData();
      fd.append('file', file, relativePath || file.webkitRelativePath || file.name);
      x.open('POST', '/api/upload?' + qs({ path: dest }));
      x.setRequestHeader('X-Requested-With', 'drive');
      x.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const p = Math.round((e.loaded / e.total) * 100);
        task.progress = p; task.message = fmtSize(e.loaded) + ' / ' + fmtSize(e.total);
        renderTransfers();
      };
      const failed = (msg) => {
        task.xhr = null; updateTransfer(task, { state: 'error', message: msg });
        task.retry = () => uploadOne(file, dest, relativePath);
        resolve(false);
      };
      x.onload = () => {
        task.xhr = null;
        if (x.status >= 200 && x.status < 300) {
          task.progress = 100; updateTransfer(task, { state: 'done', progress: 100, message: fmtSize(file.size) });
          afterUpload(dest); resolve(true);
        } else {
          let m = 'Gagal mengunggah';
          try { m = JSON.parse(x.responseText).error || m; } catch {}
          if (x.status === 401) showLogin();
          failed(m);
        }
      };
      x.onerror = () => failed('Koneksi terputus');
      x.onabort = () => { task.xhr = null; updateTransfer(task, { state: 'cancelled', message: 'Dibatalkan' }); resolve(false); };
      x.send(fd);
    });
  }

  // drag & drop (window-wide)
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => { if (hasFiles(e) && !$('app-view').hidden) { dragDepth++; $('dropzone').hidden = false; } });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('dropzone').hidden = true; });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  function readDroppedEntry(entry, parent = '') {
    if (entry.isFile) {
      return new Promise((resolve) => entry.file(
        (file) => resolve([{ file, path: parent + file.name }]),
        () => resolve([])
      ));
    }
    if (!entry.isDirectory) return Promise.resolve([]);
    const reader = entry.createReader();
    const readBatch = () => new Promise((resolve) => reader.readEntries(resolve, () => resolve([])));
    return (async () => {
      const out = [];
      while (true) {
        const batch = await readBatch();
        if (!batch.length) break;
        for (const child of batch) out.push(...await readDroppedEntry(child, parent + entry.name + '/'));
      }
      return out;
    })();
  }
  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0; $('dropzone').hidden = true;
    if ($('app-view').hidden) return;
    const files = [];
    for (const item of e.dataTransfer.items || []) {
      if (item.kind !== 'file') continue;
      const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
      if (entry) files.push(...await readDroppedEntry(entry));
      else {
        const file = item.getAsFile();
        if (file) files.push({ file, path: file.name });
      }
    }
    if (files.length) await uploadFiles(files);
  });

  // ---------------------------------------------------------------- status + storage
  let pollTimer;
  async function loadStats() {
    try {
      const s = await api('/api/stats');
      lastStats = s;
      const cap = s.quota != null ? s.quota : s.used + s.free;
      const pct = cap ? Math.min(100, (s.used / cap) * 100) : 0;
      $('storage-fill').style.setProperty('--progress', pct.toFixed(1) + '%');
      $('storage-text').textContent = `${fmtSize(s.used)} / ${fmtSize(cap)}`;
      const cap2 = $('storage-caption');
      cap2.textContent = s.quota != null ? `${fmtSize(s.free)} sisa kuota` : `${fmtSize(s.free)} masih kosong di PC`;
      cap2.classList.toggle('is-warn', s.quota != null && pct >= 90);
      const tb = $('trash-btn');
      tb.hidden = !(s.trash > 0);
      tb.textContent = `Lihat sampah (${fmtSize(s.trash || 0)})`;
    } catch {}
  }
  let previousAgentState = null;
  async function pollStatus() {
    try {
      const s = await api('/api/status');
      const online = !!s.agent;
      $('agent-dot').className = 'status-dot ' + (online ? 'on' : 'off');
      $('agent-text').textContent = online ? 'PC online' : 'PC offline';
      if (previousAgentState !== null && previousAgentState !== online) {
        if (online) info('Koneksi pulih', 'PC storage kembali online. File bisa diakses lagi.');
        else warn('PC storage offline', 'Koneksi ke PC terputus. Operasi file mungkin belum tersedia.');
      }
      previousAgentState = online;
    } catch {}
  }

  // ---------------------------------------------------------------- mobile drawer
  function closeDrawer() { $('sidebar').classList.remove('is-open'); $('scrim').hidden = true; $('menu-btn').setAttribute('aria-expanded', 'false'); }
  $('menu-btn').onclick = () => {
    const open = !$('sidebar').classList.contains('is-open');
    $('sidebar').classList.toggle('is-open', open);
    $('scrim').hidden = !open;
    $('menu-btn').setAttribute('aria-expanded', String(open));
  };
  $('scrim').onclick = closeDrawer;

  // ---------------------------------------------------------------- global keys
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (modalStack.length) { modalStack[modalStack.length - 1].close(null); return; }
      if (ctxEl) { hideCtx(); return; }
      if ($('sidebar').classList.contains('is-open')) { closeDrawer(); return; }
      if (selected.size) { selected = new Set(); updateSelection(); }
      return;
    }
    const tag = document.activeElement && document.activeElement.tagName;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || modalStack.length || $('app-view').hidden) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault(); selected = new Set(items.map((i) => i.full)); updateSelection();
    } else if (e.key === 'Delete' && selected.size) {
      e.preventDefault(); del(selectedItems());
    }
  });
  // click on empty page area clears selection
  $('page').addEventListener('click', (e) => { if (!e.target.closest('.file-card, .file-row, a, button')) { selected = new Set(); updateSelection(); } });

  // ---------------------------------------------------------------- boot
  function setHeading(title, sub) {
    $('page-title').textContent = title;
    $('crumbs').replaceChildren();
    if (sub) $('crumbs').appendChild(el('span', null, sub));
  }
  const admin = window.AITAdmin.create({
    el, svg, UI, fmtSize, fmtDate, api, send, ok, fail, info, warn, openModal, dialog, setHeading,
    content: $('content'), me: () => me,
  });

  function applyMe() {
    const initials = (me.name || '?').slice(0, 2);
    $('account').hidden = false;
    $('account-avatar').textContent = initials;
    $('account-name').textContent = me.name;
    $('account-role').textContent = me.role === 'owner' ? 'Owner' : me.role === 'admin' ? 'Admin' : 'Pengguna';
    $('pw-btn').hidden = !me.canChangePassword;
    $('nav-admin').hidden = !me.canAdmin;
    const up = can('upload'), mod = can('modify');
    for (const id of ['upload-btn', 'upload-btn-top']) { $(id).disabled = !up; $(id).title = up ? '' : 'Tidak punya izin mengunggah'; }
    for (const id of ['mkdir-btn', 'mkdir-btn-top']) { $(id).disabled = !mod; $(id).title = mod ? '' : 'Tidak punya izin membuat folder'; }
    $('folder-upload-btn').disabled = !up; $('folder-upload-btn').title = up ? '' : 'Tidak punya izin mengunggah';
  }

  $('pw-btn').onclick = () => {
    openModal((box, close) => {
      box.style.width = 'min(100%, 440px)';
      const head = el('div', 'modal-header'); head.appendChild(el('h2', 'modal-title', 'Ganti password')); box.appendChild(head);
      const form = el('form', 'modal-body');
      const mk = (id, label) => {
        const i = el('input', 'input'); i.type = 'password'; i.id = id; i.autocomplete = id === 'pw-current' ? 'current-password' : 'new-password';
        const w = el('label', 'form-field'); w.append(document.createTextNode(label), i); form.appendChild(w); return i;
      };
      const cur = mk('pw-current', 'Password saat ini');
      const nw = mk('pw-new', 'Password baru (minimal 8 karakter)');
      const cf = mk('pw-confirm', 'Ulangi password baru');
      const err = el('p', 'form-error'); err.id = 'pw-error'; err.hidden = true; form.appendChild(err);
      const actions = el('div', 'dialog-actions');
      const cancel = el('button', 'btn btn-secondary', 'Batal'); cancel.type = 'button'; cancel.onclick = () => close(null);
      const submit = el('button', 'btn btn-primary', 'Simpan'); submit.type = 'submit';
      actions.append(cancel, submit); form.appendChild(actions);
      form.addEventListener('submit', async (e) => {
        e.preventDefault(); err.hidden = true;
        if (nw.value !== cf.value) { err.textContent = 'Konfirmasi password tidak sama.'; err.hidden = false; return; }
        submit.disabled = true;
        try {
          await post('me/password', { current: cur.value, next: nw.value });
          close(true); ok('Password diganti', 'Silakan masuk lagi dengan password baru.');
          setTimeout(() => { fetch('/auth/logout', { method: 'POST', headers: HDR }).finally(showLogin); }, 900);
        } catch (ex) { err.textContent = ex.message; err.hidden = false; }
        finally { submit.disabled = false; }
      });
      box.appendChild(form);
      setTimeout(() => cur.focus(), 0);
    });
  };

  $('trash-btn').onclick = async () => {
    try {
      const data = await api('/api/trash');
      openModal((box, close) => {
        box.style.width = 'min(100%, 680px)';
        const head = el('div', 'modal-header');
        head.appendChild(el('h2', 'modal-title', 'Sampah'));
        box.appendChild(head);
        const body = el('div', 'modal-body');
        if (!data.items.length) body.appendChild(el('p', 'muted', 'Sampah kosong.'));
        for (const item of data.items) {
          const row = el('div', 'admin-row');
          const info = el('div');
          info.append(el('div', 'file-name', item.name), el('div', 'field-hint', item.originalPath || 'Lokasi asal tidak diketahui'));
          const restore = el('button', 'btn btn-secondary btn-sm', 'Pulihkan');
          restore.type = 'button';
          restore.onclick = async () => {
            restore.disabled = true;
            try {
              const restored = await post('trash/restore', { id: item.id });
              const restoredPath = restored.path || item.originalPath || '';
              ok('Item dipulihkan', restoredPath ? `Lokasi: ${restoredPath}` : item.name);
              close(true);
              const destination = parentOf(restoredPath);
              if (destination !== cwd || searching) nav(destination);
              else load(cwd);
              loadStats();
            } catch (e) { restore.disabled = false; fail('Gagal memulihkan', e.message); }
          };
          row.append(info, restore); body.appendChild(row);
        }
        const actions = el('div', 'dialog-actions');
        const empty = el('button', 'btn btn-danger', 'Kosongkan sampah'); empty.type = 'button'; empty.disabled = !data.items.length || !can('delete');
        empty.onclick = async () => {
          const yes = await dialog({ title: 'Hapus permanen?', message: 'Semua item di sampah akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.', confirm: 'Hapus permanen', danger: true });
          if (!yes) return;
          try { await post('trash/empty', {}); ok('Sampah dikosongkan'); close(true); loadStats(); }
          catch (e) { fail('Gagal mengosongkan sampah', e.message); }
        };
        const done = el('button', 'btn btn-secondary', 'Tutup'); done.type = 'button'; done.onclick = () => close(null);
        actions.append(empty, done); body.appendChild(actions); box.appendChild(body);
      });
    } catch (e) { fail('Gagal membuka sampah', e.message); }
  };

  async function start() {
    try {
      me = await api('/api/me');
    } catch (e) {
      try { await fetch('/auth/logout', { method: 'POST', headers: HDR }); } catch {}
      showLogin();
      if (e && e.message && !/Sesi berakhir/.test(e.message)) fail('Tidak bisa masuk', e.message);
      return;
    }
    showApp();
    ensureTransferUI();
    applyViewIcons();
    applyMe();
    route();
    loadStats(); pollStatus();
    clearInterval(pollTimer); pollTimer = setInterval(pollStatus, 20000);
  }
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}), { once: true });
  }

  (async () => {
    try {
      const r = await fetch('/auth/me', { credentials: 'same-origin' });
      const d = await r.json();
      d.authenticated ? start() : showLogin();
    } catch { showLogin(); }
  })();
})();
