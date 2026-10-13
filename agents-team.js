// Tim 3 agent kantor untuk LP. Ubah nama/jabatan di sini kalau mau.
// Dipakai Mini App "Kantor LP" untuk menampilkan 3 agent.
export const TEAM = {
  SCOUT: {
    key: "SCOUT",
    name: "Rara",
    title: "Riset Pool",
    emoji: "🔎",
    tugas: "Cari & seleksi pool, hitung range, deploy posisi baru",
  },
  POSISI: {
    key: "POSISI",
    name: "Bima",
    title: "Manajer Posisi",
    emoji: "🛡️",
    tugas: "Pantau posisi, claim fee, tutup/ganti posisi, alert out-of-range",
  },
  LAPORAN: {
    key: "LAPORAN",
    name: "Sari",
    title: "Admin & Laporan",
    emoji: "📊",
    tugas: "Briefing harian, jawab chat kamu, rangkum PnL & pelajaran",
  },
};

export function teamText() {
  return Object.values(TEAM)
    .map((a) => `${a.emoji} ${a.name} — ${a.title}: ${a.tugas}`)
    .join("\n");
}
