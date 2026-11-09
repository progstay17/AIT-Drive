'use strict';
// AIT Drive - admin panel (accounts, disk quota, permissions).
// Loaded before app.js; app.js calls AITAdmin.create(helpers) once and then show()/hide().
(function () {
  const GB = 1024 * 1024 * 1024;
  const PERMS = [
    ['upload', 'Unggah file'],
    ['modify', 'Buat folder, ganti nama, pindah'],
    ['delete', 'Hapus file'],
    ['share', 'Buat link berbagi'],
  ];
  const PERM_SHORT = { upload: 'Unggah', modify: 'Ubah', delete: 'Hapus', share: 'Bagikan' };

  window.AITAdmin = {
    create(h) {
      const { el, fmtSize, fmtDate } = h;
      let users = [];
      let nodes = [];
      let ov = null;

      const toGb = (b) => (b == null ? '' : String(Math.round((b / GB) * 100) / 100));
      const fromGb = (s) => {
        const v = String(s).trim().replace(',', '.');
        if (v === '') return null;
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 ? Math.round(n * GB) : NaN;
      };
      const canManage = (u) => !(u.role === 'admin' && h.me().role !== 'owner');
      const remaining = (editing) => (ov ? Math.max(0, ov.capacity - (ov.allocated - (editing && editing.quota ? editing.quota : 0))) : 0);

      function randomPassword() {
        const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        const buf = new Uint32Array(14);
        crypto.getRandomValues(buf);
        return Array.from(buf, (n) => chars[n % chars.length]).join('');
      }

      // ---------------------------------------------------------------- view
      async function show() {
        const box = h.content;
        box.replaceChildren(el('p', 'muted', 'Memuat panel admin…'));
        h.setHeading('Panel Admin', 'Akun, kuota disk, dan izin');
        try {
          const [o, u, n] = await Promise.all([h.api('/api/admin/overview'), h.api('/api/admin/users'), h.api('/api/admin/nodes')]);
          ov = o; users = u.users; nodes = n.nodes;
          draw();
        } catch (e) {
          box.replaceChildren(el('p', 'form-error', e.message));
          h.fail('Gagal memuat panel admin', e.message);
        }
      }

      function card(title, value, sub, bar) {
        const c = el('div', 'stat-card');
        c.append(el('div', 'eyebrow', title), el('div', 'stat-value', value), el('div', 'stat-sub', sub));
        if (bar != null) {
          const t = el('div', 'progress-track'); const f = el('div', 'progress-value');
          f.style.setProperty('--progress', Math.min(100, bar).toFixed(1) + '%');
          t.appendChild(f); c.appendChild(t);
        }
        return c;
      }

      function draw() {
        const box = h.content;
        box.replaceChildren();
        const wrap = el('div', 'admin');

        const cards = el('div', 'stat-grid');
        cards.append(
          card('Disk PC', fmtSize(ov.diskTotal), `${fmtSize(ov.diskFree)} masih kosong`),
          card('Kuota dialokasikan', fmtSize(ov.allocated), `dari ${fmtSize(ov.capacity)} yang bisa dialokasikan`, ov.capacity ? (ov.allocated / ov.capacity) * 100 : 0),
          card('Terpakai pengguna', fmtSize(ov.usedUsers), `Owner memakai ${fmtSize(ov.ownerUsed)}`),
          card('Akun', String(ov.userCount), 'tidak termasuk owner'),
        );
        wrap.appendChild(cards);

        const storageHead = el('div', 'admin-bar');
        storageHead.appendChild(el('h2', 'section-title', 'Storage nodes'));
        if (h.me().role === 'owner') {
          const addNode = el('button', 'btn btn-secondary btn-sm', 'Tambah storage');
          addNode.type = 'button'; addNode.onclick = openNodeForm; storageHead.appendChild(addNode);
        }
        wrap.appendChild(storageHead);
        const nodeGrid = el('div', 'stat-grid');
        for (const n of nodes) {
          const c = card(n.name, n.online ? fmtSize(n.diskFree) + ' tersedia' : 'Offline', `${n.accounts} akun · ${n.primary ? 'Primary' : n.id}`, n.diskTotal ? ((n.diskTotal - n.diskFree) / n.diskTotal) * 100 : 0);
          c.classList.add(n.online ? 'node-online' : 'node-offline');
          nodeGrid.appendChild(c);
        }
        wrap.appendChild(nodeGrid);

        if (ov.allowOverbook) {
          wrap.appendChild(el('p', 'admin-note', 'Mode overbooking aktif: total kuota boleh melebihi kapasitas disk. Pastikan disk tidak penuh.'));
        } else {
          wrap.appendChild(el('p', 'admin-note', `Kuota hanyalah batas, bukan ruang yang dikunci di muka. Total kuota tidak boleh melebihi kapasitas disk. Sisa yang bisa dialokasikan: ${fmtSize(ov.unallocated)}.`));
        }

        const bar = el('div', 'admin-bar');
        bar.appendChild(el('h2', 'section-title', 'Pengguna'));
        const add = el('button', 'btn btn-primary', 'Tambah pengguna');
        add.type = 'button'; add.id = 'admin-add';
        add.onclick = () => openForm(null);
        bar.appendChild(add);
        wrap.appendChild(bar);

        if (!users.length) {
          const empty = el('div', 'empty-state');
          empty.append(el('h2', 'empty-title', 'Belum ada pengguna'), el('p', 'empty-copy', 'Tambah akun pertama. Setiap akun punya folder, kuota, dan izin sendiri.'));
          wrap.appendChild(empty);
        } else {
          wrap.appendChild(table());
        }
        box.appendChild(wrap);
      }

      function table() {
        const scroll = el('div', 'file-list-wrap');
        const t = el('table', 'file-list admin-table');
        const hr = el('tr');
        for (const x of ['Pengguna', 'Storage', 'Kuota', 'Izin', 'Login terakhir', '']) { const th = el('th', null, x); th.scope = 'col'; hr.appendChild(th); }
        const thead = el('thead'); thead.appendChild(hr); t.appendChild(thead);
        const tb = el('tbody');
        for (const u of users) {
          const tr = el('tr', 'file-row admin-row');
          tr.dataset.user = u.id;

          const c1 = el('td');
          const nm = el('div', 'file-name', u.id);
          const badges = el('div', 'badges');
          badges.appendChild(el('span', 'badge ' + (u.role === 'admin' ? 'badge-accent' : ''), u.role === 'admin' ? 'Admin' : 'Pengguna'));
          if (!u.active) badges.appendChild(el('span', 'badge badge-danger', 'Nonaktif'));
          c1.append(nm, badges);

          const node = nodes.find((n) => n.id === u.nodeId);
          const cNode = el('td', null, node ? node.name : (u.nodeId || 'primary'));

          const c2 = el('td', 'col-quota');
          if (u.quota != null) {
            const pct = u.quota ? (u.used / u.quota) * 100 : 0;
            const track = el('div', 'progress-track'); const f = el('div', 'progress-value' + (pct >= 90 ? ' is-warn' : ''));
            f.style.setProperty('--progress', Math.min(100, pct).toFixed(1) + '%');
            track.appendChild(f);
            c2.append(el('div', 'col-num', `${fmtSize(u.used)} / ${fmtSize(u.quota)}`), track);
          } else {
            c2.appendChild(el('div', 'col-num', `${fmtSize(u.used)} · tanpa batas`));
          }

          const c3 = el('td');
          const chips = el('div', 'badges');
          if (u.role === 'admin') chips.appendChild(el('span', 'badge', 'Semua izin'));
          else {
            const on = PERMS.filter(([k]) => u.perms[k]);
            if (!on.length) chips.appendChild(el('span', 'badge', 'Hanya baca'));
            for (const [k] of on) chips.appendChild(el('span', 'badge', PERM_SHORT[k]));
          }
          c3.appendChild(chips);

          const c4 = el('td', 'col-num', u.lastLogin ? fmtDate(u.lastLogin) : 'Belum pernah');

          const c5 = el('td', 'col-actions');
          const edit = el('button', 'btn btn-secondary btn-sm admin-edit', 'Edit');
          edit.type = 'button'; edit.disabled = !canManage(u);
          edit.onclick = () => openForm(u);
          const del = el('button', 'btn btn-danger btn-sm admin-del', 'Hapus');
          del.type = 'button'; del.disabled = !canManage(u);
          del.onclick = () => remove(u);
          c5.append(edit, del);

          tr.append(c1, cNode, c2, c3, c4, c5);
          tb.appendChild(tr);
        }
        t.appendChild(tb); scroll.appendChild(t);
        return scroll;
      }

      // ---------------------------------------------------------------- create / edit
      function field(label, input, hint) {
        const w = el('label', 'form-field');
        w.append(document.createTextNode(label), input);
        if (hint) w.appendChild(el('span', 'field-hint', hint));
        return w;
      }

      function openForm(u) {
        const editing = !!u;
        h.openModal((box, close) => {
          box.style.width = 'min(100%, 520px)';
          const head = el('div', 'modal-header');
          head.appendChild(el('h2', 'modal-title', editing ? `Edit ${u.id}` : 'Tambah pengguna'));
          box.appendChild(head);

          const form = el('form', 'modal-body'); form.id = 'user-form'; form.noValidate = true;

          const username = el('input', 'input'); username.id = 'f-username'; username.autocomplete = 'off';
          username.placeholder = 'mis. budi'; username.value = editing ? u.id : ''; username.disabled = editing;
          form.appendChild(field('Username', username, editing ? 'Username tidak bisa diubah.' : 'Huruf kecil, angka, titik, minus, garis bawah. 3-32 karakter.'));

          const pw = el('input', 'input'); pw.id = 'f-password'; pw.type = 'text'; pw.autocomplete = 'off';
          pw.placeholder = editing ? 'Kosongkan jika tidak diubah' : 'Minimal 8 karakter';
          const gen = el('button', 'btn btn-secondary btn-sm', 'Buat acak'); gen.type = 'button'; gen.id = 'f-gen';
          gen.onclick = () => { pw.value = randomPassword(); pw.focus(); pw.select(); };
          const pwField = field(editing ? 'Password baru' : 'Password', pw, editing ? 'Mengganti password mengeluarkan akun ini dari semua perangkat.' : 'Catat dan berikan ke pengguna. Password tidak bisa dilihat lagi nanti.');
          pwField.appendChild(gen);
          form.appendChild(pwField);

          const nodeSelect = el('select', 'input'); nodeSelect.id = 'f-node';
          for (const n of nodes) nodeSelect.appendChild(new Option(`${n.name}${n.online ? '' : ' · offline'}`, n.id));
          nodeSelect.value = editing ? (u.nodeId || 'primary') : 'primary';
          form.appendChild(field('Storage node', nodeSelect, 'Akun ditempatkan pada satu PC storage. Pemindahan akun yang sudah berisi data membutuhkan migrasi terverifikasi.'));

          const role = el('select', 'input'); role.id = 'f-role';
          role.appendChild(new Option('Pengguna', 'user'));
          if (h.me().role === 'owner') role.appendChild(new Option('Admin (bisa mengelola pengguna)', 'admin'));
          role.value = editing ? u.role : 'user';
          form.appendChild(field('Peran', role));

          const quota = el('input', 'input'); quota.id = 'f-quota'; quota.type = 'number'; quota.min = '0.01'; quota.step = '0.1';
          quota.placeholder = 'GB'; quota.value = editing ? toGb(u.quota) : '5';
          const quotaHint = el('span', 'field-hint');
          const quotaField = field('Kuota penyimpanan (GB)', quota);
          quotaField.appendChild(quotaHint);
          form.appendChild(quotaField);

          const permsBox = el('fieldset', 'perm-set');
          permsBox.appendChild(el('legend', 'eyebrow', 'Izin'));
          const checks = {};
          const base = editing ? u.perms : { upload: true, modify: true, delete: true, share: false };
          for (const [k, label] of PERMS) {
            const row = el('label', 'check');
            const cb = el('input'); cb.type = 'checkbox'; cb.id = 'f-perm-' + k; cb.checked = !!base[k];
            checks[k] = cb;
            row.append(cb, el('span', null, label));
            permsBox.appendChild(row);
          }
          permsBox.appendChild(el('p', 'field-hint', 'Melihat dan mengunduh selalu boleh. Tanpa izin apa pun, akun hanya bisa membaca.'));
          form.appendChild(permsBox);

          const active = el('input'); active.type = 'checkbox'; active.id = 'f-active'; active.checked = editing ? u.active : true;
          const activeRow = el('label', 'check');
          activeRow.append(active, el('span', null, 'Akun aktif (bisa masuk)'));
          form.appendChild(activeRow);

          const err = el('p', 'form-error'); err.id = 'user-form-error'; err.hidden = true;
          form.appendChild(err);

          const actions = el('div', 'dialog-actions');
          const cancel = el('button', 'btn btn-secondary', 'Batal'); cancel.type = 'button'; cancel.onclick = () => close(null);
          const submit = el('button', 'btn btn-primary', editing ? 'Simpan' : 'Buat akun'); submit.type = 'submit'; submit.id = 'f-submit';
          actions.append(cancel, submit);
          form.appendChild(actions);

          const sync = () => {
            const isAdmin = role.value === 'admin';
            for (const k of Object.keys(checks)) { checks[k].disabled = isAdmin; if (isAdmin) checks[k].checked = true; }
            quota.placeholder = isAdmin ? 'Kosong = tanpa batas' : 'GB';
            quotaHint.textContent = isAdmin
              ? 'Admin boleh tanpa kuota. Kosongkan untuk tanpa batas.'
              : `Batas maksimal, bukan ruang yang dikunci. Sisa yang bisa dialokasikan: ${fmtSize(remaining(editing ? u : null))}.`;
          };
          role.onchange = sync; sync();

          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            err.hidden = true;
            const q = fromGb(quota.value);
            if (Number.isNaN(q)) { err.textContent = 'Kuota harus berupa angka.'; err.hidden = false; return; }
            const perms = {}; for (const [k] of PERMS) perms[k] = checks[k].checked;
            const body = { role: role.value, quota: q, perms, active: active.checked, nodeId: nodeSelect.value };
            if (pw.value) body.password = pw.value;
            if (!editing) { body.username = username.value; if (!pw.value) { err.textContent = 'Password wajib diisi.'; err.hidden = false; return; } }
            submit.disabled = true;
            try {
              if (editing) await h.send('PATCH', '/api/admin/users/' + encodeURIComponent(u.id), body);
              else await h.send('POST', '/api/admin/users', body);
              close(true);
              h.ok(editing ? 'Perubahan disimpan' : 'Akun dibuat', editing ? u.id : username.value.trim().toLowerCase());
              show();
            } catch (ex) {
              err.textContent = ex.message; err.hidden = false;
            } finally { submit.disabled = false; }
          });

          box.appendChild(form);
          setTimeout(() => (editing ? pw : username).focus(), 0);
        });
      }

      async function remove(u) {
        const yes = await h.dialog({
          title: 'Hapus akun?',
          message: `Akun "${u.id}" tidak bisa masuk lagi. Datanya TIDAK dihapus: foldernya dipindah ke .ait/archive di PC dan bisa dipulihkan manual.`,
          confirm: 'Hapus akun', danger: true,
        });
        if (!yes) return;
        try { await h.send('DELETE', '/api/admin/users/' + encodeURIComponent(u.id)); h.ok('Akun dihapus', u.id); show(); }
        catch (e) { h.fail('Gagal menghapus akun', e.message); }
      }

      function openNodeForm() {
        h.openModal((box, close) => {
          box.style.width = 'min(100%, 520px)';
          const head = el('div', 'modal-header'); head.appendChild(el('h2', 'modal-title', 'Tambah storage node')); box.appendChild(head);
          const form = el('form', 'modal-body'); form.noValidate = true;
          const id = el('input', 'input'); id.placeholder = 'mis. storage-02'; id.autocomplete = 'off';
          const name = el('input', 'input'); name.placeholder = 'Nama PC / lokasi';
          const url = el('input', 'input'); url.placeholder = 'https://storage-02.example.com';
          const token = el('input', 'input'); token.type = 'password'; token.placeholder = 'AGENT_TOKEN dari Agent';
          form.append(field('ID node (huruf kecil, angka, minus)', id), field('Nama storage', name), field('URL Agent melalui HTTPS / tunnel', url), field('Token Agent', token, 'Token disimpan di volume gateway dan tidak ditampilkan kembali.'));
          const hint = el('p', 'field-hint', 'Jangan expose port Agent 4001 ke internet. Gunakan HTTPS melalui tunnel/reverse proxy yang sudah diamankan.');
          form.appendChild(hint);
          const err = el('p', 'form-error'); err.hidden = true; form.appendChild(err);
          const actions = el('div', 'dialog-actions');
          const cancel = el('button', 'btn btn-secondary', 'Batal'); cancel.type = 'button'; cancel.onclick = () => close(null);
          const submit = el('button', 'btn btn-primary', 'Simpan storage'); submit.type = 'submit'; actions.append(cancel, submit); form.appendChild(actions);
          form.addEventListener('submit', async (e) => {
            e.preventDefault(); err.hidden = true; submit.disabled = true;
            try { await h.send('POST', '/api/admin/nodes', { id: id.value, name: name.value, url: url.value, token: token.value }); close(true); h.ok('Storage ditambahkan', name.value); show(); }
            catch (ex) { err.textContent = ex.message; err.hidden = false; }
            finally { submit.disabled = false; }
          });
          box.appendChild(form); setTimeout(() => id.focus(), 0);
        });
      }

      return { show, hide() { users = []; nodes = []; ov = null; } };
    },
  };
})();
