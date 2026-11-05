# Arsitektur

## Gambaran besar

```
┌─────────┐  HTTPS   ┌──────────────────────────┐  HTTPS (tunnel)  ┌────────────────────┐
│ Browser │ ───────> │ web/  (Coolify, Docker)  │ ───────────────> │ agent/  (PC kamu)  │
└─────────┘          │  - login + sesi          │  Authorization:  │  - API file        │
                     │  - sajikan UI statis     │  Bearer <token>  │  - STORAGE_ROOT    │
                     │  - proxy ke agent        │                  │  - .trash          │
                     │  - link berbagi          │                  └────────────────────┘
                     └──────────────────────────┘
```

Kenapa dipisah dua?

- Server di internet (Coolify) punya alamat publik dan HTTPS, tetapi tidak punya file kamu.
- PC kamu punya file, tetapi tidak punya alamat publik dan tidak boleh langsung terbuka ke internet.
- Gateway menjadi satu-satunya pintu: autentikasi pengguna terjadi di gateway, autentikasi gateway ke agent terjadi lewat token. Browser tidak pernah tahu token agent.

## Komponen

### `agent/server.js`

Server Express kecil yang hanya paham operasi file di dalam `STORAGE_ROOT`.

- Semua endpoint (kecuali `/health`) mewajibkan `Authorization: Bearer <AGENT_TOKEN>`. Perbandingan token memakai hash SHA-256 dan `timingSafeEqual`.
- Setiap path dari klien melewati `resolveSafe()`: dinormalkan, harus berada di dalam root, dan folder `.trash` ditolak. Lalu `ensureInside()` memeriksa `realpath` agar symlink tidak bisa keluar dari root.
- Unggah di-streaming dengan `busboy` langsung ke file sementara `*.part`, lalu di-rename setelah selesai. Nama duplikat otomatis menjadi `nama (1).ext`. File sementara dihapus bila koneksi putus atau gagal.
- Unduh memakai `res.sendFile` sehingga dukungan `Range` (video seeking, resume) gratis.
- Hapus = pindah ke `.trash/<waktu>__<nama>` di dalam root. Tidak pernah menghapus permanen.

### `web/server.js`

Server Express yang menjadi gateway.

- **Sesi**: cookie `sid` berisi payload JSON bertanda tangan HMAC-SHA256 (`SESSION_SECRET`) dengan waktu kedaluwarsa. Tanpa penyimpanan di server (stateless).
- **Login**: membandingkan username dan password dengan konstan-waktu, rate limit 5 kegagalan per IP per 15 menit (di memori).
- **CSRF**: permintaan selain GET ke `/api/*` wajib membawa header `X-Requested-With: drive`. Header kustom tidak bisa dikirim lintas situs tanpa izin CORS, dan cookie memakai `SameSite=Lax`.
- **Proxy**: meneruskan header yang diperlukan (`Range`, `Content-Type`, dst) dan mengalirkan body tanpa buffering, sehingga unggah/unduh besar tidak memenuhi memori.
- **Link berbagi**: token `base64url(payload).hmac` berisi path dan waktu kedaluwarsa. Endpoint `/s/:token` memverifikasi tanda tangan lalu mengalirkan file sebagai lampiran (attachment).
- **Header keamanan** di semua respons: CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`.
- **UI statis** dari `web/public/` dengan `Cache-Control: no-cache` (selalu validasi ETag, jadi pembaruan langsung terlihat).

### `web/public/` (UI)

HTML + CSS + JavaScript biasa, tanpa build.

| File | Peran |
|---|---|
| `index.html` | Kerangka: login, app shell, sidebar, topbar, kontainer modal/toast |
| `style.css` | Design token terang/gelap, komponen, responsif. Bagian bawah berisi tambahan khusus aplikasi |
| `app.js` | Seluruh logika: auth, daftar file, seleksi, pratinjau, menu konteks, dialog, unggah, pencarian |
| `theme.js` | Menerapkan tema tersimpan sebelum render pertama (hindari kedipan) |

Aturan yang dijaga di UI: semua teks dari nama file dimasukkan lewat `textContent` (bukan `innerHTML`) agar nama file aneh tidak bisa menyisipkan HTML; skrip hanya dari `'self'` sehingga CSP bisa melarang skrip inline.

## Alur penting

### Login dan daftar file

1. UI memanggil `GET /auth/me`. Kalau belum masuk, tampil layar login.
2. `POST /auth/login` memeriksa kredensial dan mengatur cookie `sid`.
3. UI memanggil `GET /api/list?path=...`. Gateway memverifikasi cookie, memanggil `agent GET /list` dengan token, dan mengembalikan hasilnya.

### Unggah

```
Browser (XHR multipart) ──> gateway /api/upload?path=Foto ──(stream)──> agent /upload?path=Foto
                                                                         └─> Foto/nama.jpg.part ──rename──> Foto/nama.jpg
