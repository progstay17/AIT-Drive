# Panduan deploy

Dari nol sampai AIT Drive bisa dibuka lewat domain kamu. Urutannya: **agent di PC → tunnel → GitHub → Coolify → verifikasi**.

## 0. Persiapan

- PC dengan Node.js 20+ (cek: `node -v`).
- Domain di Cloudflare (untuk Cloudflare Tunnel). Alternatif tanpa domain: Tailscale (lihat 2B).
- Server Coolify yang sudah jalan, dan akun GitHub.

## 1. Agent di PC

> Cara cepat: jalankan `agent\setup-agent.bat`. Jendela **pilih folder** muncul untuk menentukan di mana file disimpan, lalu `agent.env` dibuat otomatis dengan `AGENT_TOKEN` acak dan ditampilkan untuk disalin ke Coolify. Langkah manual di bawah memberi hasil yang sama.

```bat
cd C:\cloud-drive
npm run install:all
copy agent\agent.env.example agent\agent.env
```

Edit `agent\agent.env`:

```
STORAGE_ROOT=C:\cloud-drive\storage
AGENT_HOST=127.0.0.1
AGENT_PORT=4001
AGENT_TOKEN=<hasil perintah di bawah>
```

Buat token acak (simpan, nanti dipakai juga di Coolify):

```bat
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Jalankan dengan `agent\start-agent.bat`. Pesan sukses: `Agent listening on http://127.0.0.1:4001`.

Cek cepat (harus `{"ok":true}`): `curl http://127.0.0.1:4001/health`

### Jalan otomatis saat Windows start

Pakai Task Scheduler supaya agent hidup walau tidak ada yang login ke jendela:

1. Buka **Task Scheduler** > Create Task.
2. General: beri nama `AIT Drive Agent`, centang *Run whether user is logged on or not*.
3. Triggers: *At startup*.
4. Actions: *Start a program* > Program: `C:\cloud-drive\agent\start-agent.bat`.
5. Conditions: hilangkan centang *Start the task only if the computer is on AC power* bila PC laptop.

Atur juga Windows agar tidak tidur saat dicolok listrik (Settings > System > Power).

> `start-agent.bat` membaca `agent.env` baris per baris. Jangan beri tanda kutip pada nilainya.

## 2. Tunnel dari server ke PC

Tunnel membuat alamat publik HTTPS yang meneruskan ke `http://127.0.0.1:4001` di PC.

### 2A. Cloudflare Tunnel (disarankan)

```bat
winget install --id Cloudflare.cloudflared
cloudflared tunnel login
cloudflared tunnel create ait-drive
cloudflared tunnel route dns ait-drive pc-agent.domainkamu.com
```

Buat `C:\Users\<nama-kamu>\.cloudflared\config.yml`:

```yaml
tunnel: ait-drive
credentials-file: C:\Users\<nama-kamu>\.cloudflared\<ID-TUNNEL>.json
ingress:
  - hostname: pc-agent.domainkamu.com
    service: http://127.0.0.1:4001
  - service: http_status:404
```

Jalankan sebagai layanan Windows (jalan otomatis): `cloudflared service install`.

Uji dari luar (harus 401, artinya sampai ke agent tetapi ditolak karena tanpa token): `curl -i https://pc-agent.domainkamu.com/list`

> **Batas ukuran**: Cloudflare plan gratis membatasi satu permintaan sekitar 100 MB. Unggahan lebih besar akan gagal. Untuk file besar pakai 2B.

### 2B. Tailscale (tanpa batas ukuran, tanpa domain)

1. Pasang Tailscale di PC **dan** di server Coolify, login ke tailnet yang sama.
2. Di `agent.env` ubah `AGENT_HOST=0.0.0.0` (atau IP Tailscale PC). Agent tetap dilindungi token, dan firewall Windows tetap menjaga akses dari luar tailnet.
3. Di Coolify nanti: `AGENT_URL=http://<ip-tailscale-pc>:4001`.

## 3. Push ke GitHub

Git belum tentu terpasang: `winget install --id Git.Git`.

```bat
cd C:\cloud-drive
git init
git add .
git status
```

**Periksa `git status` sebelum commit.** File berikut tidak boleh muncul: `agent/agent.env`, `web/local.env`, `web/coolify-secrets.txt`, `node_modules/`, `storage/`. (Semuanya sudah ada di `.gitignore`.)

```bat
git commit -m "AIT Drive v1.0.0"
git branch -M main
git remote add origin https://github.com/<akun>/ait-drive.git
git push -u origin main
```

Repo **private** disarankan.

## 4. Deploy di Coolify

