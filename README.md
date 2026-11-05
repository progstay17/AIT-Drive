# AIT Drive

Cloud drive pribadi dengan **file yang tetap tersimpan di PC kamu sendiri**, dibuka lewat web yang bisa kamu deploy di Coolify.

> Dibuat oleh **Fadhil Ghifarion 法迪 for AIT**

- Tanpa langganan storage: kapasitas = disk PC kamu.
- Tanpa port-forward: PC terhubung lewat tunnel (Cloudflare Tunnel atau Tailscale).
- Tanpa framework dan tanpa build step di sisi UI (HTML + CSS + JavaScript biasa).
- Dua komponen kecil dengan dependensi minimal (`express`, `busboy`).
- Banyak akun tanpa signup: **panel admin** untuk membuat akun, menentukan kapasitas disk per akun (kuota), dan mengatur izin.

## Daftar isi

1. [Fitur](#fitur)
2. [Cara kerja](#cara-kerja)
3. [Prasyarat](#prasyarat)
4. [Mulai cepat (lokal)](#mulai-cepat-lokal)
5. [Deploy ke internet](#deploy-ke-internet)
6. [Konfigurasi](#konfigurasi)
7. [Memakai UI](#memakai-ui)
8. [Struktur proyek](#struktur-proyek)
9. [Tes](#tes)
10. [Keamanan](#keamanan)
11. [Batasan dan rencana](#batasan-dan-rencana)
12. [Dokumentasi lanjutan](#dokumentasi-lanjutan)
13. [Kredit](#kredit)

## Fitur

| Area | Yang tersedia |
|---|---|
| Akun | Owner dari environment variable, admin dan pengguna dibuat lewat panel admin. Folder terpisah per akun, kuota disk per akun, izin (unggah, ubah, hapus, bagikan), nonaktifkan, reset password, arsip saat akun dihapus |
| File | Lihat, unggah (banyak file sekaligus, drag and drop, progress per file, tombol coba lagi), unduh, ganti nama, pindah, hapus |
| Folder | Buat folder, navigasi dengan breadcrumb, pencarian ke seluruh drive |
| Pratinjau | Gambar, video, audio, PDF, teks (sampai 1 MB). Tipe lain menampilkan info dan tombol unduh |
| Berbagi | Link berbagi bertanda tangan dan kedaluwarsa (1 sampai 30 hari), bisa dibuka tanpa login |
| Keamanan | Login dengan rate limit, cookie HttpOnly, perlindungan CSRF, token agent, anti path traversal, hapus lembut ke `.trash`, kuota ditegakkan di agent (cek awal dan saat streaming) |
| Tampilan | Grid atau daftar, tema terang/gelap/ikut sistem, responsif (sidebar jadi drawer di HP), dukungan keyboard |
| Operasional | Indikator "PC online/offline", pesan jelas saat PC mati atau token tidak cocok |

## Cara kerja

```
Browser ──HTTPS──> Coolify: web/ (login, UI, proxy) ──tunnel──> PC kamu: agent/ ──> folder penyimpanan
```

- **`agent/`** berjalan di PC dan **hanya mengurus file**: membuka satu folder (`STORAGE_ROOT`, yang kamu pilih lewat `agent\setup-agent.bat`) lewat API HTTP yang dilindungi token. Kuota dan izin dikirim gateway di setiap permintaan.
- **`web/`** berjalan di server (Coolify/Docker) dan menjadi **server utama**: login, akun, kuota, izin, panel admin, dan UI. Data akun disimpan di volume `/data`. Meneruskan permintaan file ke agent dengan token rahasia yang tidak pernah dikirim ke browser.
- **Tunnel** menghubungkan server ke agent tanpa membuka port di router.

Penjelasan rinci: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Prasyarat

- Windows, macOS, atau Linux untuk PC yang menyimpan file (panduan di sini memakai Windows).
- [Node.js](https://nodejs.org) versi 20 atau lebih baru di PC tersebut.
- Untuk produksi: server Coolify, akun GitHub, dan (disarankan) akun Cloudflare dengan sebuah domain.

## Mulai cepat (lokal)

Cara ini menjalankan semuanya di satu PC untuk dicoba.

```bash
# 1. pasang dependensi semua komponen
npm run install:all

# 2. buat konfigurasi agent
agent\setup-agent.bat                           # Windows: pilih folder storage lewat jendela, agent.env dibuat otomatis
# (manual: salin agent\agent.env.example menjadi agent\agent.env lalu isi AGENT_TOKEN acak minimal 24 karakter)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. jalankan agent (jendela terpisah)
agent\start-agent.bat

# 4. buat web\local.env berisi:
#    ADMIN_USER=nama-kamu
#    ADMIN_PASSWORD=password-kuat
#    SESSION_SECRET=<hex acak 64 karakter>
# lalu jalankan web
web\start-web-local.bat
```

Buka **http://localhost:3000** (bukan port 4001, itu agent dan memang hanya menjawab "unauthorized" tanpa token), lalu masuk dengan username dan password dari `web\local.env`.

Di Linux/macOS, jalankan manual dengan environment variable, contoh:

```bash
AGENT_TOKEN=... STORAGE_ROOT=$HOME/ait-drive npm run start:agent
ADMIN_USER=han ADMIN_PASSWORD=... SESSION_SECRET=... AGENT_URL=http://127.0.0.1:4001 \
AGENT_TOKEN=... COOKIE_SECURE=false npm run start:web
```

## Deploy ke internet

Ringkasannya:

1. Agent jalan otomatis di PC (Task Scheduler) dan PC tidak tidur.
2. Pasang tunnel ke `http://127.0.0.1:4001`, misalnya `https://pc-agent.domainkamu.com`.
3. Push repo ke GitHub (private boleh).
4. Di Coolify buat resource dari repo itu: Build Pack **Dockerfile**, Base Directory `/web`, port `3000`, isi environment variable.
5. Beri domain, deploy, buka, login, cek "PC online".

Langkah lengkap dengan perintah: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

## Konfigurasi

### Agent (`agent/agent.env`)

| Variabel | Default | Keterangan |
|---|---|---|
| `AGENT_TOKEN` | wajib | Rahasia bersama dengan web. Minimal 24 karakter |
| `STORAGE_ROOT` | `../storage` | Folder yang menjadi drive |
| `AGENT_HOST` | `127.0.0.1` | Alamat bind. Biarkan lokal kalau memakai tunnel di PC yang sama |
| `AGENT_PORT` | `4001` | Port agent |

### Web (environment variable di Coolify, atau `web/local.env` untuk lokal)

| Variabel | Default | Keterangan |
|---|---|---|
| `ADMIN_USER` | wajib | Username **owner** (akun utama, tanpa kuota, semua izin) |
| `ADMIN_PASSWORD` | wajib | Password owner. Pakai yang kuat. Hanya bisa diganti lewat variabel ini |
| `SESSION_SECRET` | wajib | Minimal 32 karakter acak. Menandatangani sesi dan link berbagi |
| `AGENT_URL` | wajib | URL tunnel ke agent, tanpa garis miring di akhir |
| `AGENT_TOKEN` | wajib | Harus sama persis dengan di agent |
| `COOKIE_SECURE` | `true` | Biarkan `true` di HTTPS. Set `false` hanya untuk uji lokal lewat http |
| `SESSION_HOURS` | `168` | Lama sesi login (jam) |
| `PORT` | `3000` | Port web |
| `DATA_DIR` | `web/data` (Docker: `/data`) | Tempat `users.json` (akun, kuota, izin). Di Coolify **wajib** dipasang Persistent Storage ke `/data` |
| `ALLOW_OVERBOOK` | `false` | `true` mengizinkan total kuota melebihi kapasitas disk (lihat [docs/MULTI-USER.md](docs/MULTI-USER.md)) |

Template ada di `agent/agent.env.example` dan `web/.env.example`.

## Memakai UI

| Aksi | Cara |
|---|---|
| Pilih file | Klik. `Ctrl/Cmd+klik` menambah, `Shift+klik` memilih rentang |
| Buka folder / pratinjau | Klik dua kali (di layar sentuh cukup ketuk) |
| Menu konteks | Klik kanan, `Shift+F10`, atau tekan lama di HP |
| Pilih semua | `Ctrl+A` |
| Hapus pilihan | `Delete` (selalu minta konfirmasi) |
| Tutup dialog/menu/drawer | `Esc` |
| Unggah | Tombol Unggah, atau seret file ke jendela |
| Ganti tema, grid/daftar | Tombol di pojok kanan atas |

Hapus tidak permanen: item dipindah ke `.trash` milik akun itu di PC dan tidak tampil di UI. Ruangnya tetap dihitung ke kuota sampai kamu menekan **Kosongkan sampah** (tombol muncul di sidebar bila ada isi sampah).

Menu yang muncul menyesuaikan izin akun. Owner dan admin punya entri **Admin** di sidebar untuk mengelola akun; semua akun biasa bisa **Ganti password** sendiri. Detail: [docs/MULTI-USER.md](docs/MULTI-USER.md).

## Struktur proyek

```
ait-drive/
├── agent/                 # berjalan di PC: API file dengan token
│   ├── server.js
│   ├── start-agent.bat
│   └── agent.env.example
├── web/                   # di-deploy ke Coolify
│   ├── server.js          # login, proxy ke agent, share link, header keamanan
│   ├── Dockerfile
│   ├── .env.example
│   ├── start-web-local.bat
│   └── public/            # UI: index.html, style.css, app.js, admin.js, theme.js
├── tests/                 # harness terisolasi + tes API + tes UI (jsdom)
├── docs/                  # dokumentasi lanjutan
├── package.json           # skrip pembantu (install:all, test, start:*)
└── README.md
```

## Tes

```bash
npm run install:all   # sekali saja
npm test              # semua tes
npm run test:api      # API, keamanan, multi-akun, kuota, agent storage-saja (158 pemeriksaan)
npm run test:ui       # tampilan di jsdom termasuk panel admin (58 pemeriksaan)
```

Tes memakai folder sementara, port acak, dan rahasia acak, jadi **tidak menyentuh drive asli atau konfigurasi kamu**. Tes UI memuat `index.html`, `admin.js`, dan `app.js` asli lalu menjalankan login, panel admin (buat, ubah, hapus akun), login sebagai pengguna berkuota, pembatasan izin, navigasi, seleksi, pratinjau, menu konteks, ganti nama, link berbagi, unggah, pencarian, hapus, tema, drawer, dan logout.

## Keamanan

Ringkas: agent hanya menerima token yang benar, web tidak pernah mengirim token itu ke browser, semua path dipaksa tetap di dalam folder penyimpanan, login dibatasi percobaannya, dan semua respons membawa Content-Security-Policy. Detail, model ancaman, dan daftar periksa pengerasan: **[docs/SECURITY.md](docs/SECURITY.md)**.

## Batasan dan rencana

- **Tanpa pendaftaran (signup) terbuka.** Ini disengaja: pendaftaran terbuka pada drive yang menempel ke PC pribadi berarti orang asing bisa menulis ke disk kamu. Akun hanya dibuat admin.
- **Kuota adalah batas logis, bukan ruang yang dikunci.** Panel mencegah total kuota melebihi kapasitas disk, tetapi file di luar AIT Drive tetap bisa mengurangi ruang kosong.
- **Akun disimpan di server (volume `/data` Coolify).** Cadangkan volume itu. File pengguna ada di PC, jadi saat PC mati login dan panel admin tetap jalan tetapi file tidak terbuka.
- Belum ada 2FA, daftar sesi aktif, atau berbagi antar akun.
- PC harus menyala dan agent berjalan. Saat PC mati, UI menampilkan "Koneksi terputus".
- Link berbagi tidak bisa dicabut satu per satu. Mengganti `SESSION_SECRET` mencabut semuanya (dan mengeluarkan semua sesi login).
- Melalui Cloudflare plan gratis, satu permintaan unggah dibatasi sekitar 100 MB. Pakai Tailscale atau unggah per file kecil untuk berkas besar.
- Unggah folder utuh belum didukung (unggah file di dalamnya).
- Tidak ada thumbnail server-side: gambar kecil (sampai 2 MB) dimuat langsung sebagai pratinjau di grid.

## Dokumentasi lanjutan

| Dokumen | Isi |
|---|---|
| [docs/MULTI-USER.md](docs/MULTI-USER.md) | Panel admin, kuota dan booking disk, izin, tata letak data, migrasi dari v1 |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Panduan langkah demi langkah: PC, tunnel, GitHub, Coolify, update, rollback |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Komponen, alur permintaan, keputusan desain |
| [docs/API.md](docs/API.md) | Referensi endpoint agent dan gateway |
| [docs/SECURITY.md](docs/SECURITY.md) | Model ancaman, kontrol, pengerasan, rotasi rahasia |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Masalah umum dan solusinya |

## Kredit

Dibuat oleh **Fadhil Ghifarion 法迪 for AIT**.
Arah visual (palet, tipografi, komponen) dirancang bersama ChatGPT lalu diimplementasikan di proyek ini.
