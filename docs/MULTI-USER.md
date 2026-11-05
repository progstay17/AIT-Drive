# Banyak akun, kuota, dan panel admin

Mulai versi 2, AIT Drive mendukung banyak akun **tanpa pendaftaran terbuka**. Akun hanya dibuat oleh admin lewat panel admin. Setiap akun punya folder sendiri, batas kapasitas (kuota), dan izin sendiri.

## Peran

| Peran | Dari mana | Kuota | Izin | Bisa mengelola akun |
|---|---|---|---|---|
| **Owner** | Environment variable `ADMIN_USER` / `ADMIN_PASSWORD` di web | Tanpa batas | Semua | Semua akun, termasuk admin |
| **Admin** | Dibuat owner di panel | Opsional (kosong = tanpa batas) | Semua | Hanya akun pengguna biasa |
| **Pengguna** | Dibuat owner atau admin | Wajib, minimal 1 MB | Diatur per akun | Tidak |

Owner tidak disimpan di database dan passwordnya hanya bisa diganti lewat environment variable (lalu redeploy). Ini sengaja: kalau database akun rusak atau hilang, kamu tetap bisa masuk dan memperbaikinya.

## Panel admin

Masuk sebagai owner atau admin, lalu buka **Admin** di sidebar (alamat `#admin`).

- **Ringkasan**: total disk PC, ruang kosong, kapasitas yang bisa dialokasikan, total kuota yang sudah dibagikan, jumlah akun.
- **Tambah pengguna**: username, password (tombol "Buat acak" membuat 14 karakter), peran, kuota dalam GB, izin, status aktif.
- **Edit**: ubah kuota, izin, status aktif, atau reset password. Username tidak bisa diubah.
- **Hapus akun**: datanya **tidak dihapus**, foldernya dipindah ke `.ait/archive/<id>__<waktu>` di PC dan bisa dipulihkan manual.

Aturan username: 3 sampai 32 karakter, huruf kecil, angka, titik, minus, garis bawah, diawali dan diakhiri huruf atau angka. Nama yang dicadangkan Windows (`con`, `nul`, dan sejenisnya) ditolak. Login tidak peka huruf besar/kecil. Username tidak boleh sama dengan `ADMIN_USER`.

Password minimal 8 karakter. Password tersimpan sebagai hash scrypt di PC, tidak pernah dalam bentuk asli, dan tidak bisa dilihat lagi setelah dibuat.

## Kuota ("booking disk")

Kuota adalah **batas maksimal logis**, bukan ruang yang dikunci di disk. Folder akun tidak membesar sebelum diisi.

- **Pengecekan awal**: unggahan ditolak (413) bila `Content-Length` sudah melebihi sisa kuota, dan UI juga menolak lebih dulu di browser.
- **Pengecekan saat streaming**: bila ukuran tidak diketahui atau berbohong, unggahan dihentikan begitu melewati kuota, file sementara dihapus, dan hitungan dikembalikan.
- **Sampah ikut dihitung**: menghapus file memindahkannya ke `.trash` akun itu dan ruangnya belum bebas. Ruang baru bebas setelah **Kosongkan sampah**.
- Menurunkan kuota berlaku seketika. Akun yang sudah melebihi kuota baru tidak kehilangan file, hanya tidak bisa mengunggah lagi sampai kembali di bawah batas.

### Alokasi agar tidak oversubscribe

Panel menghitung `kapasitas = ruang kosong disk + pemakaian semua akun non-owner`. Jumlah semua kuota tidak boleh melebihi kapasitas itu, sehingga "booking" tidak bisa lebih besar dari disk yang nyata. Bila tidak ingin dibatasi (misalnya thin provisioning), set `ALLOW_OVERBOOK=true` di `agent/agent.env`.

Catatan: karena kuota bukan reservasi fisik, file milik owner atau program lain di disk yang sama tetap bisa mengurangi ruang kosong. Sisihkan ruang cadangan.

## Izin

| Izin | Mengizinkan |
|---|---|
| `upload` | Unggah file |
| `modify` | Buat folder, ganti nama, pindah |
| `delete` | Hapus (ke sampah) dan kosongkan sampah |
| `share` | Buat link berbagi |

Melihat, mencari, dan mengunduh file sendiri selalu boleh. Akun tanpa izin apa pun adalah akun baca-saja. Perubahan izin dan kuota berlaku **seketika**, termasuk pada sesi yang sedang berjalan. Admin otomatis memegang semua izin.

## Sesi dan link berbagi

Setiap akun punya nomor versi token (`tv`). Mengganti password, menonaktifkan akun, atau menghapus akun menaikkan nomor itu, sehingga **semua sesi dan link berbagi akun tersebut langsung tidak berlaku**. Mengaktifkan kembali akun tidak menghidupkan sesi lama; pengguna harus login ulang. Link berbagi dibuat atas nama akunnya dan hanya bisa mengunduh dari folder akun itu.

## Tata letak data di PC

```
STORAGE_ROOT/
├── users/
│   ├── _owner/            # drive owner (+ .trash)
│   ├── alice/             # drive akun alice (+ .trash)
│   └── ...
└── .ait/
    ├── users.json         # akun, hash password, kuota, izin
    └── archive/           # folder akun yang dihapus
```

`.ait/` jangan dihapus dan harus ikut dicadangkan bersama `users/`.

## Migrasi dari versi 1

Saat agent versi 2 pertama kali berjalan pada folder penyimpanan lama (tidak ada `.ait/` dan ada isi lain), seluruh isi, termasuk `.trash`, otomatis dipindahkan ke `users/_owner`. Tidak ada file yang disalin ulang atau diubah isinya. Setelah itu akun owner melihat file yang sama seperti sebelumnya.

## Memperbarui deployment yang sudah ada

1. **PC**: ambil kode terbaru, hentikan agent lama, jalankan lagi `agent\start-agent.bat`. Log menampilkan `Migrated N item(s)...` bila migrasi terjadi. Tidak ada variabel baru yang wajib. `ALLOW_OVERBOOK` opsional.
2. **Coolify**: push ke GitHub lalu Deploy ulang. Variabel web tidak berubah (`ADMIN_USER`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `AGENT_URL`, `AGENT_TOKEN`).
3. Urutan aman: perbarui agent dulu, baru web. Web versi 2 memerlukan agent versi 2.
4. Setelah login sebagai owner, buka **Admin** untuk membuat akun.

Untuk rollback, kembalikan kode kedua komponen ke versi 1. Struktur `users/_owner` perlu dipindahkan kembali ke akar folder penyimpanan secara manual.
