/**
 * Laporan PnL harian + kalender bulanan (gambar BEN Agent LP), dikirim ke Telegram jam 08:00.
 *
 * Aturan data (semua dari data nyata, tidak ada angka karangan):
 *  - PnL harian  = jumlah PnL (SOL) semua posisi yang DITUTUP pada hari itu (zona waktu laporan).
 *                  Contoh: profit 1 + rugi 2 di hari yang sama → net -1 → merah.
 *  - positions   = open (masih terbuka di akhir hari itu) + closed (ditutup hari itu), dari state.json.
 *  - Kalender    : hijau = net > 0, merah = net < 0, abu-abu = tidak ada posisi ditutup / net 0.
 *  - PnL tiap posisi dicatat otomatis ke pnl-ledger.json saat posisi ditutup (hook di lessons.js).
 *  - Konversi USD → SOL memakai harga SOL saat posisi ditutup.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { log } from "./logger.js";
import { repoPath } from "./repo-root.js";
import { getSolPriceUsd } from "./sol-price.js";

const execFileP = promisify(execFile);
const LEDGER_FILE = repoPath("pnl-ledger.json");
const STATE_FILE = repoPath("state.json");
const RENDER_PY = repoPath("pnl-report", "render.py");

export const REPORT_TZ = process.env.PNL_REPORT_TZ || "Asia/Jakarta";
export const REPORT_HOUR = Math.min(23, Math.max(0, Number(process.env.PNL_REPORT_HOUR ?? 8)));
const EPS = 0.0005; // di bawah ini dianggap 0 (sama dengan pembulatan 3 desimal)

// ───────────── util tanggal (zona waktu laporan) ─────────────
const _dtf = new Intl.DateTimeFormat("en-CA", { timeZone: REPORT_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
/** ISO timestamp → "YYYY-MM-DD" di zona waktu laporan */
export function dayKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return _dtf.format(d);
}
export function todayKey() { return dayKey(new Date().toISOString()); }
export function yesterdayKey() { return shiftDay(todayKey(), -1); }
function shiftDay(key, delta) {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return t.toISOString().slice(0, 10);
}
function localHour() {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: REPORT_TZ, hour: "2-digit", hour12: false }).format(new Date())) % 24;
}

// ───────────── ledger ─────────────
function loadLedger() {
  try {
    if (fs.existsSync(LEDGER_FILE)) {
      const j = JSON.parse(fs.readFileSync(LEDGER_FILE, "utf8"));
      return { entries: Array.isArray(j.entries) ? j.entries : [], meta: j.meta || {} };
    }
  } catch (e) {
    log("pnl_report_error", `Ledger rusak/tidak terbaca: ${e.message}`);
  }
  return { entries: [], meta: {} };
}
function saveLedger(l) {
  const tmp = LEDGER_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(l, null, 2));
  fs.renameSync(tmp, LEDGER_FILE);
}

/**
 * Dipanggil dari lessons.recordPerformance() setiap posisi selesai ditutup.
 * @param {object} entry entri performa (punya pnl_usd, pool_name, position, recorded_at, ...)
 */
export async function recordClosedPnl(entry) {
  try {
    const ledger = loadLedger();
    const pos = entry.position || null;
    if (pos && ledger.entries.some((e) => e.position === pos)) return; // jangan dobel
    const price = await getSolPriceUsd();
    let pnl_sol = null;
    let price_source = "close";
    if (price) {
      pnl_sol = entry.pnl_usd / price;
    } else if (entry.amount_sol > 0 && entry.initial_value_usd > 0) {
      pnl_sol = entry.pnl_usd / (entry.initial_value_usd / entry.amount_sol); // harga saat open (cadangan)
      price_source = "implied_open";
    }
    ledger.entries.push({
      position: pos,
      pool_name: entry.pool_name || null,
      closed_at: entry.recorded_at || new Date().toISOString(),
      pnl_usd: entry.pnl_usd,
      pnl_sol: pnl_sol == null ? null : Math.round(pnl_sol * 1e6) / 1e6,
      sol_price_usd: price || null,
      price_source: pnl_sol == null ? null : price_source,
      fees_earned_usd: entry.fees_earned_usd ?? null,
      close_reason: entry.close_reason || null,
    });
    saveLedger(ledger);
  } catch (e) {
    log("pnl_report_error", `Gagal mencatat PnL ke ledger: ${e.message}`);
  }
}

// ───────────── agregasi ─────────────
function loadPositions() {
  try {
    if (fs.existsSync(STATE_FILE)) return Object.values(JSON.parse(fs.readFileSync(STATE_FILE, "utf8")).positions || {});
  } catch (e) {
    log("pnl_report_error", `state.json tidak terbaca: ${e.message}`);
  }
  return [];
}

