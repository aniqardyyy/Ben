## Laporan PnL Harian + Kalender Bulanan (jam 08:00 WIB)

Setiap hari jam 08:00 (zona waktu `PNL_REPORT_TZ`, default `Asia/Jakarta`) agent mengirim 2 gambar ke Telegram:

1. **Daily PnL** untuk kemarin: template kiri (hijau) kalau net profit, template kanan (merah) kalau net loss.
2. **Kalender PnL bulan berjalan**: tiap tanggal hijau (net profit), merah (net loss), abu-abu (tidak ada posisi ditutup).

Cara hitung (semua dari data nyata): PnL sehari = jumlah PnL semua posisi yang **ditutup** hari itu, dalam SOL.
Profit 1 + rugi 2 di hari yang sama = net -1 → merah. PnL posisi yang masih terbuka belum dihitung.
Data tercatat otomatis di `pnl-ledger.json` setiap posisi ditutup (hanya posisi yang ditutup SETELAH fitur ini aktif).

Pasang: `pip install -r pnl-report/requirements.txt` (butuh python3 + Pillow), lalu restart agent.

Perintah:
- `node pnl-report.js preview [YYYY-MM-DD]` → simpan gambar ke `./pnl-preview` (tidak kirim)
- `node pnl-report.js send [YYYY-MM-DD]` → kirim ke Telegram sekarang
- `/pnl` atau `/pnl YYYY-MM-DD` di Telegram → kirim sekarang

Opsi `.env`: `PNL_REPORT_ENABLED=false` (matikan), `PNL_REPORT_HOUR=8`, `PNL_REPORT_TZ=Asia/Jakarta`, `PNL_PYTHON=python3`.
Laporan ini tetap terkirim walau `TELEGRAM_SILENT=true`.
