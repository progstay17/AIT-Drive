# Banyak akun, kuota, dan panel admin

AIT Drive mendukung banyak akun **tanpa pendaftaran terbuka**. Akun hanya dibuat oleh admin lewat panel admin. Setiap akun punya folder sendiri, batas kapasitas (kuota), dan izin sendiri.

## Siapa menyimpan apa

| Di mana | Isinya |
|---|---|
| **Server Coolify** (gateway `web/`) | Login, akun, hash password, kuota, izin, panel admin. Disimpan di `users.json` pada volume `/data` |
| **PC** (agent `agent/`) | Hanya file. Satu folder storage yang kamu pilih, berisi subfolder per akun |

Gateway memberi tahu agent di setiap permintaan siapa pemanggilnya dan berapa kuota serta izinnya. Agent hanya menegakkan itu. Karena akun ada di server, **login dan panel admin tetap berfungsi walau PC mati**. Yang tidak bisa saat PC mati hanyalah membuka file, serta membuat atau menghapus akun (butuh PC untuk memeriksa kapasitas disk dan mengarsipkan folder).

## Memilih folder storage di PC

Jalankan `agent\setup-agent.bat`. Jendela pilih folder muncul (atau ketik path sendiri), lalu `agent.env` dibuat otomatis dengan `AGENT_TOKEN` acak. Folder bisa di drive mana saja, misalnya `D:\AIT-Drive`. Jalankan setup lagi kapan saja untuk memindahkan lokasi: salin isi folder lama ke yang baru dulu, lalu pilih folder baru.

Tips: pakai folder khusus yang hanya berisi data AIT Drive, jangan `C:\`, folder Users, atau folder sistem.

## Peran

| Peran | Dari mana | Kuota | Izin | Bisa mengelola akun |
|---|---|---|---|---|
| **Owner** | Environment variable `ADMIN_USER` / `ADMIN_PASSWORD` di web | Tanpa batas | Semua | Semua akun, termasuk admin |
| **Admin** | Dibuat owner di panel | Opsional (kosong = tanpa batas) | Semua | Hanya akun pengguna biasa |
| **Pengguna** | Dibuat owner atau admin | Wajib, minimal 1 MB | Diatur per akun | Tidak |

Owner tidak disimpan di database dan passwordnya hanya bisa diganti lewat environment variable (lalu redeploy). Ini sengaja: kalau database akun hilang, kamu tetap bisa masuk dan memperbaikinya. Nilai `ADMIN_USER` dan `ADMIN_PASSWORD` bebas kamu tentukan di Coolify dan tidak perlu sama dengan apa pun di PC.

## Panel admin

Masuk sebagai owner atau admin, lalu buka **Admin** di sidebar (alamat `#admin`).

- **Ringkasan**: total disk PC, ruang kosong, kapasitas yang bisa dialokasikan, total kuota yang sudah dibagikan, jumlah akun.
- **Tambah pengguna**: username, password (tombol "Buat acak" membuat 14 karakter), peran, kuota dalam GB, izin, status aktif.
- **Edit**: ubah kuota, izin, status aktif, atau reset password. Username tidak bisa diubah.
- **Hapus akun**: datanya **tidak dihapus**, foldernya dipindah ke `.ait/archive/<id>__<waktu>` di PC dan bisa dipulihkan manual.

Aturan username: 3 sampai 32 karakter, huruf kecil, angka, titik, minus, garis bawah, diawali dan diakhiri huruf atau angka. Nama yang dicadangkan Windows (`con`, `nul`, dan sejenisnya) ditolak. Login tidak peka huruf besar/kecil. Username tidak boleh sama dengan `ADMIN_USER`.

Password minimal 8 karakter. Password tersimpan sebagai hash scrypt di server, tidak pernah dalam bentuk asli, dan tidak bisa dilihat lagi setelah dibuat.

## Kuota ("booking disk")

Kuota adalah **batas maksimal logis**, bukan ruang yang dikunci di disk. Folder akun tidak membesar sebelum diisi.

