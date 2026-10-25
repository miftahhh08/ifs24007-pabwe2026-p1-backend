import { get, TODAY } from "./db.js";
import { checkSafety, EMERGENCY_REPLY, DOSAGE_REPLY } from "./safety.js";
import { aiEnabled, askAI, aiProvider } from "./ai.js";
import { searchFoods, DAILY_LIMIT_G } from "./foods.js";

export const SUGGESTIONS = [
  "Berapa batas gula sehari?",
  "Berapa gula di es teh manis?",
  "Ringkasan gulaku hari ini",
  "Apa gejala diabetes?",
  "Tips mengurangi minuman manis",
  "Apa itu lampu lalu lintas?",
];

// Basis pengetahuan edukasi: [pola, jawaban]. Urutan = prioritas.
const KB = [
  [/(gejala|tanda|ciri).*(diabetes|gula darah)|diabetes.*(gejala|tanda|ciri)/,
    "Gejala umum diabetes: sering haus, sering buang air kecil (terutama malam), mudah lelah, lapar berlebihan, penglihatan kabur, dan luka sulit sembuh. Gejala bisa tidak muncul di awal, jadi pemeriksaan gula darah berkala penting. Untuk kepastian, periksakan ke dokter."],
  [/(tipe 1|tipe 2|beda.*diabetes|jenis diabetes)/,
    "Diabetes tipe 1 terjadi ketika tubuh hampir tidak memproduksi insulin (sering muncul sejak muda). Diabetes tipe 2 lebih umum: tubuh kurang peka terhadap insulin, dan sangat dipengaruhi berat badan, pola makan, serta aktivitas. Tipe 2 sering bisa dicegah atau ditunda lewat gaya hidup sehat."],
  [/(lampu lalu lintas|hijau|kuning|merah|indikator|warna)/,
    "Indikator di GulaSadar: HIJAU = gula rendah (sampai 5 g per porsi), KUNING = sedang (6-15 g), MERAH = tinggi (di atas 15 g). Ini bantuan edukasi untuk memilih dengan lebih sadar, bukan penilaian medis."],
  [/(batas|maksimal|jatah|anjuran|sehari).*(gula)|gula.*(batas|maksimal|sehari|jatah)/,
    "Anjuran Kemenkes: konsumsi gula tambahan maksimal 50 g per hari, sekitar 4 sendok makan. Itu sudah termasuk gula di minuman manis dan makanan kemasan, bukan hanya gula yang kamu tambahkan sendiri."],
  [/(kurangi|mengurangi|turunkan|tips|cara).*(manis|gula)|(manis|gula).*(kurangi|mengurangi|tips)/,
    "Tips praktis: 1) minta less sugar atau tanpa gula saat membeli minuman, 2) ganti minuman manis dengan air putih atau teh tawar, 3) pilih buah utuh daripada jus kemasan, 4) baca label dan cek 'gula' per sajian, 5) kurangi bertahap supaya lidah terbiasa, misalnya turunkan satu sendok tiap minggu."],
  [/(label|kemasan|informasi nilai gizi|sajian)/,
    "Di label kemasan, lihat baris 'Gula' per sajian lalu kalikan dengan jumlah sajian yang kamu habiskan. Banyak kemasan berisi lebih dari satu sajian. Gunakan menu Label di GulaSadar untuk menghitungnya otomatis."],
  [/(pemanis|stevia|aspartam|sukralosa|gula merah|gula aren|madu)/,
    "Gula merah, gula aren, dan madu tetap dihitung sebagai gula tambahan walau terasa lebih alami. Pemanis buatan tidak menambah gula, tetapi sebaiknya tidak berlebihan; bicarakan dengan tenaga kesehatan bila kamu punya kondisi tertentu."],
  [/(olahraga|aktivitas|bergerak|jalan kaki|latihan)/,
    "Usahakan aktivitas fisik intensitas sedang sekitar 150 menit per minggu, misalnya jalan cepat 30 menit, 5 hari seminggu. Bergerak membantu tubuh memakai gula darah lebih baik. Mulai dari yang ringan dan tingkatkan perlahan."],
  [/(cegah|mencegah|pencegahan|hindari|terhindar)/,
    "Langkah pencegahan diabetes tipe 2: jaga berat badan ideal, batasi gula tambahan dan minuman manis, perbanyak sayur dan serat, aktif bergerak, cukup tidur, tidak merokok, serta periksa gula darah berkala bila berisiko. Ini mengurangi risiko tetapi tidak menjamin."],
  [/(riwayat keluarga|keturunan|genetik|turunan)/,
    "Riwayat keluarga diabetes memang menambah risiko, tetapi bukan takdir. Gaya hidup sehat bisa menurunkan risiko secara berarti. Coba menu Risiko di GulaSadar untuk skrining edukatif, dan konsultasikan ke dokter untuk pemeriksaan."],
  [/(gula darah|glukosa).*(normal|rentang|angka|berapa)|normal.*gula darah/,
    "Sebagai gambaran edukatif (mg/dL): puasa normal di bawah 100, 100-125 perlu waspada, 126 ke atas tinggi. Dua jam sesudah makan normal di bawah 140. Diagnosis hanya bisa ditegakkan dokter lewat pemeriksaan laboratorium."],
  [/(sayur|serat|buah|makan sehat|menu sehat|piring)/,
    "Prinsip piring sehat: setengah piring sayur dan buah, seperempat protein (ikan, tempe, telur), seperempat karbohidrat (nasi, umbi) dengan porsi wajar. Pilih karbohidrat tinggi serat bila bisa."],
  [/(terima kasih|makasih|thanks)/, "Sama-sama! Kalau ada pertanyaan lain soal gula atau kebiasaan sehat, tanya saja ya."],
  [/^(halo|hai|hi|hello|selamat (pagi|siang|sore|malam))\b/,
    "Halo! Aku Sobat Gula. Aku bisa cek kandungan gula makanan, merangkum gulamu hari ini, dan menjawab pertanyaan edukasi diabetes. Coba salah satu pertanyaan di bawah."],
];