1. **New Resource** > pilih repo GitHub kamu (Private Repository bila repo private).
2. **Build Pack**: `Dockerfile`.
3. **Base Directory**: `/web`  (penting, Dockerfile ada di dalam `web/`).
4. **Port Exposes**: `3000`.
5. **Environment Variables**:

| Variabel | Nilai |
|---|---|
| `ADMIN_USER` | username login |
| `ADMIN_PASSWORD` | password kuat (panjang) |
| `SESSION_SECRET` | 64 karakter hex acak (jangan sama dengan token agent) |
| `AGENT_URL` | `https://pc-agent.domainkamu.com` (tanpa `/` di akhir) |
| `AGENT_TOKEN` | **sama persis** dengan di `agent\agent.env` |
| `COOKIE_SECURE` | `true` |

6. **Domain**: mis. `https://drive.domainkamu.com`. Coolify menerbitkan sertifikat HTTPS otomatis.
7. **Deploy**.

> Coolify menjalankan healthcheck dari `Dockerfile` ke `/auth/me`. Kalau deploy "unhealthy", lihat log container: biasanya ada variabel yang kosong (`Missing env var: ...`).

Soal batas unggah di reverse proxy: Traefik (bawaan Coolify) tidak membatasi ukuran body secara default.

## 5. Verifikasi

1. Buka `https://drive.domainkamu.com`: layar login muncul.
2. Masuk. Sidebar kiri bawah harus menunjukkan **PC online**.
3. Unggah file kecil, unduh lagi, lalu hapus.
4. Matikan agent sebentar: UI harus menampilkan "Koneksi terputus" dan "PC offline".
5. Kalau muncul "Token agent tidak cocok", samakan `AGENT_TOKEN` (lihat TROUBLESHOOTING).

## 6. Update versi

```bat
git add . && git commit -m "perubahan" && git push
```

Coolify otomatis deploy ulang bila *Auto Deploy* aktif (atau tekan Deploy). Perubahan di `agent/` tidak ikut ke Coolify: salin/pull ke PC lalu restart agent.

Setelah update UI, hard refresh browser (`Ctrl+F5`) bila tampilan lama masih muncul.

## 7. Rotasi rahasia

| Yang diganti | Dampak | Langkah |
|---|---|---|
| `ADMIN_PASSWORD` | sesi lama tetap berlaku sampai habis | ubah di Coolify, redeploy. Ganti juga `SESSION_SECRET` bila ingin memaksa semua keluar |
| `SESSION_SECRET` | semua sesi dan **semua link berbagi** tidak berlaku | ubah di Coolify, redeploy |
| `AGENT_TOKEN` | gateway tidak bisa bicara ke agent sampai keduanya sama | ubah di `agent.env`, restart agent, ubah di Coolify, redeploy |

## 8. Backup

Seluruh data kamu ada di folder `STORAGE_ROOT` di PC. Backup folder itu (termasuk `.trash`) ke disk lain atau cloud. Repo GitHub hanya berisi kode, bukan data.

## 9. Mencabut/menghapus

- Hentikan akses publik: hentikan resource di Coolify atau hapus rute tunnel (`cloudflared tunnel route dns` bisa dihapus dari dashboard Cloudflare).
- Hentikan agent: tutup jendela `start-agent.bat` atau nonaktifkan task di Task Scheduler.

---

Dibuat oleh Fadhil Ghifarion 法迪 for AIT.

## Pengaturan wajib di Coolify

1. **Build Pack: Dockerfile**, Base Directory `/` (atau `/web`), Port `3000`. Jangan Railpack/Nixpacks.
2. **Persistent Storage**: tambahkan volume dengan path tujuan `/data`. Di situlah akun, kuota, dan izin disimpan. Tanpa ini akun hilang setiap redeploy.
3. **Environment Variables**: `ADMIN_USER`, `ADMIN_PASSWORD` (bebas kamu tentukan), `SESSION_SECRET`, `AGENT_URL`, `AGENT_TOKEN` (satu-satunya yang harus sama dengan PC), `COOKIE_SECURE=true`. Opsional: `DATA_DIR` (default `/data`), `ALLOW_OVERBOOK`.
4. Redeploy setiap kali variabel diubah.

## Memperbarui dari versi sebelumnya

1. Di PC: tarik kode terbaru, hentikan agent lama, jalankan `agent\start-agent.bat`. Isi folder penyimpanan v1 otomatis dipindah ke `users/_owner` (lihat baris `Migrated ...` di log).
2. Di Coolify: tambah Persistent Storage ke `/data`, push ke GitHub, Redeploy.
3. Perbarui agent dan web bersamaan.
4. Login sebagai owner dan buka **Admin** untuk membuat akun.

Rincian: [MULTI-USER.md](MULTI-USER.md).
