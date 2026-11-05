# Pemecahan masalah

## Tabel cepat

| Gejala | Penyebab paling mungkin | Solusi |
|---|---|---|
| Membuka `localhost:4001` menampilkan `{"error":"unauthorized"}` | Itu agent, bukan web | Buka **`http://localhost:3000`**. Agent memang tidak punya halaman |
| Layar login muncul terus setelah deploy | `COOKIE_SECURE=true` tetapi diakses lewat `http://` | Akses lewat HTTPS, atau set `COOKIE_SECURE=false` hanya untuk uji lokal |
| "Token agent tidak cocok. Samakan AGENT_TOKEN..." | `AGENT_TOKEN` di web ≠ di `agent.env` | Samakan persis (tanpa spasi/kutip/baris baru), restart agent, redeploy web |
| "Koneksi terputus" / "PC tidak terjangkau" | Agent mati, PC tidur/mati, atau tunnel putus | Jalankan `start-agent.bat`, cek `curl http://127.0.0.1:4001/health`, cek layanan cloudflared |
| Sidebar menunjukkan "PC offline" | Sama seperti di atas | Sama |
| Container Coolify "unhealthy" / langsung berhenti | Variabel lingkungan kosong | Lihat log: `Missing env var: ...` atau `SESSION_SECRET must be at least 32 characters` |
| Coolify: "Dockerfile not found" | Base Directory salah | Set Base Directory ke `/web` |
| Build gagal di `npm ci` | `package-lock.json` tidak ikut ter-commit | `git add web/package-lock.json`, commit, push |
| Unggah gagal di sekitar 100 MB | Batas Cloudflare Tunnel plan gratis | Pakai Tailscale, atau unggah file lebih kecil |
| Unggah gagal dengan "Koneksi terputus" | Jaringan putus di tengah, atau timeout proxy | Coba lagi (tombol "Coba lagi" di notifikasi). File `.part` otomatis dibersihkan |
| "Terlalu banyak percobaan" saat login | Rate limit 5 kegagalan/15 menit | Tunggu 15 menit, atau restart container web untuk mereset |
| Salah password padahal benar | Spasi tersalin di `ADMIN_PASSWORD`, atau env belum ter-redeploy | Periksa nilai di Coolify, redeploy |
| UI tampil versi lama setelah update | Cache browser | `Ctrl+F5`. Server memakai `no-cache` jadi cukup sekali |
| Link berbagi "tidak valid atau kedaluwarsa" | Lewat masa berlaku, link terpotong, atau `SESSION_SECRET` diganti | Buat link baru |
| Link berbagi sudah benar tetapi gagal membuka | PC offline | Nyalakan PC dan agent |
| Video tidak bisa digeser | Proxy memotong header `Range` | Pastikan tidak ada proxy lain yang menghapus `Range`. Tanpa tunnel pun harus jalan lokal |
| Nama file menjadi `nama (1).ext` | Nama sudah ada di folder itu | Perilaku normal: unggahan tidak menimpa file lama |
| Folder yang dihapus tidak terlihat di UI | Hapus bersifat lembut | Ada di `STORAGE_ROOT\.trash` di PC |
| Penyimpanan di sidebar tampak lambat berubah | `/stats` dihitung saat halaman dimuat dan setelah unggah/hapus | Muat ulang halaman |

## Diagnosis langkah demi langkah

Jalankan dari PC yang menyimpan file.

1. **Agent hidup?**
   ```bat
   curl http://127.0.0.1:4001/health
   ```
   Harus `{"ok":true}`. Jika gagal: jalankan `agent\start-agent.bat` dan baca pesan error.

2. **Token benar?**
   ```bat
   curl -i http://127.0.0.1:4001/list
   ```
   Harus 401 (tanpa token). Dengan token: `curl -H "Authorization: Bearer TOKEN_KAMU" "http://127.0.0.1:4001/list?path="` harus 200.

3. **Tunnel hidup?**
   ```bat
   curl -i https://pc-agent.domainkamu.com/health
   ```
   Harus `{"ok":true}` (200). 502/530 berarti tunnel atau agent mati.

