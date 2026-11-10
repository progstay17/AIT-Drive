'use strict';
(() => {
  const dictionaries = {
    en: {
      'Cloud pribadi kamu':'Your private cloud','Selamat datang kembali.':'Welcome back.','Masuk untuk membuka file pribadi kamu.':'Sign in to access your private files.','Username':'Username','Password':'Password','Masuk':'Sign in','Masuk…':'Signing in…','Penyimpanan privat. File kamu, kendali kamu.':'Private storage. Your files, your control.','Unggah':'Upload files','Unggah folder':'Upload folder','Drive Saya':'My Drive','Link Berbagi':'Shared links','Panel Admin':'Admin panel','Ganti password':'Change password','Personal Access Tokens':'Personal access tokens','Penyimpanan':'Storage','Lihat sampah':'View trash','PC: memeriksa…':'Storage PC: checking…','Cari file dan folder…':'Search files and folders…','Folder baru':'New folder','Keluar':'Sign out','Lokasi':'Location','Lepaskan untuk mengunggah':'Drop to upload','File akan masuk ke folder yang sedang dibuka':'Files will be added to the current folder','Tutup notifikasi':'Dismiss notification','Hasil pencarian':'Search results','Memuat link berbagi…':'Loading shared links…','Belum ada link berbagi':'No shared links yet','Link yang kamu buat dari menu Bagikan akan muncul di sini.':'Links you create from Share will appear here.','Aktif':'Active','Kedaluwarsa':'Expired','Tidak valid':'Invalid','URL otomatis':'Automatic URL','Salin':'Copy','Cabut':'Revoke','Cabut link?':'Revoke link?','Link ini akan langsung berhenti berfungsi dan slug-nya bisa digunakan kembali.':'This link will stop working immediately and its slug can be reused.','Cabut link':'Revoke link','Link disalin':'Link copied','Tidak bisa menyalin':'Unable to copy','Salin URL langsung dari tautan.':'Copy the URL directly from the link.','Link dicabut':'Link revoked','Tautan tidak bisa digunakan lagi.':'This link can no longer be used.','Gagal mencabut link':'Could not revoke link','Pencarian gagal':'Search failed','Koneksi terputus':'Connection lost','PC tidak terjangkau. Pastikan PC menyala dan agent berjalan.':'Storage PC is unreachable. Make sure the PC is on and the agent is running.','Gagal memuat':'Could not load','Coba lagi':'Try again','Tidak ditemukan':'No results found','Belum ada file':'No files yet','Unggah file pertama kamu untuk memulai.':'Upload your first file to get started.','Folder ini kosong.':'This folder is empty.','Aksi item terpilih':'Selected item actions','dipilih':'selected','Pilih semua':'Select all','Buka':'Open','Unduh':'Download','Bagikan':'Share','Pindahkan':'Move','Hapus':'Delete','Batal pilih':'Clear selection','Folder':'Folder','Tidak ada hasil untuk':'No results for','Unggah file':'Upload file','File tidak tersedia':'File unavailable','Berakhir':'Expires','Custom URL':'Custom URL','URL otomatis':'Automatic URL','Sesi berakhir, silakan masuk lagi':'Session expired. Please sign in again','Terjadi kesalahan':'Something went wrong','Gagal masuk':'Sign-in failed','Batal':'Cancel','OK':'OK','Hasil pencarian':'Search results','item':'items','Drive':'Drive','Sampah':'Trash','Akun':'Account','Pengguna':'Users','Storage nodes':'Storage nodes','Tambah storage':'Add storage','Tambah pengguna':'Add user','Akun dibuat':'Account created','Perubahan disimpan':'Changes saved','Edit':'Edit','Hapus akun?':'Delete account?','Akun dihapus':'Account deleted','Gagal menghapus akun':'Could not delete account','Belum pernah':'Never','Tanpa batas':'Unlimited','Semua izin':'All permissions','Hanya baca':'Read only','Disk PC':'Storage PC disk','Kuota dialokasikan':'Allocated quota','Terpakai pengguna':'Used by users','tidak termasuk owner':'excluding owner','tersedia':'available','Offline':'Offline','Tambah storage node':'Add storage node','Simpan storage':'Save storage','Storage ditambahkan':'Storage added','Gagal memuat panel admin…':'Loading admin panel…','Akun, kuota disk, dan izin':'Accounts, disk quota, and permissions','Pengguna':'Users','Kuota penyimpanan (GB)':'Storage quota (GB)','Izin':'Permissions','Akun aktif (bisa masuk)':'Active account (can sign in)','Buat akun':'Create account','Simpan':'Save','Buat acak':'Generate','Gagal memuat panel admin':'Could not load admin panel','Tidak bisa masuk':'Unable to sign in'
    },
    zh: {
      'Cloud pribadi kamu':'您的私人云盘','Selamat datang kembali.':'欢迎回来。','Masuk untuk membuka file pribadi kamu.':'登录以访问您的私人文件。','Username':'用户名','Password':'密码','Masuk':'登录','Masuk…':'正在登录…','Penyimpanan privat. File kamu, kendali kamu.':'私人存储，文件由您掌控。','Unggah':'上传文件','Unggah folder':'上传文件夹','Drive Saya':'我的云盘','Link Berbagi':'共享链接','Panel Admin':'管理面板','Ganti password':'修改密码','Personal Access Tokens':'个人访问令牌','Penyimpanan':'存储空间','Lihat sampah':'查看回收站','PC: memeriksa…':'存储设备：检查中…','Cari file dan folder…':'搜索文件和文件夹…','Folder baru':'新建文件夹','Keluar':'退出','Lokasi':'位置','Lepaskan untuk mengunggah':'松开以上传','File akan masuk ke folder yang sedang dibuka':'文件将上传到当前文件夹','Tutup notifikasi':'关闭通知','Hasil pencarian':'搜索结果','Memuat link berbagi…':'正在加载共享链接…','Belum ada link berbagi':'暂无共享链接','Link yang kamu buat dari menu Bagikan akan muncul di sini.':'您创建的共享链接将显示在这里。','Aktif':'启用','Kedaluwarsa':'已过期','Tidak valid':'无效','URL otomatis':'自动 URL','Salin':'复制','Cabut':'撤销','Cabut link?':'撤销链接？','Link ini akan langsung berhenti berfungsi dan slug-nya bisa digunakan kembali.':'此链接将立即失效，其标识可再次使用。','Cabut link':'撤销链接','Link disalin':'链接已复制','Tidak bisa menyalin':'无法复制','Salin URL langsung dari tautan.':'请直接从链接复制 URL。','Link dicabut':'链接已撤销','Tautan tidak bisa digunakan lagi.':'此链接已无法使用。','Gagal mencabut link':'撤销链接失败','Pencarian gagal':'搜索失败','Koneksi terputus':'连接已断开','PC tidak terjangkau. Pastikan PC menyala dan agent berjalan.':'无法连接存储设备。请确认电脑已开机且 Agent 正在运行。','Gagal memuat':'加载失败','Coba lagi':'重试','Tidak ditemukan':'未找到结果','Belum ada file':'暂无文件','Unggah file pertama kamu untuk memulai.':'上传第一个文件以开始使用。','Folder ini kosong.':'此文件夹为空。','Aksi item terpilih':'所选项目操作','dipilih':'已选择','Pilih semua':'全选','Buka':'打开','Unduh':'下载','Bagikan':'共享','Pindahkan':'移动','Hapus':'删除','Batal pilih':'取消选择','Folder':'文件夹','File tidak tersedia':'文件不可用','Berakhir':'到期','Custom URL':'自定义 URL','Sesi berakhir, silakan masuk lagi':'会话已过期，请重新登录','Terjadi kesalahan':'发生错误','Gagal masuk':'登录失败','Batal':'取消','OK':'确定','item':'个项目','Sampah':'回收站','Akun':'账户','Pengguna':'用户','Storage nodes':'存储节点','Tambah storage':'添加存储','Tambah pengguna':'添加用户','Akun dibuat':'账户已创建','Perubahan disimpan':'更改已保存','Edit':'编辑','Hapus akun?':'删除账户？','Akun dihapus':'账户已删除','Gagal menghapus akun':'删除账户失败','Belum pernah':'从未','Tanpa batas':'不限','Semua izin':'全部权限','Hanya baca':'只读','Disk PC':'存储设备磁盘','Kuota dialokasikan':'已分配配额','Terpakai pengguna':'用户已用空间','tidak termasuk owner':'不含所有者','tersedia':'可用','Offline':'离线','Tambah storage node':'添加存储节点','Simpan storage':'保存存储','Storage ditambahkan':'已添加存储','Gagal memuat panel admin…':'正在加载管理面板…','Akun, kuota disk, dan izin':'账户、磁盘配额和权限','Pengguna':'用户','Kuota penyimpanan (GB)':'存储配额 (GB)','Izin':'权限','Akun aktif (bisa masuk)':'账户已启用（可登录）','Buat akun':'创建账户','Simpan':'保存','Buat acak':'随机生成','Gagal memuat panel admin':'管理面板加载失败'
    }
  };
  let language = (() => { try { const v = localStorage.getItem('ait-language'); return ['id','en','zh'].includes(v) ? v : 'id'; } catch { return 'id'; } })();
  const t = (value) => {
    if (typeof value !== 'string' || language === 'id') return value;
    return (dictionaries[language] && dictionaries[language][value]) || value;
  };
  const translateNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const raw = node.nodeValue;
      const trimmed = raw.trim();
      if (!trimmed) return;
      const translated = t(trimmed);
      if (translated !== trimmed) node.nodeValue = raw.replace(trimmed, translated);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    for (const attr of ['placeholder','aria-label','title']) {
      if (node.hasAttribute(attr)) {
        const v = node.getAttribute(attr), next = t(v);
        if (next !== v) node.setAttribute(attr, next);
      }
    }
    node.childNodes.forEach(translateNode);
  };
  const apply = () => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : language;
    document.querySelectorAll('[data-i18n]').forEach((node) => {
      const key = node.getAttribute('data-i18n');
      if (node.dataset.i18nOriginal == null) node.dataset.i18nOriginal = node.textContent;
      node.textContent = language === 'id' ? node.dataset.i18nOriginal : t(node.dataset.i18nOriginal);
    });
    translateNode(document.body);
    const select = document.getElementById('language-select');
    if (select && select.value !== language) select.value = language;
    document.documentElement.dataset.language = language;
  };
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'childList') record.addedNodes.forEach(translateNode);
      else if (record.type === 'characterData') translateNode(record.target);
      else if (record.type === 'attributes') translateNode(record.target);
    }
  });
  window.AITLang = {
    t, get: () => language,
    set(next) {
      if (!['id','en','zh'].includes(next)) return;
      language = next;
      try { localStorage.setItem('ait-language', language); } catch {}
      window.location.reload();
    }
  };
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    const select = document.getElementById('language-select');
    if (select) select.addEventListener('change', () => window.AITLang.set(select.value));
    observer.observe(document.body, { subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:['placeholder','aria-label','title'] });
  });
  if (document.readyState !== 'loading') apply();
})();