async function fillMissingSol(entries) {
  // entri tanpa pnl_sol (harga SOL gagal diambil waktu tutup) → pakai harga sekarang, ditandai estimasi
  const missing = entries.filter((e) => e.pnl_sol == null);
  if (!missing.length) return;
  const price = await getSolPriceUsd();
  for (const e of missing) {
    if (price) { e.pnl_sol = e.pnl_usd / price; e.estimated = true; }
  }
}

/** Rekap satu hari (YYYY-MM-DD, zona waktu laporan). */
export async function computeDaily(key) {
  const ledger = loadLedger();
  const entries = ledger.entries.filter((e) => dayKey(e.closed_at) === key).map((e) => ({ ...e }));
  await fillMissingSol(entries);

  const positions = loadPositions();
  const endOfDay = (iso) => dayKey(iso) <= key;
  const openAtEnd = positions.filter((p) => p.deployed_at && dayKey(p.deployed_at) <= key && (!p.closed || dayKey(p.closed_at) > key));
  const closedToday = positions.filter((p) => p.closed && p.closed_at && dayKey(p.closed_at) === key);

  const pnl_sol = entries.reduce((s, e) => s + (e.pnl_sol || 0), 0);
  const pnl_usd = entries.reduce((s, e) => s + (e.pnl_usd || 0), 0);
  const closedCount = Math.max(closedToday.length, entries.length);
  return {
    date: key,
    pnl_sol: Math.abs(pnl_sol) < EPS ? 0 : pnl_sol,
    pnl_usd,
    open: openAtEnd.length,
    closed: closedCount,
    positions: openAtEnd.length + closedCount,
    unrecorded_closed: Math.max(0, closedToday.length - entries.length), // ditutup tapi PnL tidak tercatat
    estimated: entries.some((e) => e.estimated),
    status: openAtEnd.length > 0 ? "Active" : "Closed",
    items: entries.map((e) => ({ pool: e.pool_name || "?", pnl_sol: e.pnl_sol, pnl_usd: e.pnl_usd })),
  };
}

/** Rekap satu bulan; lastDay = hari terakhir yang sudah direkap (hari setelahnya = kosong/mendatang). */
export async function computeMonth(year, month, lastDay) {
  const ledger = loadLedger();
  const prefix = `${year}-${String(month).padStart(2, "0")}-`;
  const entries = ledger.entries.map((e) => ({ ...e, _k: dayKey(e.closed_at) })).filter((e) => e._k && e._k.startsWith(prefix) && Number(e._k.slice(8, 10)) <= lastDay);
  await fillMissingSol(entries);

  const days = {};
  for (const e of entries) {
    const d = Number(e._k.slice(8, 10));
    (days[d] ||= { pnl_sol: 0, pnl_usd: 0 });
    days[d].pnl_sol += e.pnl_sol || 0;
    days[d].pnl_usd += e.pnl_usd || 0;
  }
  let total = 0;
  for (const v of Object.values(days)) {
    v.status = v.pnl_sol > EPS ? "profit" : v.pnl_sol < -EPS ? "loss" : "none";
    total += v.pnl_sol;
  }
  return { year, month, last_day: lastDay, days, total_sol: total, total_usd: Object.values(days).reduce((s, v) => s + v.pnl_usd, 0) };
}