4. **Gateway hidup?** Buka `https://drive.domainkamu.com/auth/me`, harus `{"authenticated":false}` bila belum login.

5. **Log gateway**: di Coolify buka resource > Logs. Pesan dari `web/server.js` ada di sini.

## Agent tidak mau start

| Pesan | Arti |
|---|---|
| `AGENT_TOKEN must be set and at least 24 characters long.` | Token kosong atau terlalu pendek. Periksa `agent.env` |
| `EADDRINUSE` | Port 4001 sudah dipakai. Tutup proses lain (`netstat -ano \| findstr :4001`) atau ganti `AGENT_PORT` |
| `agent.env not found` (dari bat) | Salin `agent.env.example` menjadi `agent.env` |

## Web tidak mau start

| Pesan | Arti |
|---|---|
| `Missing env var: X` | Variabel X belum diisi |
| `SESSION_SECRET must be at least 32 characters` | Buat dengan `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `EADDRINUSE` pada 3000 | Ada proses lain di port itu. Ganti `PORT` |

## Menjalankan tes bila ada yang aneh

```bash
npm test
```

Jika tes lolos tetapi produksi bermasalah, penyebabnya hampir selalu konfigurasi (token, URL tunnel, `COOKIE_SECURE`), bukan kode.

## Reset

- **Lupa password**: ubah `ADMIN_PASSWORD` di Coolify lalu redeploy. Tidak ada database yang perlu direset.
- **Mulai ulang bersih**: hentikan agent dan web, hapus `agent.env`, buat ulang dari contoh dengan token baru. Data di `STORAGE_ROOT` tidak tersentuh.

---

Dibuat oleh Fadhil Ghifarion 法迪 for AIT.

## Multi-akun

| Gejala | Penyebab dan solusi |
|---|---|
| "Alokasi kuota melebihi kapasitas" saat membuat akun | Total kuota akan melebihi disk. Kecilkan kuota, kosongkan disk, atau set `ALLOW_OVERBOOK=true` di environment web (Coolify) |
| Pengguna melihat "Kuota tidak cukup" padahal sudah menghapus file | Hapus hanya memindahkan ke sampah. Tekan **Kosongkan sampah** |
| Akun biasa tidak bisa unggah, buat folder, atau bagikan | Izinnya dimatikan di panel admin. Edit akun dan centang izin yang diperlukan |
| "Akun nonaktif" saat login | Aktifkan kembali di panel admin, lalu minta pengguna login ulang |
| Pengguna biasa bisa login tetapi file tidak terbuka, pesan "PC tidak terjangkau" | Agent atau tunnel mati. Login, akun, dan panel admin tetap berfungsi karena akun ada di server |
| Pengguna biasa bisa login tetapi file gagal dengan "Token agent tidak cocok" | `AGENT_TOKEN` di Coolify berbeda dengan `agent.env` |
| Setelah update file lama "hilang" | Berada di `users/_owner`. Login sebagai owner (`ADMIN_USER`) |
| Lupa password pengguna | Admin mengisi password baru lewat Edit. Lupa password owner: ganti `ADMIN_PASSWORD` lalu redeploy |
| Ingin memulihkan akun yang dihapus | Salin folder dari `.ait/archive/<id>__<waktu>` ke `users/<id>` setelah membuat ulang akunnya |
| Akun yang dibuat hilang setelah redeploy | Volume `/data` belum dipasang. Tambahkan Persistent Storage ke `/data` di Coolify lalu buat ulang akunnya (folder di PC masih ada) |
| Container berhenti dan log berisi "DATA_DIR ... tidak bisa ditulis" | Volume `/data` tidak bisa ditulis. Pasang Persistent Storage dengan path tujuan `/data` |
| Jendela pilih folder tidak muncul di setup | Jalankan `agent\setup-agent.bat` dari PowerShell/Explorer di PC itu sendiri (bukan lewat SSH), atau ketik path folder langsung |
