# Referensi API

Ada dua API: **gateway** (yang dipakai UI dan browser) dan **agent** (internal, hanya dipanggil gateway). Semua path file bersifat relatif terhadap root drive, dipisah `/`, tanpa awalan `/`. String kosong berarti root.

## Gateway (`web/`)

### Autentikasi

| Method | Path | Body | Respons |
|---|---|---|---|
| POST | `/auth/login` | `{"username","password"}` | 200 `{ok:true}` + cookie `sid` · 401 salah · 429 terlalu banyak percobaan |
| POST | `/auth/logout` | — | 200 `{ok:true}`, cookie dihapus |
| GET | `/auth/me` | — | 200 `{authenticated:boolean}` |

Cookie `sid`: `HttpOnly; SameSite=Lax; Path=/` (+ `Secure` bila `COOKIE_SECURE=true`).
Rate limit: 5 kegagalan per IP per 15 menit, lalu 429 (termasuk untuk password yang benar) sampai jendela habis.

### File (`/api/*`)

Semua wajib cookie `sid` yang valid (jika tidak: 401). Permintaan **selain GET** juga wajib header `X-Requested-With: drive` (jika tidak: 403).

| Method | Path | Parameter | Respons |
|---|---|---|---|
| GET | `/api/status` | — | `{agent:boolean}` (PC terjangkau atau tidak) |
| GET | `/api/list` | `path` | `{path, items:[{name,type:"dir"\|"file",size,mtime}]}` — folder dulu, lalu urut nama |
| GET | `/api/stats` | — | `{total, free, used}` dalam byte. `used` = total isi drive |
| GET | `/api/search` | `q` | `{items:[{name,path,type,size,mtime}]}` maksimal 200 hasil, tidak peka huruf besar/kecil |
| GET | `/api/download` | `path`, `inline=1` (opsional) | isi file. Mendukung `Range` (206). `inline=1` untuk pratinjau, tanpa itu sebagai lampiran |
| POST | `/api/upload` | `path` (folder tujuan), body `multipart/form-data` dengan field `file` | `{saved:[namaTersimpan]}`. Nama bentrok menjadi `nama (1).ext` |
| POST | `/api/mkdir` | JSON `{path, name}` | `{ok:true}` · 409 bila sudah ada |
| POST | `/api/rename` | JSON `{path, newName}` | `{ok:true}` |
| POST | `/api/move` | JSON `{path, dest}` | `{ok:true}`. Tidak bisa memindah folder ke dalam dirinya sendiri |
| POST | `/api/delete` | JSON `{path}` | `{ok:true}`. Dipindah ke `.trash`, bukan dihapus permanen |
| POST | `/api/share` | JSON `{path, days}` (1–30, default 7) | `{url, days}` |

Contoh:

```bash
# login, simpan cookie
curl -c jar.txt -H "Content-Type: application/json" \
  -d '{"username":"han","password":"RAHASIA"}' https://drive.domainkamu.com/auth/login

# daftar file
curl -b jar.txt "https://drive.domainkamu.com/api/list?path=Foto"

# unggah
curl -b jar.txt -H "X-Requested-With: drive" \
  -F "file=@liburan.jpg" "https://drive.domainkamu.com/api/upload?path=Foto"
```

### Link berbagi

| Method | Path | Respons |
|---|---|---|
| GET | `/s/:token` | isi file sebagai lampiran, tanpa login · 404 bila token rusak atau kedaluwarsa |

### Kode kesalahan umum

| Kode | Arti |
|---|---|
| 400 | path atau nama tidak valid (misalnya mengandung `..`, atau mencoba masuk `.trash`) |
| 401 | belum login / sesi habis |
| 403 | header `X-Requested-With: drive` tidak ada pada permintaan non-GET |
| 404 | file atau folder tidak ada |
| 409 | sudah ada dengan nama itu |
| 413 | file melebihi batas agent (50 GB) |
| 429 | terlalu banyak percobaan login |
| 502 | PC tidak terjangkau, atau `AGENT_TOKEN` tidak cocok (pesannya menjelaskan) |

