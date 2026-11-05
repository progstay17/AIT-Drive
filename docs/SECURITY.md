# Keamanan

AIT Drive membuka sebagian disk PC pribadi ke internet. Dokumen ini menjelaskan apa yang dilindungi, bagaimana, dan apa yang masih menjadi tanggung jawab kamu.

## Model ancaman

| Ancaman | Kontrol |
|---|---|
| Orang asing membuka drive | Login wajib untuk semua `/api/*`. Tidak ada pendaftaran terbuka |
| Tebak password | Rate limit 5 kegagalan/15 menit/IP, perbandingan waktu konstan |
| Orang asing memanggil agent langsung | Token Bearer 24+ karakter, perbandingan `timingSafeEqual`. Tanpa token = 401 |
| Keluar dari folder penyimpanan (`../`, symlink) | `resolveSafe` + pemeriksaan `realpath`. Ditolak 400 |
| Situs lain memicu aksi atas nama kamu (CSRF) | Header wajib `X-Requested-With: drive` pada non-GET, cookie `SameSite=Lax` |
| XSS lewat nama file | Nama file hanya dimasukkan dengan `textContent`. CSP melarang skrip inline |
| File berbahaya di-render sebagai halaman | `X-Content-Type-Options: nosniff`, unduhan sebagai `attachment` untuk jalur non-pratinjau |
| Kehilangan data karena salah hapus | Hapus lembut ke `.trash` |
| Pencurian cookie lewat JavaScript | Cookie `HttpOnly`; `Secure` di HTTPS |
| Pemalsuan sesi atau link berbagi | Tanda tangan HMAC-SHA256 dengan `SESSION_SECRET`, diverifikasi dengan waktu konstan, ada kedaluwarsa |

Terverifikasi oleh `npm run test:api` (path traversal, CSRF, token salah, rate limit, link dirusak, dan lainnya).

## Yang HARUS kamu lakukan

1. **Password kuat.** `ADMIN_PASSWORD` panjang dan unik. Tidak ada autentikasi dua faktor di versi ini.
2. **Rahasia acak.** `AGENT_TOKEN` dan `SESSION_SECRET` dibuat dengan `crypto.randomBytes(32)`, berbeda satu sama lain. Jangan dipakai ulang di layanan lain.
3. **Jangan commit rahasia.** `agent.env`, `local.env`, `coolify-secrets.txt` sudah di `.gitignore`. Periksa `git status` sebelum commit. Jika rahasia sempat ter-push, anggap bocor dan ganti (lihat rotasi di DEPLOYMENT).
4. **Hanya HTTPS di internet.** Biarkan `COOKIE_SECURE=true`. Jangan buka port 3000 atau 4001 langsung di router.
5. **Agent hanya lokal.** Biarkan `AGENT_HOST=127.0.0.1` bila memakai Cloudflare Tunnel. Dengan Tailscale, batasi akses ke tailnet lewat firewall.
6. **Folder penyimpanan khusus.** Jangan arahkan `STORAGE_ROOT` ke `C:\`, folder Users, atau folder sistem. Pakai folder terpisah yang hanya berisi data drive.
7. **Jalankan agent dengan akun Windows biasa**, bukan Administrator.
8. **Perbarui Node.js dan dependensi** secara berkala (`npm audit`, `npm update`).
9. **Backup** folder penyimpanan. `.trash` bukan backup.

## Sifat link berbagi

- Siapa pun yang memegang link bisa mengunduh **file itu** sampai kedaluwarsa, tanpa login. Anggap seperti membagikan file itu sendiri.
- Link tidak bisa dicabut satu per satu. Pencabutan massal: ganti `SESSION_SECRET` (efek samping: semua sesi login ikut berakhir).
- Link hanya untuk file (bukan folder) dan hanya mengunduh.

## Pengerasan lanjutan (opsional)

- **Cloudflare Access / Zero Trust** di depan domain drive untuk lapisan login tambahan (email OTP).
- **Batasi asal ke agent**: pada Cloudflare Tunnel, agent tidak perlu terbuka ke internet langsung. Hapus rute publik dan gunakan Tailscale bila ingin agent sama sekali tidak punya hostname publik.
- **Firewall Windows**: izinkan port agent hanya dari 127.0.0.1 (default) atau dari antarmuka Tailscale.
- **Pantau log** container di Coolify untuk lonjakan 401/429.
- **Pemisahan akun**: jalankan agent di akun Windows khusus yang hanya punya akses tulis ke folder penyimpanan.

## Batasan yang diketahui

- Tanpa 2FA dan tanpa daftar sesi aktif. Sesi satu akun dicabut dengan mengganti password atau menonaktifkannya (nomor versi `tv`); mencabut semua sesi sekaligus dilakukan dengan mengganti `SESSION_SECRET`.
- Rate limit disimpan di memori (reset saat restart) dan berbasis IP. Di belakang proxy, `trust proxy` diset ke 1 sehingga IP klien dibaca dari `X-Forwarded-For` yang ditambahkan Coolify/Traefik.
- Tidak ada enkripsi di disk. File di PC tersimpan apa adanya (andalkan BitLocker bila perlu).
- Tidak ada pemindaian virus pada file yang diunggah.
- Pratinjau PDF dan teks memakai iframe/`pre` dari asal yang sama. Hanya unggah/buka file dari sumber yang kamu percaya.

## Melaporkan celah

Jika menemukan masalah keamanan, hubungi pemilik repositori secara privat (jangan membuat issue publik).

---

Dibuat oleh Fadhil Ghifarion 法迪 for AIT.

## Banyak akun (v2)

- **Tidak ada signup.** Hanya owner dan admin yang membuat akun. Admin tidak bisa membuat, mengubah, atau menghapus admin lain.
- **Password** pengguna disimpan sebagai hash scrypt (garam acak per akun) di `users.json` pada volume `/data` di server Coolify, bukan di PC. Login memakai pembanding waktu-konstan dan hash tiruan agar username yang tidak ada tidak bisa dibedakan dari waktunya.
- **Identitas dan hak dikirim gateway ke agent** lewat `X-AIT-User`, `X-AIT-Quota`, `X-AIT-Perms`, dan dipercaya hanya bersama token bearer yang benar. Gateway membaca akun dari databasenya di setiap permintaan, jadi menonaktifkan akun atau mengubah izin/kuota berlaku seketika. Siapa pun yang memegang `AGENT_TOKEN` bisa bertindak sebagai akun mana pun terhadap agent, jadi jaga token itu.
- **Isolasi**: setiap akun dipaksa berada di `users/<id>/`; `..`, path absolut, dan `.trash` ditolak. Pengecekan dilakukan di agent, bukan hanya di UI.
- **Izin dan kuota ditegakkan di agent**, jadi memanggil API langsung tidak melewati batas. Tes otomatis memeriksa semuanya.
- **Link berbagi** dibuat atas nama satu akun, hanya membuka file di folder akun itu, dan mati bila akun dinonaktifkan atau passwordnya diganti.
- **Owner** hanya ada di environment variable web. Jika `users.json` rusak atau volume hilang, owner tetap bisa masuk. Folder di PC tetap utuh, jadi akun dengan username yang sama kembali ke datanya.
- Cadangkan volume `/data` di Coolify dan folder storage di PC. Folder akun yang dihapus diarsipkan di `.ait/archive/` pada PC, bukan dihapus.
