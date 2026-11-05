# Troubleshooting

| Gejala | Kemungkinan | Tindakan |
|---|---|---|
| Login gagal | `ADMIN_USER`/`ADMIN_PASSWORD` tidak cocok atau rate limit aktif | Periksa environment Coolify; tunggu jendela rate limit berakhir |
| Status PC offline | Agent mati, PC tidur, tunnel putus, atau Caddy upstream salah | Uji local Agent `/health`, lalu public Agent `/health`; periksa task SSH dan Caddy Panel |
| Token Agent tidak cocok | `AGENT_TOKEN` di gateway dan Agent berbeda | Samakan nilai secara privat pada Coolify dan `C:\AIT-Drive-Agent\agent.env`, restart/redeploy |
| Upload 413 | Kuota habis, disk fisik penuh, atau proxy membatasi body | Periksa stats akun, disk PC, serta limit/timeouts proxy |
| File/folder 404 | Path salah atau item tidak ada | Periksa path relatif pada root akun |
| Task terdaftar tapi proses tidak berjalan | Task belum dieksekusi, akun task salah, atau action path salah | Jalankan manual, lihat Last Run Result, periksa Task Scheduler |

## Pemeriksaan berurutan

1. Pada PC storage:
   ```powershell
   Get-NetTCPConnection -LocalPort 4001 -State Listen
   Invoke-RestMethod http://127.0.0.1:4001/health
   ```
2. Pada VPS:
   ```powershell
   Test-NetConnection 127.0.0.1 -Port 8081
   Invoke-RestMethod http://127.0.0.1:8081/health
   ```
3. Dari PC atau jaringan luar:
   ```powershell
   Invoke-RestMethod https://<hostname-agent>/health
   ```
4. Request endpoint terlindungi tanpa token harus mendapat HTTP 401. Itu normal dan membuktikan route mencapai Agent.
5. Periksa `AGENT_URL` dan `AGENT_TOKEN` pada environment Coolify. Jangan cetak atau bagikan isi secret.

Catatan: TCP port terbuka saja tidak membuktikan HTTP upstream sehat. Uji `/health` untuk memastikan request sampai ke Agent.

## Batas aman saat mengirim diagnostik

Boleh kirim status service/task, port/listener, error text setelah secret disensor, dan hasil health check. Jangan kirim `agent.env`, private SSH key, bearer token, tunnel token, atau command line yang berisi credential.

Panduan detail: [Deployment](DEPLOYMENT.md) dan [Agent Troubleshooting](https://github.com/progstay17/AIT-Drive-Agent/blob/main/docs/TROUBLESHOOTING.md).