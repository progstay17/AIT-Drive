# Banyak akun, kuota, dan panel admin

AIT Drive mendukung banyak akun tanpa signup terbuka. Akun hanya dibuat owner/admin melalui panel admin.

## Siapa menyimpan apa

| Komponen | Lokasi | Data |
|---|---|---|
| Web Gateway | Coolify (`web/` pada repo ini) | Login, hash password, kuota, izin, sesi, panel admin, metadata akun pada `/data` |
| Storage Agent | PC; repo [AIT-Drive-Agent](https://github.com/progstay17/AIT-Drive-Agent) | File pengguna di `STORAGE_ROOT` saja |
| Tunnel | Caddy Panel di VPS | Jalur HTTPS menuju Agent |

Gateway memvalidasi pemanggil lalu mengirim account ID, kuota, dan izin ke Agent pada setiap request. Karena metadata akun berada di Coolify, login dan panel admin dapat tetap berfungsi ketika PC offline; operasi file memerlukan Agent online.

## Memilih folder storage

Pada PC, jalankan `C:\AIT-Drive-Agent\setup-agent.bat`. Pilih folder khusus untuk data AIT Drive (misalnya `D:\AIT-Drive-Storage`), bukan folder aplikasi atau root drive. Setup menulis `agent.env` pada checkout Agent. Pertahankan `STORAGE_ROOT` dan `AGENT_TOKEN` ketika melakukan upgrade.

## Peran

| Peran | Dari mana | Kuota | Izin | Bisa mengelola akun |
|---|---|---|---|---|
| Owner | `ADMIN_USER` / `ADMIN_PASSWORD` di Coolify | Tanpa batas | Semua | Semua akun, termasuk admin |
| Admin | Dibuat owner di panel | Opsional | Semua | Akun pengguna biasa |
| Pengguna | Dibuat owner/admin | Wajib | Diatur per akun | Tidak |

Owner tidak disimpan di database. Password owner diganti lewat environment variable dan redeploy.

## Panel admin

Masuk sebagai owner/admin, lalu buka Admin di sidebar.

- Ringkasan: disk total/free, kapasitas alokasi, kuota terpakai, jumlah akun.
- Tambah/edit akun: username, password, peran, kuota, izin, status aktif.
- Hapus akun: gateway meminta Agent memindahkan folder akun ke `.ait/archive`; data tidak langsung dihapus.

## Kuota

Kuota adalah batas logis, bukan ruang fisik yang dikunci. Upload ditolak bila melewati kuota atau disk tidak cukup. File di `.trash` masih dihitung sampai trash dikosongkan. File di luar AIT Drive dapat mengurangi ruang disk fisik.

Panel mencegah total kuota melebihi kapasitas yang tersedia kecuali `ALLOW_OVERBOOK=true` pada gateway.

## Izin

| Izin | Aksi |
|---|---|
| `upload` | Unggah file |
| `modify` | Buat folder, rename, move |
| `delete` | Soft-delete dan empty trash |
| `share` | Membuat share link pada gateway |

Melihat, mencari, dan mengunduh file sendiri selalu boleh bagi akun aktif.

## Tata letak data

PC (`STORAGE_ROOT`):

```text
STORAGE_ROOT/
├── users/<account-id>/
│   └── .trash/
└── .ait/archive/
```

Coolify (`/data`): `users.json` berisi akun, hash password, kuota, dan izin. Volume `/data` wajib persistent.

## Migrasi dan update

Agent melakukan migrasi layout lama ke `users/_owner` pada startup pertama bila belum ada `.ait/`; backup storage sebelum upgrade legacy. Update gateway dilakukan dengan deploy ulang repo ini. Update Agent dilakukan terpisah pada PC dari repo [AIT-Drive-Agent](https://github.com/progstay17/AIT-Drive-Agent), kemudian restart Agent. Jangan menyalin source Agent ke repository gateway.