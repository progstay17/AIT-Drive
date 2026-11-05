# Deployment: Coolify Gateway + Storage Agent

AIT Drive terdiri dari dua repository yang dideploy terpisah:

- **Web Gateway:** repository `progstay17/AIT-Drive`, dideploy ke Coolify.
- **Storage Agent:** repository `progstay17/AIT-Drive-Agent`, di-install pada PC yang menyimpan file.
- **Tunnel:** Caddy Panel di VPS, menghubungkan hostname HTTPS Agent ke `127.0.0.1:4001` di PC melalui SSH reverse tunnel.

## 1. Pasang Storage Agent pada PC

Ikuti panduan instalasi di [AIT-Drive-Agent README](https://github.com/progstay17/AIT-Drive-Agent). Ringkas:

```powershell
git clone https://github.com/progstay17/AIT-Drive-Agent.git C:\AIT-Drive-Agent
cd C:\AIT-Drive-Agent
npm ci
.\setup-agent.bat
.\start-agent.bat
```

Pilih folder `STORAGE_ROOT` yang benar. Jika memindahkan instalasi lama, pertahankan folder storage dan token yang sedang digunakan. Jangan letakkan data di folder source repo.

Uji lokal:

```powershell
Invoke-RestMethod http://127.0.0.1:4001/health
```

Harus mengembalikan `{ ok: true }`.

## 2. Siapkan tunnel Caddy Panel

Deployment AIT saat ini menggunakan Caddy Panel SSH reverse tunnel:

1. Di Caddy Panel, buat client SSH tunnel dari storage PC.
2. VPS listener harus `127.0.0.1:8081`; tujuan di PC `127.0.0.1:4001`.
3. Public key SSH dipasang pada akun VPS dan dibatasi ke listener loopback port `8081`.
4. Di PC, salin `run-tunnel.ps1.example` menjadi `run-tunnel.ps1`, isi VPS host/user, lalu tes SSH secara manual.
5. Di Caddy Panel, buat site HTTPS Agent dan set upstream `127.0.0.1:8081`.
6. Verifikasi `https://<hostname-agent>/health` mengembalikan `{ ok: true }`.
7. Uji endpoint terlindungi tanpa token, misalnya `/list`; hasil harus 401.

Jangan membuka port `4001` ke internet. Detail dan troubleshooting tunnel ada di [repo Agent](https://github.com/progstay17/AIT-Drive-Agent/tree/main/docs).

## 3. Deploy Web Gateway ke Coolify

1. Di Coolify, buat resource dari Git repository `progstay17/AIT-Drive`.
2. Build Pack: **Dockerfile**.
3. Base Directory: `/web`.
4. Exposed Port: `3000`.
5. Tambahkan Persistent Storage dengan destination `/data`.
6. Isi environment variables:

| Variable | Nilai |
|---|---|
| `ADMIN_USER` | Username owner |
| `ADMIN_PASSWORD` | Password kuat |
| `SESSION_SECRET` | Random secret minimal 32 karakter |
| `AGENT_URL` | `https://<hostname-agent>` tanpa slash akhir |
| `AGENT_TOKEN` | Nilai yang sama persis dengan `AGENT_TOKEN` di Agent `agent.env` |
| `COOKIE_SECURE` | `true` |
| `DATA_DIR` | `/data` |
| `ALLOW_OVERBOOK` | `false` (opsional) |

7. Pasang domain web dan aktifkan HTTPS.
8. Deploy.

## 4. Verifikasi end-to-end

1. Buka domain web; layar login muncul.
2. Login sebagai owner.
3. Status storage/PC menunjukkan online.
4. Upload file kecil, download kembali, lalu hapus (soft-delete).
5. Cek endpoint Agent tanpa token harus 401 untuk route selain `/health`.
6. Matikan tunnel sementara: gateway harus melaporkan storage offline, bukan menampilkan error mentah.

## 5. Update terpisah

- Perubahan UI/gateway: push repository AIT-Drive; Coolify redeploy otomatis bila Auto Deploy aktif.
- Perubahan Agent: pull repository AIT-Drive-Agent pada PC, jalankan `npm ci` bila dependencies berubah, restart Agent.
- Perubahan tunnel: dikelola dari Caddy Panel/Task Scheduler, tidak ikut deployment Coolify.

## 6. Backup dan pemulihan

Backup dua lokasi secara terpisah:

- `STORAGE_ROOT` pada PC: seluruh file pengguna, trash, dan archive.
- Persistent volume `/data` di Coolify: akun, hash password, kuota, dan permissions.

Uji restore berkala. GitHub repository berisi source code dan dokumentasi, bukan backup file pengguna atau secrets.

## 7. Rotasi secret

1. Generate token Agent baru pada PC.
2. Ganti `AGENT_TOKEN` di Agent `agent.env` dan environment Coolify dengan nilai identik.
3. Restart Agent dan redeploy gateway.
4. Verifikasi health dan operasi file. Jangan commit token lama/baru.

---

Dibuat oleh Fadhil Ghifarion 法迪 for AIT.