Respons error berbentuk `{"error":"pesan"}`.

## Storage Agent (repository terpisah)

Hanya untuk gateway. Semua endpoint kecuali `/health` butuh header `Authorization: Bearer <AGENT_TOKEN>` (salah/kosong: 401 `{"error":"unauthorized"}`).

| Method | Path | Keterangan |
|---|---|---|
| GET | `/health` | `{ok:true}`, tanpa token. Dipakai untuk status "PC online" |
| GET | `/list?path=` | sama dengan gateway |
| GET | `/stats` | sama dengan gateway |
| GET | `/search?q=` | sama dengan gateway |
| GET | `/download?path=&inline=` | `Content-Disposition` memakai `filename*=UTF-8''...`, `nosniff` |
| POST | `/upload?path=` | multipart, nama file dibersihkan (`path.basename`), ditulis ke `*.part` lalu di-rename |
| POST | `/mkdir` `/rename` `/move` `/delete` | JSON seperti di atas |

Aturan nama (mkdir/rename/unggah): tidak kosong, bukan `.` atau `..`, maksimal 200 karakter, tanpa `\ / : * ? " < > |` dan karakter kontrol.

---

Referensi Agent lengkap: https://github.com/progstay17/AIT-Drive-Agent/blob/main/docs/API.md

## Akun, kuota, dan admin (v2)

Semua endpoint gateway berikut memakai cookie sesi dan header `X-Requested-With: drive` pada metode selain GET.

| Metode dan path | Siapa | Keterangan |
|---|---|---|
| `GET /api/me` | semua | `{ id, name, role, quota, perms, canAdmin, canChangePassword }` |
| `POST /api/me/password` | pengguna dan admin | Body `{ current, next }` (min 8 karakter). Mengakhiri sesi (`relogin: true`). Owner: 400 |
| `POST /api/trash/empty` | izin `delete` | Mengosongkan sampah akun sendiri dan membebaskan kuota |
| `GET /api/stats` | semua | `total, free, used, trash, quota, diskFree`. `total` dan `free` mengikuti kuota bila ada |
| `GET /api/admin/overview` | owner, admin | `diskTotal, diskFree, capacity, allocated, userCount, allowOverbook` |
| `GET /api/admin/users` | owner, admin | Daftar akun (tanpa hash password) beserta pemakaian |
| `POST /api/admin/users` | owner, admin | `{ username, password, role?, quota?, perms?, active? }`. 201, 400 (validasi/alokasi), 409 (sudah ada) |
| `PATCH /api/admin/users/:id` | owner, admin | Ubah `password, role, quota, perms (parsial), active`. 404 bila tidak ada |
| `DELETE /api/admin/users/:id` | owner, admin | Mengarsipkan folder di PC ke `.ait/archive` (PC harus online), mengembalikan `{ archived }` |

Kode status penting: **403** izin kurang atau akun nonaktif, **413** kuota terlampaui (pesan "Kuota ..."), **401** sesi tidak berlaku. Admin yang menyentuh akun admin mendapat 403.

Endpoint file yang sudah ada (`list`, `search`, `download`, `upload`, `mkdir`, `rename`, `move`, `delete`, `share`) kini bekerja di folder akun masing-masing dan memeriksa izin: `upload`, `modify` (mkdir, rename, move), `delete`, `share`.

### Gateway ke agent

Gateway mengirim `Authorization: Bearer <AGENT_TOKEN>` ditambah `X-AIT-User` (id akun atau `_owner`), `X-AIT-Quota` (byte, kosong = tanpa batas), dan `X-AIT-Perms` (daftar izin dipisah koma). Agent **tidak menyimpan akun**; ia hanya menegakkan nilai itu. Endpoint khusus gateway di agent: `GET /sys/disk`, `POST /sys/usage {ids}`, `POST /sys/users/:id/init`, `POST /sys/users/:id/archive`. Respons 401 agent berarti `AGENT_TOKEN` salah (gateway menjawab 502). Akun, login, `/me`, dan `/admin/*` ditangani gateway sendiri.