// ───────────── render (Python + Pillow) ─────────────
async function renderImage(kind, data) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pnl-"));
  const inFile = path.join(tmp, "data.json");
  const outFile = path.join(tmp, `${kind}.jpg`);
  fs.writeFileSync(inFile, JSON.stringify(data));
  const py = process.env.PNL_PYTHON || "python3";
  try {
    await execFileP(py, [RENDER_PY, kind, inFile, outFile], { timeout: 60_000 });
    return fs.readFileSync(outFile);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const f3 = (v) => (Math.abs(v) < EPS ? "0.000" : (v > 0 ? "+" : "-") + Math.abs(v).toFixed(3));
const usd = (v) => (v >= 0 ? "+$" : "-$") + Math.abs(v).toFixed(2);
const MONTHS_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function dailyCaption(d, m) {
  const [y, mo, dd] = d.date.split("-").map(Number);
  const emoji = d.pnl_sol > 0 ? "🟢" : d.pnl_sol < 0 ? "🔴" : "⚪";
  const lines = [
    `${emoji} <b>Daily PnL — ${dd} ${MONTHS_ID[mo - 1]} ${y}</b>`,
    `PnL hari ini: <b>${f3(d.pnl_sol)} SOL</b> (${usd(d.pnl_usd)})`,
    `Posisi: ${d.positions} • ${d.open} open • ${d.closed} closed`,
  ];
  if (d.items.length) {
    lines.push("", ...d.items.slice(0, 8).map((i) => `• ${esc(i.pool)}: ${i.pnl_sol == null ? "?" : f3(i.pnl_sol)} SOL`));
  }
  lines.push("", `📅 Bulan ${MONTHS_ID[m.month - 1]}: net <b>${f3(m.total_sol)} SOL</b> (${usd(m.total_usd)})`);
  const notes = [];
  if (d.unrecorded_closed > 0) notes.push(`${d.unrecorded_closed} posisi ditutup tapi PnL-nya tidak tercatat (tidak ikut dihitung)`);
  if (d.estimated) notes.push("sebagian PnL dikonversi ke SOL pakai harga SOL saat laporan dibuat (estimasi)");
  notes.push("PnL = realisasi dari posisi yang ditutup; posisi terbuka belum dihitung");
  lines.push("", `<i>${notes.join(" • ")}</i>`);
  return lines.join("\n");
}

/**
 * Buat (dan kirim) laporan untuk satu hari. Default: kemarin (hari penuh terakhir).
 * @param {{key?: string, send?: boolean, outDir?: string}} opts  send=false + outDir → simpan PNG saja (preview)
 */
export async function runPnlReport({ key = yesterdayKey(), send = true, outDir = null } = {}) {
  const [y, mo, dd] = key.split("-").map(Number);
  const daily = await computeDaily(key);
  const month = await computeMonth(y, mo, dd);

  const dailyImg = await renderImage("daily", daily);
  const calImg = await renderImage("calendar", month);

  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `daily-${key}.jpg`), dailyImg);
    fs.writeFileSync(path.join(outDir, `calendar-${y}-${String(mo).padStart(2, "0")}.jpg`), calImg);
  }
  if (send) {
    const { sendReportPhoto } = await import("./telegram.js");
    const ok1 = await sendReportPhoto(dailyImg, dailyCaption(daily, month));
    const ok2 = await sendReportPhoto(calImg, `📅 <b>PnL Kalender ${MONTHS_ID[mo - 1]} ${y}</b> (sampai tgl ${dd})`);
    if (!ok1 || !ok2) throw new Error("Pengiriman foto ke Telegram gagal (cek TELEGRAM_BOT_TOKEN / chat id, lihat log telegram_error)");
    const ledger = loadLedger();
    ledger.meta.last_report_for = key;
    saveLedger(ledger);
  }
  log("pnl_report", `Laporan ${key} selesai: ${f3(daily.pnl_sol)} SOL, ${daily.positions} posisi (${daily.open} open, ${daily.closed} closed)${send ? " — terkirim" : ""}`);
  return { daily, month };
}

/** Dijalankan cron jam 08:00 (zona waktu laporan). */
export async function runScheduledPnlReport() {
  try {
    await runPnlReport({});
  } catch (e) {
    log("pnl_report_error", `Laporan PnL harian gagal: ${e.message}`);
  }
}

/**
 * Kejar laporan yang terlewat (agent mati/restart saat jam 08:00).
 * Tidak mengirim apa pun pada pemakaian pertama kali (belum ada riwayat laporan) agar tidak kaget saat baru deploy.
 */
export async function maybeRunMissedPnlReport() {
  try {
    const ledger = loadLedger();
    const last = ledger.meta.last_report_for;
    if (!last) return; // belum pernah kirim → tunggu jadwal 08:00 pertama
    if (localHour() < REPORT_HOUR) return;
    if (last >= yesterdayKey()) return;
    log("pnl_report", `Laporan terlewat (terakhir untuk ${last}) — mengirim sekarang`);
    await runPnlReport({});
  } catch (e) {
    log("pnl_report_error", `Catch-up laporan PnL gagal: ${e.message}`);
  }
}

// ───────────── CLI: node pnl-report.js preview [YYYY-MM-DD] | send [YYYY-MM-DD] ─────────────
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [cmd, k] = process.argv.slice(2);
  if (!["preview", "send"].includes(cmd)) {
    console.log("Pemakaian:\n  node pnl-report.js preview [YYYY-MM-DD]   # simpan gambar ke ./pnl-preview (tidak kirim)\n  node pnl-report.js send [YYYY-MM-DD]      # kirim ke Telegram sekarang");
    process.exit(0);
  }
  if (cmd === "send") await import("dotenv/config");
  const res = await runPnlReport({ key: k || yesterdayKey(), send: cmd === "send", outDir: cmd === "preview" ? repoPath("pnl-preview") : null });
  console.log(JSON.stringify({ daily: { ...res.daily, items: undefined }, month_total_sol: res.month.total_sol }, null, 2));
  if (cmd === "preview") console.log("Gambar disimpan di ./pnl-preview");
}