const FALLBACK =
  "Maaf, aku belum punya jawaban untuk itu. Aku bisa membantu soal: kandungan gula makanan (contoh: \"gula di bakso\"), batas gula harian, tips mengurangi gula, gejala dan pencegahan diabetes, serta ringkasan gulamu hari ini. Untuk kondisi pribadi, konsultasikan ke tenaga kesehatan.";

async function todaySummary() {
  const row = await get(
    `SELECT COALESCE(SUM(sugar_g),0) AS total, COUNT(*) AS n FROM food_logs WHERE date(eaten_at)=${TODAY}`
  );
  const total = Math.round(row.total * 10) / 10;
  if (row.n === 0)
    return "Hari ini kamu belum mencatat makanan apa pun. Buka menu Cari Makanan untuk mulai mencatat, lalu aku bisa merangkumnya.";
  const left = Math.round((DAILY_LIMIT_G - total) * 10) / 10;
  const status = left >= 0 ? `Sisa jatahmu sekitar ${left} g.` : `Kamu sudah melewati acuan ${Math.abs(left)} g. Coba pilih minuman tanpa gula untuk sisa hari ini.`;
  return `Hari ini kamu mencatat ${row.n} item dengan total sekitar ${total} g gula dari acuan ${DAILY_LIMIT_G} g. ${status}`;
}

const LIGHT = { hijau: "rendah", kuning: "sedang", merah: "tinggi" };

async function foodAnswer(text) {
  const hits = (await searchFoods(""))
    .map((f) => {
      const names = [f.name, ...String(f.aliases ?? "").split(",")].map((n) => n.trim().toLowerCase()).filter(Boolean);
      const best = names.filter((n) => text.includes(n)).sort((a, b) => b.length - a.length)[0];
      return best ? { f, len: best.length } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.len - a.len);
  if (hits.length === 0) return null;
  const { f } = hits[0];
  const spoons = Math.round((f.sugar_g / 12.5) * 10) / 10;
  const pct = Math.round((f.sugar_g / DAILY_LIMIT_G) * 100);
  if (f.sugar_g === 0)
    return `${f.name} (${f.portion}) hampir tidak mengandung gula tambahan, jadi indikatornya hijau. Pilihan yang baik! Ingat, tetap perhatikan porsi dan campuran lainnya.`;
  return `${f.name} (${f.portion}) kira-kira mengandung ${f.sugar_g} g gula, setara ${spoons} sendok makan atau ${pct}% dari batas harian. Kategori gula ${LIGHT[f.light]} (${f.light}). Ini estimasi; cek label atau tanyakan penjualnya untuk angka pasti.`;
}

export async function localReply(message) {
  const text = String(message).toLowerCase().trim();
  if (/(hari ini|sudah berapa|total gula|ringkasan|rekap|sisa).*(gula|jatah|catat)|(gula|jatah).*(hari ini|ringkasan|rekap|sisa)/.test(text))
    return todaySummary();
  const food = await foodAnswer(text);
  const hit = KB.find(([re]) => re.test(text));
  if (food && !(hit && /(batas|anjuran)/.test(text))) return food;
  return hit ? hit[1] : FALLBACK;
}

export async function reply(message) {
  const safety = checkSafety(message);
  if (safety === "emergency") return { reply: EMERGENCY_REPLY, mode: "safety", suggestions: [] };
  if (safety === "dosage") return { reply: DOSAGE_REPLY, mode: "safety", suggestions: SUGGESTIONS.slice(0, 3) };
  if (aiEnabled()) {
    try {
      return { reply: await askAI(message, await todaySummary()), mode: "ai", suggestions: SUGGESTIONS.slice(0, 3) };
    } catch { /* jatuh ke aturan lokal */ }
  }
  return { reply: await localReply(message), mode: "rules", suggestions: SUGGESTIONS.slice(0, 3) };
}

export function chatStatus() {
  const provider = aiProvider();
  return { mode: provider ? "ai" : "rules", provider, suggestions: SUGGESTIONS };
}
