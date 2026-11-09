# Keamanan

## Batas kepercayaan

- Browser tidak tepercaya dan tidak boleh menerima `AGENT_TOKEN`.
- Web Gateway memvalidasi sesi, akun, kuota, dan izin. Ia satu-satunya komponen yang boleh membuat header `X-AIT-*` untuk Agent.
- Storage Agent berada pada repository terpisah: https://github.com/progstay17/AIT-Drive-Agent.
- Tunnel/reverse proxy harus memakai HTTPS publik dan listener VPS loopback.

## Personal Access Tokens (PAT)

- Token hanya ditampilkan satu kali saat dibuat; Gateway menyimpan hash, bukan secret.
- Pemilik akun mengelola token miliknya dari menu Personal Access Tokens.
- Owner dapat melihat metadata token lintas akun di Admin → Personal Access Tokens, mencabut token tertentu, atau mencabut seluruh token milik satu akun.
- Panel admin tidak pernah mengembalikan token secret maupun hash.
- CLI dapat mencabut PAT yang sedang dipakainya melalui endpoint self-revocation. Local logout tanpa opsi revoke hanya menghapus kredensial lokal.
- Setiap PAT memiliki scope dan masa berlaku; perubahan permission akun dan status akun tetap diperiksa pada setiap request.

## Kontrol wajib

1. Jangan commit `web/local.env`, `AGENT_TOKEN`, password, `SESSION_SECRET`, token tunnel, private SSH key, atau data storage.
2. Simpan `AGENT_TOKEN` hanya di `C:\AIT-Drive-Agent\agent.env` dan environment variables Coolify. Nilainya harus sama persis.
3. Pertahankan Agent bind ke `127.0.0.1`; jangan expose port 4001 langsung ke internet.
4. Batasi SSH reverse listener pada VPS ke `127.0.0.1:8081`.
5. Lindungi volume `/data` Coolify dan `STORAGE_ROOT` PC dengan backup terpisah.
6. Jangan matikan Windows Defender atau menambahkan pengecualian untuk menjalankan binary tunnel yang ditandai.
7. Batasi akses admin Coolify dan akses GitHub sesuai kebutuhan.

## Token Agent

Agent memerlukan Bearer token untuk semua endpoint kecuali `/health`. Gateway menyimpan token server-side dan meneruskannya ke Agent; token tidak boleh masuk ke browser. Siapa pun yang memperoleh token dapat meniru gateway dan memilih identitas/permission melalui header `X-AIT-*`.

Untuk rotasi, buat token acak baru, ubah pada `agent.env` dan Coolify, restart Agent, redeploy gateway, lalu uji health dan operasi file. Jangan memasukkan token ke Git history.

Detail keamanan implementasi Agent: https://github.com/progstay17/AIT-Drive-Agent/blob/main/docs/SECURITY.md.