```

Tidak ada penyimpanan perantara di server Coolify. Progress yang tampil di UI adalah progress dari browser ke gateway.

### Unduh dan pratinjau

`GET /api/download?path=...` (tambahkan `&inline=1` untuk pratinjau) dialirkan dari agent lewat gateway, termasuk header `Range`, sehingga video bisa digeser dan unduhan bisa dilanjutkan.

### Link berbagi

1. Pemilik memilih "Buat link berbagi" dan jumlah hari (1 sampai 30).
2. Gateway membuat token bertanda tangan berisi path + kedaluwarsa dan mengembalikan `https://domain/s/<token>`.
3. Siapa pun yang memegang link bisa mengunduh file itu (tanpa login) selama link belum kedaluwarsa dan PC online.

### Status PC

UI memanggil `/api/status` tiap 20 detik. Gateway menghubungi `agent /health` (tanpa token, hanya `{ok:true}`) dengan timeout 4 detik.

## Keputusan desain dan alasannya

| Keputusan | Alasan |
|---|---|
| Gateway + agent, bukan satu aplikasi | Storage di PC, UI di server publik. Token memisahkan kepercayaan |
| Sesi stateless bertanda tangan | Tidak perlu database. Mudah di-deploy di container |
| Hapus lembut ke `.trash` | Mencegah kehilangan data karena salah klik, termasuk dari serangan yang berhasil login |
| Tanpa framework/build UI | Mudah dibaca dan diubah, deploy sederhana |
| `busboy` + file `.part` | Unggah besar tanpa memenuhi RAM, dan tidak meninggalkan file setengah jadi |
| Satu admin | Cocok untuk drive pribadi dan mengurangi permukaan serangan |

## Batas yang diketahui

- Rate limit login dan cache hanya di memori: reset saat container restart.
- Sesi stateless tidak bisa dicabut satu per satu. Mengganti `SESSION_SECRET` mencabut semuanya.
- Pencarian menelusuri disk secara rekursif (maksimal 200 hasil). Untuk drive sangat besar bisa lambat.
- `/stats` menghitung ukuran seluruh isi folder tiap dipanggil.

---

Dibuat oleh Fadhil Ghifarion 法迪 for AIT.

## Model banyak akun (v2)

- **Coolify = server utama.** Gateway memegang login, akun, kuota, izin, dan panel admin (`users.json` di volume `/data`). Owner berasal dari environment variable.
- **PC = storage.** Agent hanya melakukan operasi file di `users/<id>/` dan menegakkan kuota serta izin yang dikirim gateway lewat header `X-AIT-Quota` / `X-AIT-Perms`, dipercaya hanya bersama `AGENT_TOKEN` yang benar.
- **Hak dibaca ulang di setiap permintaan** dari database gateway, jadi perubahan kuota, izin, atau status akun berlaku seketika. Sesi dicabut lewat nomor versi `tv` per akun.
- **Kuota**: agent menjaga hitungan pemakaian secara bertahap dan menyinkronkannya dengan menelusuri folder (TTL 5 menit, ditunda saat ada unggahan berjalan). Unggahan dicek lewat `Content-Length` dan oleh penghitung dalam aliran. Sampah ikut dihitung.
- **Alokasi**: gateway menghitung `kapasitas = disk kosong (dari agent) + pemakaian akun non-owner`; jumlah kuota harus `<=` kapasitas kecuali `ALLOW_OVERBOOK=true`.
- **PC mati**: login, akun, dan panel admin tetap jalan; file tidak terbuka. Membuat akun berkuota dan menghapus akun ditolak karena butuh PC.
- **Migrasi**: lihat [MULTI-USER.md](MULTI-USER.md).
