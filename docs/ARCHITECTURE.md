# Arsitektur

AIT Drive memiliki dua layanan yang dirilis terpisah. Repository ini berisi **Web Gateway**; Storage Agent berada di [repository AIT-Drive-Agent](https://github.com/progstay17/AIT-Drive-Agent).

```text
Browser --HTTPS--> web/ (Coolify)
                      | validasi sesi, akun, kuota, izin
                      | Authorization: Bearer AGENT_TOKEN
                      v
             HTTPS hostname Agent
                      | Caddy reverse proxy di VPS
               VPS 127.0.0.1:8081
                      | SSH reverse tunnel
              PC 127.0.0.1:4001
                      |
                 STORAGE_ROOT
```

## Web Gateway (`web/`)

- Login, session cookie, akun, kuota, izin, admin panel, share link.
- UI statis HTML/CSS/JavaScript di `web/public/`.
- Menjadi satu-satunya pintu untuk browser. Memvalidasi sesi dan izin, lalu meneruskan permintaan ke Agent.
- Menyimpan metadata akun di volume persisten `/data` pada Coolify.
- Menyimpan `AGENT_TOKEN` sebagai environment variable server-side; jangan pernah mengirim token ke browser.

## Storage Agent (repository terpisah)

- Berjalan pada PC yang menyimpan data, hanya mengelola file di `STORAGE_ROOT`.
- Tidak menyimpan password, sesi, atau sumber kebenaran akun.
- Mengharuskan Bearer token dan header identitas/kuota/izin dari gateway.
- Detail implementasi, storage layout, dan endpoint ada di [Agent Architecture](https://github.com/progstay17/AIT-Drive-Agent/blob/main/docs/ARCHITECTURE.md).

## Alur request

1. Browser mengirim request HTTPS ke gateway.
2. Gateway memvalidasi cookie, status akun, kuota, dan izin.
3. Gateway memanggil Agent melalui HTTPS, mengirim `Authorization: Bearer <AGENT_TOKEN>`, `X-AIT-User`, `X-AIT-Quota`, dan `X-AIT-Perms`.
4. Caddy di VPS meneruskan request ke listener loopback `127.0.0.1:8081`; SSH reverse tunnel meneruskannya ke Agent pada PC `127.0.0.1:4001`.
5. Agent melakukan operasi file di root akun dan mengembalikan response; gateway meneruskan response ke browser.

## Upload dan download

Gateway mem-proxy request/response sebagai stream agar file besar tidak perlu dimuat seluruhnya ke RAM. Agent menggunakan Busboy untuk multipart upload dan menulis ke file `.part` sebelum rename setelah sukses. Download menggunakan streaming response dan mendukung Range.

## Akun dan kuota

Gateway menyimpan akun, password hash, quota, permission, dan status pada `/data`. Agent menerima account ID, quota dalam bytes, dan permission pada setiap request. File per akun berada di `STORAGE_ROOT/users/<id>`. Soft-delete masuk `.trash` dan masih dihitung dalam kuota sampai trash dikosongkan.

## Keamanan

- Browser tidak mengetahui `AGENT_TOKEN`.
- Agent sebaiknya hanya bind ke `127.0.0.1`.
- Public access ke Agent melewati HTTPS reverse proxy dan tunnel.
- Gateway adalah trust boundary untuk identitas dan permission; siapa pun yang memiliki token Agent dapat meniru gateway.
- Lihat [Security](SECURITY.md) dan [Agent Security](https://github.com/progstay17/AIT-Drive-Agent/blob/main/docs/SECURITY.md).

## Operasional

- Coolify menjalankan gateway; PC menjalankan Agent; Caddy Panel mengelola tunnel.
- Update ketiga komponen dilakukan terpisah.
- Backup volume `/data` dan `STORAGE_ROOT` secara terpisah.