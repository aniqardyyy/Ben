#!/usr/bin/env node
/**
 * Pasang fitur Laporan PnL (harian + kalender bulanan) ke proyek yang SUDAH berjalan, tanpa menimpa file kamu.
 * Mengedit 4 file lewat penanda teks (aman diulang; kalau penanda tidak ketemu, file itu dilewati & dilaporkan).
 * Backup otomatis: <file>.bak-pnl
 *
 * Jalankan dari folder agentlp:  node install-pnl-report.mjs
 */
import fs from "fs";

const edits = [
  {
    file: "telegram.js",
    done: "export async function sendReportPhoto(",
    find: "export async function editMessage(text, messageId) {",
    replace: (m) => `// Kirim foto laporan (Daily PnL / Kalender PnL). TIDAK terblokir mode senyap (TELEGRAM_SILENT).
// Chat tujuan: chatId terdaftar, kalau belum ada pakai ID user pertama di TELEGRAM_ALLOWED_USER_IDS.
export async function sendReportPhoto(buffer, caption = "") {
  const target = chatId || [...ALLOWED_USER_IDS][0] || null;
  if (!TOKEN || !target) {
    log("telegram_error", "sendReportPhoto: TELEGRAM_BOT_TOKEN atau chat tujuan belum diisi (TELEGRAM_CHAT_ID / TELEGRAM_ALLOWED_USER_IDS)");
    return false;
  }
  try {
    const form = new FormData();
    form.append("chat_id", String(target));
    form.append("photo", new Blob([buffer], { type: "image/jpeg" }), "pnl.jpg");
    if (caption) {
      form.append("caption", String(caption).slice(0, 1024));
      form.append("parse_mode", "HTML");
    }
    const res = await fetch(\`\${BASE}/sendPhoto\`, { method: "POST", body: form });
    if (!res.ok) {
      log("telegram_error", \`sendPhoto \${res.status}: \${(await res.text()).slice(0, 200)}\`);
      return false;
    }
    return true;
  } catch (e) {
    log("telegram_error", \`sendPhoto failed: \${e.message}\`);
    return false;
  }
}

` + m,
  },
  {
    file: "lessons.js",
    done: "recordClosedPnl",
    find: "  save(data);\n  if (lesson) {\n    void pushHiveLesson(lesson);\n  }\n",
    replace: (m) => m + `
  // Catat PnL posisi yang ditutup ke ledger laporan harian/bulanan (tidak boleh mengganggu alur utama).
  try {
    const { recordClosedPnl } = await import("./pnl-report.js");
    await recordClosedPnl(entry);
  } catch (e) {
    log("lessons_warn", \`Gagal mencatat ke ledger PnL: \${e.message}\`);
  }
`,
  },
  {
    file: "index.js",
    done: "runScheduledPnlReport",
    find: 'import { generateBriefing } from "./briefing.js";',
    replace: (m) => m + '\nimport { runScheduledPnlReport, maybeRunMissedPnlReport, runPnlReport, REPORT_TZ, REPORT_HOUR } from "./pnl-report.js";',
  },
  {
    file: "index.js",
    done: "pnlReportTask",
    find: "  // Fast PnL poller",
    replace: (m) => `  // Laporan PnL harian + kalender bulanan (gambar) — default jam 08:00 WIB. Matikan: PNL_REPORT_ENABLED=false
  const pnlReportOn = String(process.env.PNL_REPORT_ENABLED ?? "true").toLowerCase() !== "false";
  const pnlReportTask = pnlReportOn
    ? cron.schedule(\`0 \${REPORT_HOUR} * * *\`, () => { runScheduledPnlReport(); }, { timezone: REPORT_TZ })
    : null;
  const pnlReportWatchdog = pnlReportOn
    ? cron.schedule(\`15 */3 * * *\`, () => { maybeRunMissedPnlReport(); }, { timezone: REPORT_TZ })
    : null;

` + m,
  },
  {
    file: "index.js",
    done: "pnlReportWatchdog].filter",
    find: "_cronTasks = [mgmtTask, screenTask, healthTask, briefingTask, briefingWatchdog];",
    replace: () => "_cronTasks = [mgmtTask, screenTask, healthTask, briefingTask, briefingWatchdog, pnlReportTask, pnlReportWatchdog].filter(Boolean);",
  },
  {
    file: "index.js",
    done: 'text === "/pnl"',
    find: '  if (text === "/tim" || text === "/team") {',
    replace: (m) => `  if (text === "/pnl" || text.startsWith("/pnl ")) {
    // /pnl → kirim laporan kemarin sekarang juga; /pnl 2026-10-10 → tanggal tertentu
    const arg = text.split(/\\s+/)[1];
    if (arg && !/^\\d{4}-\\d{2}-\\d{2}$/.test(arg)) {
      await sendMessage("Format: /pnl atau /pnl YYYY-MM-DD").catch(() => {});
      return;
    }
    try {
      await runPnlReport(arg ? { key: arg } : {});
    } catch (e) {
      await sendMessage(\`Error: \${e.message}\`).catch(() => {});
    }
    return;
  }

` + m,
  },
  {
    file: ".gitignore",
    done: "pnl-ledger.json",
    find: "signal-weights.json\n",
    replace: (m) => m + "pnl-ledger.json\npnl-preview/\n",
  },
];

const cache = {};
let failed = 0;
for (const e of edits) {
  if (!fs.existsSync(e.file)) { console.log(`✗ ${e.file}: file tidak ada (jalankan dari folder agentlp)`); failed++; continue; }
  cache[e.file] ??= fs.readFileSync(e.file, "utf8");
  let s = cache[e.file];
  if (s.includes(e.done)) { console.log(`• ${e.file}: sudah terpasang (${e.done.slice(0, 40)})`); continue; }
  const n = s.split(e.find).length - 1;
  if (n !== 1) { console.log(`✗ ${e.file}: penanda "${e.find.slice(0, 50).trim()}" ditemukan ${n}x (harus 1x) — bagian ini DILEWATI, kabari saya`); failed++; continue; }
  cache[e.file] = s.replace(e.find, e.replace(e.find));
  console.log(`✓ ${e.file}: ditambah (${e.done.slice(0, 40)})`);
}
for (const [f, content] of Object.entries(cache)) {
  if (content !== fs.readFileSync(f, "utf8")) {
    if (!fs.existsSync(f + ".bak-pnl")) fs.copyFileSync(f, f + ".bak-pnl");
    fs.writeFileSync(f, content);
  }
}
console.log(failed ? `\nSelesai dengan ${failed} peringatan di atas.` : "\nSelesai. Lanjut: pip install pillow, lalu restart agent.");
process.exit(failed ? 1 : 0);
