# Panduan Lengkap — AgentLP + Telegram Mini App "Kantor LP" (via Termius)

Hanya **Mini App**. Tidak ada lagi chat bot, perintah `/...`, atau notifikasi bot. Semua tampil di Mini App
(3 agent, posisi, PnL, aktivitas, log). Mini App bersifat **baca saja**; kendali manual (tutup posisi, dll.) lewat SSH/CLI (langkah 11).

Yang kamu butuhkan: VPS Ubuntu, Termius, akun Telegram, **domain yang DNS-nya di Cloudflare** (gratis), wallet Solana baru
khusus bot (saldo kecil), RPC Helius, dan API key OpenRouter.

---

## 1. Buat bot di @BotFather (hanya sebagai "wadah" Mini App)

1. Di Telegram buka **@BotFather** → kirim `/newbot` → isi nama & username (harus berakhiran `bot`).
2. Salin **token** (bentuk `123456789:AAH...`). Ini nilai `TELEGRAM_BOT_TOKEN`. Rahasiakan.
3. Buka **@userinfobot** → kirim pesan apa saja → salin angka **Id** kamu. Ini nilai `TELEGRAM_ALLOWED_USER_IDS`.

Tombol menu Mini App diatur di langkah 7 (setelah alamat HTTPS jadi).

---

## 2. Siapkan VPS (Termius)

Sambungkan ke VPS lewat Termius, lalu jalankan satu per satu:

```bash
sudo apt update && sudo apt install -y unzip curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2
node -v    # harus v22.x
```

---

## 3. Upload & install project

1. Di Termius buka tab **SFTP** → upload `agentlp.zip` ke folder home (`/root` atau `/home/USERNAMEMU`).
2. Di terminal:

```bash
cd ~
unzip agentlp.zip
cd agentlp
npm install
cp .env.example .env
cp user-config.example.json user-config.json
```

> Jika setelah unzip folder-nya `agentlp/agentlp`, masuk ke folder yang berisi file `index.js`.

---

## 4. Isi `.env` (apa yang harus diisi / diganti)

```bash
nano .env
```
(nano: **Ctrl+O** lalu Enter = simpan, **Ctrl+X** = keluar)

Ganti **semua nilai placeholder** berikut:

| Baris di `.env` | Ganti dengan | Asal |
|---|---|---|
| `WALLET_PRIVATE_KEY=` | private key base58 wallet **baru** | Phantom/Solflare → export. Saldo kecil saja |
| `RPC_URL=` | `https://mainnet.helius-rpc.com/?api-key=KEYMU` | helius.dev (gratis) |
| `HELIUS_API_KEY=` | key Helius yang sama | helius.dev |
| `OPENROUTER_API_KEY=` | `sk-or-...` | openrouter.ai |
| `TELEGRAM_BOT_TOKEN=` | token dari langkah 1 | @BotFather |
| `TELEGRAM_ALLOWED_USER_IDS=` | ID Telegram kamu (angka) | @userinfobot |
| `MINIAPP_URL=` | `https://kantor.domainmu.com` (diisi setelah langkah 6) | domain kamu |

Biarkan apa adanya: `MINIAPP_PORT=8787`, `MINIAPP_HOST=127.0.0.1`, `DRY_RUN=true`.

Variabel lama yang **sudah tidak dipakai** — hapus bila ada di `.env` lama: `TELEGRAM_CHAT_ID`,
`TELEGRAM_BOT_TOKEN_SCOUT`, `TELEGRAM_BOT_TOKEN_POSISI`, `TELEGRAM_BOT_TOKEN_LAPORAN`
(dan `telegramChatId` di `user-config.json`, kalau ada).

Lalu `user-config.json`:

```bash
nano user-config.json
```
Biasanya cukup bawaan; sesuaikan preset/strategi bila perlu. (Alternatif interaktif: `npm run setup`.)

---

## 5. Tes jalan

```bash
npm run test:syntax
npm start
```

Cari baris `Mini App jalan di 127.0.0.1:8787`. Buka **tab Termius baru** (sambungan SSH kedua) dan cek:

```bash
curl http://127.0.0.1:8787/healthz     # harus membalas: ok
```

Tekan **Ctrl+C** di tab pertama untuk berhenti. Peringatan di log:
`TELEGRAM_BOT_TOKEN kosong` / `TELEGRAM_ALLOWED_USER_IDS kosong` = `.env` belum benar.

---

## 6. Alamat HTTPS tetap — Cloudflare Named Tunnel

Telegram hanya mau membuka Mini App lewat **HTTPS publik**. Cloudflare Tunnel memberi alamat tetap tanpa membuka port VPS.

Cek arsitektur VPS dulu:

```bash
uname -m      # x86_64 → amd64 | aarch64 → arm64
```

Install cloudflared (x86_64; untuk arm64 ganti `amd64` dengan `arm64`):

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cf.deb
sudo dpkg -i cf.deb
cloudflared tunnel login
```
`tunnel login` menampilkan link → salin & buka di browser HP/PC → pilih domainmu → Authorize.

```bash
cloudflared tunnel create kantor-lp
```
Catat **Tunnel ID** (kode panjang) dan lokasi file `TUNNEL_ID.json` yang disebut di output.

```bash
cloudflared tunnel route dns kantor-lp kantor.domainmu.com
```

Buat config untuk service (ganti `TUNNEL_ID` dan `kantor.domainmu.com`):

```bash
sudo mkdir -p /etc/cloudflared
sudo cp ~/.cloudflared/TUNNEL_ID.json /etc/cloudflared/
sudo nano /etc/cloudflared/config.yml
```
Isi:
```yaml
tunnel: TUNNEL_ID
credentials-file: /etc/cloudflared/TUNNEL_ID.json
ingress:
  - hostname: kantor.domainmu.com
    service: http://127.0.0.1:8787
  - service: http_status:404