- **Pengecekan awal**: unggahan ditolak (413) bila `Content-Length` sudah melebihi sisa kuota, dan UI juga menolak lebih dulu di browser.
- **Pengecekan saat streaming**: bila ukuran tidak diketahui atau berbohong, unggahan dihentikan begitu melewati kuota, file sementara dihapus, dan hitungan dikembalikan.
- **Sampah ikut dihitung**: menghapus file memindahkannya ke `.trash` akun itu dan ruangnya belum bebas. Ruang baru bebas setelah **Kosongkan sampah**.
- Menurunkan kuota berlaku seketika. Akun yang sudah melebihi kuota baru tidak kehilangan file, hanya tidak bisa mengunggah lagi sampai kembali di bawah batas.

### Alokasi agar tidak oversubscribe

Panel menghitung `kapasitas = ruang kosong disk + pemakaian semua akun non-owner`. Jumlah semua kuota tidak boleh melebihi kapasitas itu, sehingga "booking" tidak bisa lebih besar dari disk yang nyata. Bila tidak ingin dibatasi (thin provisioning), set `ALLOW_OVERBOOK=true` di **environment web (Coolify)**.

Karena kuota bukan reservasi fisik, file lain di disk yang sama tetap bisa mengurangi ruang kosong. Sisihkan ruang cadangan.

## Izin

| Izin | Mengizinkan |
|---|---|
| `upload` | Unggah file |
| `modify` | Buat folder, ganti nama, pindah |
| `delete` | Hapus (ke sampah) dan kosongkan sampah |
| `share` | Buat link berbagi |

Melihat, mencari, dan mengunduh file sendiri selalu boleh. Akun tanpa izin apa pun adalah akun baca-saja. Perubahan izin dan kuota berlaku **seketika**, termasuk pada sesi yang sedang berjalan. Admin otomatis memegang semua izin.

## Sesi dan link berbagi

Setiap akun punya nomor versi token (`tv`). Mengganti password, menonaktifkan akun, atau menghapus akun menaikkan nomor itu, sehingga **semua sesi dan link berbagi akun tersebut langsung tidak berlaku**. Mengaktifkan kembali akun tidak menghidupkan sesi lama; pengguna harus login ulang. Link berbagi dibuat atas nama akunnya, hanya bisa mengunduh dari folder akun itu, dan mati bila izin `share` dicabut.

## Tata letak data

Di PC (folder yang kamu pilih, `STORAGE_ROOT`):

```
STORAGE_ROOT/
├── users/
│   ├── _owner/            # drive owner (+ .trash)
│   ├── alice/             # drive akun alice (+ .trash)
│   └── ...
└── .ait/
    └── archive/           # folder akun yang dihapus
```

Di server Coolify (volume `/data`):

```
/data/
└── users.json             # akun, hash password, kuota, izin
```

**Volume `/data` wajib dipasang sebagai Persistent Storage di Coolify.** Tanpa itu, akun hilang setiap redeploy (owner tetap bisa login). Cadangkan volume itu dan folder storage di PC.

Kalau `users.json` hilang tetapi folder di PC masih ada, buat ulang akun dengan username yang sama dan akun itu langsung melihat datanya lagi.

## Migrasi

- **Dari v1 (satu drive bersama)**: saat agent baru pertama kali berjalan pada folder penyimpanan lama (belum ada `.ait/` dan ada isi lain), seluruh isi, termasuk `.trash`, otomatis dipindahkan ke `users/_owner`. Tidak ada file yang disalin ulang atau diubah.
- **Dari v2 (akun disimpan di PC)**: versi ini tidak lagi membaca `.ait/users.json` di PC. Karena versi itu belum pernah dipakai di produksi, tidak ada migrasi otomatis. Buat ulang akunnya di panel admin; folder per akun di `users/<id>` tetap dipakai.

## Memperbarui deployment yang sudah ada

1. **PC**: ambil kode terbaru, hentikan agent lama, jalankan `agent\start-agent.bat` (atau `agent\setup-agent.bat` bila ingin mengganti folder).
2. **Coolify**: tambah Persistent Storage ke `/data`, push ke GitHub, lalu Redeploy. Variabel baru yang opsional: `DATA_DIR`, `ALLOW_OVERBOOK`.
3. Perbarui agent dan web bersamaan: web baru memakai endpoint `/sys/*` yang hanya ada di agent baru.
