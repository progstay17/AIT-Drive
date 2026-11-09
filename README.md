# AIT Drive

Cloud drive pribadi dengan antarmuka web yang di-host di Coolify, sementara file tetap berada di PC/storage host milik sendiri.

**Repository ini hanya berisi Web Gateway dan UI. Storage Agent dikelola terpisah di [progstay17/AIT-Drive-Agent](https://github.com/progstay17/AIT-Drive-Agent).** Agent dipasang langsung pada PC yang menyimpan file; source Agent tidak disalin ke Docker image Coolify maupun repository ini.

## Komponen

| Komponen | Repository / lokasi | Tanggung jawab |
|---|---|---|
| Web Gateway + UI | Repo ini, folder `web/`; deploy ke Coolify | Login, sesi, akun, kuota, izin, admin panel, share link, UI, proxy API |
| Storage Agent | [AIT-Drive-Agent](https://github.com/progstay17/AIT-Drive-Agent); install di storage PC | Operasi file lokal di dalam `STORAGE_ROOT`, kuota dan izin yang diteruskan gateway |
| Tunnel + reverse proxy | Caddy Panel di VPS | HTTPS publik ke Agent tanpa membuka port masuk pada storage PC |

```text
Browser --HTTPS--> Coolify / Web Gateway
                         |
                         | HTTPS + AGENT_TOKEN
                         v
                  Public Agent hostname
                         |
                    Caddy on VPS
                         |
                  VPS 127.0.0.1:8081
                         |
                  SSH reverse tunnel
                         |
              Storage PC 127.0.0.1:4001
                         |
                    STORAGE_ROOT
```

Token Agent hanya disimpan pada `agent.env` di storage PC dan konfigurasi privat gateway di volume `/data`. Browser tidak pernah menerima token tersebut. `AGENT_URL` dan `AGENT_TOKEN` tetap menjadi node `primary` sehingga deployment single-agent lama tetap kompatibel; node tambahan didaftarkan owner dari panel admin.

## Fitur web

- Banyak akun tanpa signup terbuka; akun dibuat dari panel admin.
- Kuota disk per akun dan izin upload, modify, delete, share.
- Multi-storage node: satu PC Agent dapat menampung banyak akun; owner memilih storage untuk tiap akun dan memantau status/kapasitas per PC.
- Upload folder rekursif dengan subfolder, download folder sebagai ZIP, tampilan Trash, dan restore ke lokasi asal.
- File browser dengan grid/list, breadcrumb, pencarian, multi-select, drag-and-drop upload, progress, preview gambar/video/audio/PDF/teks.
- Rename, move, soft-delete, trash, signed share links dengan kedaluwarsa.
- Tema terang/gelap, layout responsif, sesi HttpOnly, CSRF guard, rate limit login.
- Status online/offline Agent dan pesan kesalahan koneksi.

## Persyaratan

- Node.js 20+ untuk pengembangan/lokal.
- Coolify dengan Dockerfile build pack untuk deployment web.
- Repository publik/privat GitHub yang terhubung ke Coolify.
- Storage PC dengan Node.js 20+ dan Agent dari repo terpisah.
- Tunnel HTTPS dari Coolify ke Agent, misalnya Caddy Panel SSH reverse tunnel.

## Menjalankan web lokal

Clone kedua repository berdampingan:

```text
workspace/
├── AIT-Drive/          # repo ini
└── AIT-Drive-Agent/    # repo Agent terpisah
```

Pada Windows, contoh folder: `C:\AIT-Drive` dan `C:\AIT-Drive-Agent`. Konfigurasikan dan jalankan Agent dari repository Agent terlebih dahulu. Lalu:

```powershell
cd C:\AIT-Drive
npm install
npm --prefix web install
```

Buat `web/local.env` (jangan commit):

```dotenv
ADMIN_USER=owner
ADMIN_PASSWORD=use-a-long-unique-password
SESSION_SECRET=generate-a-random-secret-at-least-32-characters
AGENT_URL=http://127.0.0.1:4001
COOKIE_SECURE=false
```

`web/start-web-local.bat` membaca `AGENT_TOKEN` dari `C:\AIT-Drive-Agent\agent.env`. Sesuaikan path pada script bila repositori disimpan di lokasi lain. Jalankan `web/start-web-local.bat`, lalu buka `http://localhost:3000`.

## Deploy ke Coolify

1. Hubungkan repository `progstay17/AIT-Drive` ke Coolify.
2. Build Pack: **Dockerfile**.
3. Base Directory: `/web` (Dockerfile berada di folder `web/`).
4. Exposed Port: `3000`.
5. Pasang Persistent Storage ke `/data` untuk data akun, kuota, dan izin.
6. Isi environment variables. Untuk instalasi multi-storage, `AGENT_URL` dan `AGENT_TOKEN` tetap menunjuk Agent utama; node tambahan dikonfigurasi dari panel admin setelah Agent/tunnel PC tambahan siap:

| Variable | Nilai |
|---|---|
| `ADMIN_USER` | Username owner |
| `ADMIN_PASSWORD` | Password owner yang kuat |
| `SESSION_SECRET` | Random secret unik, minimal 32 karakter |
| `AGENT_URL` | URL HTTPS publik Agent, tanpa slash di akhir |
| `AGENT_TOKEN` | Harus sama persis dengan token lokal Agent |
| `COOKIE_SECURE` | `true` untuk HTTPS |
| `DATA_DIR` | `/data` (default produksi) |
| `ALLOW_OVERBOOK` | Opsional, default `false` |

7. Pasang domain web, aktifkan HTTPS, lalu deploy.

Panduan lengkap: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Panduan Agent dan tunnel ada di [repo Agent](https://github.com/progstay17/AIT-Drive-Agent).

## Konfigurasi gateway

| Variabel | Default | Keterangan |
|---|---|---|
| `ADMIN_USER` | wajib | Username owner |
| `ADMIN_PASSWORD` | wajib | Password owner |
| `SESSION_SECRET` | wajib | Secret sesi dan signed share links |
| `AGENT_URL` | wajib | URL tunnel HTTPS ke Agent |
| `AGENT_TOKEN` | wajib | Shared secret yang sama dengan Agent |
| `COOKIE_SECURE` | `true` | `false` hanya untuk uji lokal HTTP |
| `SESSION_HOURS` | `168` | Durasi sesi dalam jam |
| `PORT` | `3000` | Port web server |
| `DATA_DIR` | `web/data` (`/data` di Docker) | Data akun; pasang persistent volume di Coolify |
| `ALLOW_OVERBOOK` | `false` | Izinkan total kuota melebihi kapasitas disk |

Template lengkap: [`web/.env.example`](web/.env.example). Konfigurasi Agent: [`agent.env.example` pada repo Agent](https://github.com/progstay17/AIT-Drive-Agent/blob/main/agent.env.example).

### Arti dan aturan setiap environment variable Gateway

| Variable | Wajib? | Kapan diubah |
|---|---|---|
| `ADMIN_USER` | Ya | Username owner untuk login pertama/panel admin. |
| `ADMIN_PASSWORD` | Ya | Password owner yang kuat; jangan gunakan contoh placeholder. |
| `SESSION_SECRET` | Ya | Secret acak minimal 32 karakter untuk sesi dan signed share link. Jangan diganti sembarangan karena sesi/link yang sudah diterbitkan dapat tidak berlaku. |
| `AGENT_URL` | Ya | URL HTTPS Agent utama (`primary`), tanpa slash akhir. Untuk lokal dapat memakai `http://127.0.0.1:4001`. |
| `AGENT_TOKEN` | Ya | Token yang sama persis dengan `AGENT_TOKEN` Agent utama. Jangan gunakan token Agent PC lain untuk primary. |
| `COOKIE_SECURE` | Tidak | `true` jika Gateway diakses lewat HTTPS; `false` hanya untuk pengembangan lokal HTTP. |
| `SESSION_HOURS` | Tidak | Masa berlaku sesi dalam jam; default `168` (7 hari). |
| `PORT` | Tidak | Port proses Gateway; default `3000`. Sesuaikan hanya jika platform/container memerlukan port lain. |
| `DATA_DIR` | Tidak | Lokasi database JSON akun dan konfigurasi storage node; default `web/data` saat lokal dan `/data` pada image Docker. Di Coolify, mount persistent volume ke `/data`. |
| `ALLOW_OVERBOOK` | Tidak | Default `false`; `true` mengizinkan total kuota akun melebihi kapasitas disk yang tersedia (thin provisioning). |

### Environment vs konfigurasi storage node tambahan

Environment Gateway di atas hanya menghubungkan **node primary** agar instalasi satu-Agent yang lama tetap berjalan. Untuk PC/Agent kedua dan seterusnya, **jangan menambahkan atau mengganti `AGENT_URL` / `AGENT_TOKEN`**. Siapkan Agent dan tunnel HTTPS pada PC tersebut, lalu login sebagai owner → Admin → Storage nodes → Tambah storage. Isi:

- **ID:** identitas unik, huruf kecil/angka/garis minus/underscore (contoh `storage-02`).
- **Nama:** nama PC atau lokasi yang mudah dikenali.
- **URL:** hostname HTTPS publik yang menuju Agent melalui reverse proxy/tunnel.
- **Token:** nilai `AGENT_TOKEN` khusus dari `agent.env` pada PC tersebut.

Setelah node terdaftar, pilih storage tersebut ketika membuat akun atau mengedit akun. Satu akun berada pada satu node, sedangkan satu node dapat menampung banyak akun. Setiap PC harus memiliki `STORAGE_ROOT` sendiri dan token unik; jangan memakai folder storage yang sama secara bersamaan pada dua Agent.

URL dan token node tambahan disimpan dalam database Gateway di `DATA_DIR` (Coolify: volume `/data`). Karena itu:
- Persistent volume `/data` wajib dipertahankan saat redeploy/recreate container.
- Backup `/data` secara aman karena berisi data akun serta konfigurasi rahasia koneksi Agent.
- Jangan menghapus atau mengganti volume `/data` ketika update aplikasi.
- Jangan menaruh token node tambahan di source code, Git, atau browser.

**Penting:** memindahkan akun yang sudah berisi file ke node lain saat ini ditolak dengan aman. Buat akun baru langsung pada node tujuan, atau tunggu fitur migrasi data terverifikasi sebelum memindahkan akun lama.

## Struktur repository

```text
AIT-Drive/
├── web/                 # gateway Express, Dockerfile, UI statis
├── tests/               # gateway + integration tests
├── docs/                # deployment, API, architecture, security
├── package.json
└── README.md
```

## Tes

Test harness integrasi menjalankan source Agent dari repository terpisah. Clone kedua repo berdampingan seperti struktur di atas, atau set `AIT_AGENT_DIR` ke lokasi checkout Agent.

```powershell
npm install
npm --prefix web install
npm test
```

- `npm run test:api`: API, auth, multi-akun, kuota, dan integrasi storage Agent.
- `npm run test:ui`: UI smoke tests menggunakan jsdom.

Test harness memakai port acak, token acak, dan folder storage sementara; tidak menyentuh data produksi.

## Keamanan dan data

- Jangan commit `web/local.env`, token Agent, kredensial tunnel, file SSH private key, atau data storage.
- Jangan bind Agent ke `0.0.0.0` untuk deployment publik. Gunakan tunnel dan HTTPS.
- Pasang backup terpisah untuk `STORAGE_ROOT` pada PC dan persistent volume `/data` di Coolify.
- Soft-delete bukan backup; empty trash menghapus file secara permanen.
- Akun lama otomatis tetap berada di node `primary`. Akun baru dapat ditempatkan ke node pilihan. Pemindahan akun yang sudah berisi data saat ini ditolak sampai migrasi terverifikasi tersedia; jangan mengubah `nodeId` secara manual.

Dokumentasi: [API](docs/API.md), [Architecture](docs/ARCHITECTURE.md), [Security](docs/SECURITY.md), [Deployment](docs/DEPLOYMENT.md), [Multi-user](docs/MULTI-USER.md), [Troubleshooting](docs/TROUBLESHOOTING.md).

## License

Source code repository ini dipublikasikan untuk kebutuhan proyek AIT Drive. Belum ada lisensi open-source yang diberikan; hak penggunaan dan distribusi mengikuti ketentuan pemilik repository.