```

Jalankan permanen:

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared      # harus active (running)
```

Lalu isi `MINIAPP_URL` di `.env` (`nano .env`):
```
MINIAPP_URL=https://kantor.domainmu.com
```

Tes dari luar (setelah agent jalan di langkah 8): `curl https://kantor.domainmu.com/healthz` → `ok`.

---

## 7. Pasang tombol Mini App di sebelah kiri kolom ketik (BotFather)

Tombol ini muncul di **sebelah kiri kolom ketik** di chat bot. Pengaturannya di BotFather:

1. Buka **@BotFather** → kirim `/setmenubutton`
2. Pilih bot kamu
3. Kirim URL: `https://kantor.domainmu.com` (**sama persis** dengan `MINIAPP_URL`)
4. Kirim judul tombol: `Kantor LP`

Jalur lewat menu (kalau `/setmenubutton` tidak tersedia di tampilan BotFather kamu):
`/mybots` → pilih bot → **Bot Settings** → **Menu Button** → **Configure menu button** → kirim URL → kirim judul.

Kalau sukses, BotFather membalas bahwa menu button sudah diubah. Lalu:

1. Buka **chat pribadi** dengan botmu → kirim `/start` (sekali, supaya chat terbuka).
2. Tombol **Kantor LP** muncul di kiri kolom ketik. Tap = Mini App terbuka.
3. Kalau belum muncul: tutup chat, tutup total aplikasi Telegram, buka lagi.

Alternatif lewat Termius (ganti `TOKEN_BOTMU`):

```bash
curl -s "https://api.telegram.org/botTOKEN_BOTMU/setChatMenuButton" \
  -H "Content-Type: application/json" \
  -d '{"menu_button":{"type":"web_app","text":"Kantor LP","web_app":{"url":"https://kantor.domainmu.com"}}}'
```
Balasan `{"ok":true,...}` = berhasil.

Catatan: tombol menu hanya tampil di **chat pribadi**, bukan di grup. Bot ini tidak membalas pesan apa pun — itu normal.

---

## 8. Jalan 24 jam (PM2)

```bash
cd ~/agentlp
npm run pm2:start
pm2 save
pm2 startup
```
`pm2 startup` mencetak satu perintah `sudo env PATH=... pm2 startup ...` → **salin & jalankan perintah itu**, lalu `pm2 save` lagi.

Pantau:
```bash
pm2 logs agentlp          # Ctrl+C untuk keluar log
pm2 status
```
Harus ada: `Mini App jalan di 127.0.0.1:8787`. Setelah itu buka Mini App dari tombol di langkah 7.

---

## 9. Ubah pengaturan / update

```bash
cd ~/agentlp
nano .env                  # atau nano user-config.json
npm run pm2:restart
```
Jangan jalankan `node index.js` manual saat PM2 aktif (bentrok port 8787). Cek duplikat: `pm2 list`.

---

## 10. Pindah ke LIVE (uang sungguhan)

Biarkan `DRY_RUN=true` minimal beberapa hari sampai Mini App menampilkan keputusan yang masuk akal. Lalu:
`nano .env` → `DRY_RUN=false` → `npm run pm2:restart`. Mini App menampilkan badge **DRY RUN** / **LIVE** di kanan atas.

---

## 11. Kendali lewat SSH (karena bot sudah dihapus)

Mini App hanya melihat. Aksi manual lewat Termius:

```bash
cd ~/agentlp
node cli.js positions
node cli.js balance
node cli.js close --position ALAMAT_POSISI
node cli.js claim --position ALAMAT_POSISI
node cli.js config
node cli.js performance
```
Tambahkan `--dry-run` untuk simulasi pada perintah yang mendukungnya.

---

## 12. Masalah umum

| Gejala | Penyebab | Solusi |
|---|---|---|
| Tombol "Kantor LP" tidak muncul | Menu button belum diatur / bukan chat pribadi | Ulangi langkah 7, kirim `/start`, restart Telegram |
| Mini App putih / "tidak bisa dimuat" | Tunnel mati atau URL beda | `sudo systemctl status cloudflared`; `curl https://DOMAIN/healthz` |
| "Akses ditolak" | ID kamu tidak ada di `TELEGRAM_ALLOWED_USER_IDS`, atau token bot di `.env` beda dengan bot yang tombolnya dibuka | Samakan keduanya, `npm run pm2:restart` |
| "Buka lewat Telegram" | Dibuka dari browser biasa | Buka dari tombol di bot (atau tambah `?demo` untuk contoh tampilan) |
| `EADDRINUSE` di log | Ada proses ganda di port 8787 | `pm2 list`, hentikan duplikat atau ganti `MINIAPP_PORT` (dan `service:` di config tunnel) |
| Error 502 / 1033 dari Cloudflare | Agent tidak jalan atau tunnel salah port | `pm2 status`; samakan port di `config.yml` dengan `MINIAPP_PORT` |
| Data posisi kosong | RPC bermasalah / belum ada posisi | Cek `RPC_URL`, `pm2 logs agentlp` |

---

## 13. Keamanan

- `.env` dan `user-config.json` sudah di `.gitignore`. Jangan pernah commit private key atau token bot.
- Gunakan wallet khusus bot dengan saldo kecil.
- Mini App memvalidasi tanda tangan Telegram (`initData`) dan hanya menerima ID di `TELEGRAM_ALLOWED_USER_IDS`.
- Server hanya mendengarkan `127.0.0.1`; satu-satunya jalur publik adalah Cloudflare Tunnel.
