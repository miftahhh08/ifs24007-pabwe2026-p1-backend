import { checkSafety, EMERGENCY_REPLY, DOSAGE_REPLY } from "./safety.js";
import { aiEnabled, askAI } from "./ai.js";
import { searchFoods } from "./foods.js";

const RULES = [
  // 1. Sapaan Ramah
  [
    /^(halo|hai|hi|hey|hei|assalamu|selamat pagi|selamat siang|selamat sore|selamat malam|pagi|siang|sore|malam)/,
    "Halo! Aku Sobat Gula, asisten edukasi kesehatanmu. Tanyakan apa saja seputar batas gula harian, takaran gula makanan/minuman, tips pencegahan diabetes, atau arti hasil tes gula darahmu. Ada yang ingin kamu ketahui hari ini?",
  ],
  // 2. Batas Gula Harian (Permenkes 30/2013)
  [
    /gula.*(batas|sehari|maksimal|jatah|rekomendasi)|batas.*gula|berapa.*gula.*sehari/,
    "Anjuran resmi Kementerian Kesehatan RI (Permenkes No. 30/2013): Batas konsumsi gula tambahan maksimal adalah 50 gram (setara 4 sendok makan) per orang per hari untuk menjaga kadar glukosa tetap stabil dan mencegah risiko diabetes.",
  ],
  // 3. Gejala & Tanda Diabetes
  [
    /(gejala|tanda|ciri).*diabetes|diabetes.*(gejala|tanda|ciri)/,
    "Gejala klasik diabetes (Trias 3P): 1. Poliuria (sering buang air kecil, terutama malam hari), 2. Polidipsia (sering merasa sangat haus), 3. Polifagia (mudah lapar namun berat badan justru turun). Gejala lainnya: luka sulit sembuh, kesemutan di kaki, dan mudah lelah. Segera periksakan diri ke puskesmas/dokter untuk tes laboratorium jika mengalami gejala ini.",
  ],
  // 4. Minuman Manis & Bahayanya
  [
    /(minuman|teh|soda|kopi|boba|jus).*(manis|gula|bahaya)|manis.*bahaya|efek.*manis/,
    "Minuman manis (seperti boba, kopi susu gula aren, es teh manis, soda) merupakan penyumbang gula cair terbesar. Gula cair diserap sangat cepat oleh tubuh sehingga memicu lonjakan insulin mendadak. Disarankan memilih opsi 'less sugar' (sedikit gula), beralih ke air putih, atau memilih ukuran gelas yang lebih kecil.",
  ],
  // 5. Pemanis Alternatif / Nol Kalori
  [
    /pemanis|stevia|sukralosa|eritritol|pemanis buatan|pengganti gula/,
    "Pemanis rendah/nol kalori yang aman menurut BPOM antara lain Stevia (alami dari daun), Sukralosa, dan Eritritol. Pemanis ini tidak menaikkan kadar gula darah secara signifikan, namun biasakan melatih lidah agar tidak terus bergantung pada rasa manis berlebih.",
  ],
  // 6. Olahraga & Aktivitas Fisik
  [
    /olahraga|aktivitas|bergerak|jalan kaki|senam/,
    "Kemenkes dan PERKENI menganjurkan aktivitas fisik intensitas sedang minimal 150 menit per minggu (misalnya jalan cepat atau senam 30 menit per hari, 5 kali seminggu). Olahraga teratur membantu sel otot menyerap glukosa darah tanpa membebani pankreas.",
  ],
  // 7. Cara Pencegahan Diabetes
  [
    /cegah|mencegah|hindari|tips.*sehat|cara.*cegah/,
    "Langkah utama pencegahan diabetes tipe 2: 1. Batasi gula tambahan maksimal 50 g/hari, 2. Terapkan pola 'Isi Piringku' (perbanyak sayur dan serat), 3. Rutin berolahraga 150 menit/minggu, 4. Jaga berat badan ideal, 5. Hindari merokok dan lakukan cek gula darah secara berkala.",
  ],
  // 8. Tes & Nilai Normal Gula Darah (PERKENI)
  [
    /(kadar|nilai|angka|cek|tes).*gula darah|gula darah.*normal/,
    "Pedoman PERKENI untuk kadar glukosa darah: 1. Gula darah puasa (puasa ≥8 jam): Normal <100 mg/dL, Prediabetes 100–125 mg/dL, Diabetes ≥126 mg/dL. 2. Gula darah 2 jam setelah makan / sewaktu: Normal <140 mg/dL, Prediabetes 140–199 mg/dL, Diabetes ≥200 mg/dL.",
  ],
  // 9. Buah & Pola Makan Sehat
  [
    /buah|makanan sehat|camilan sehat|sayur/,
    "Buah segar utuh (seperti apel, pir, jeruk, alpukat) sangat baik karena mengandung serat pangan yang memperlambat penyerapan gula. Hindari jus buah kemasan atau buah kaleng yang biasanya ditambahkan sirup gula pekat.",
  ],
];

const FALLBACK =
  "Aku Sobat Gula, pendamping edukasi kesehatanmu. Kamu bisa menanyakan batas gula harian, takaran gula makanan/minuman (misal: donat, kopi susu, es teh), tips olahraga, atau pencegahan diabetes. Ada yang ingin kamu diskusikan?";

export async function reply(message) {
  const safety = checkSafety(message);
  if (safety === "emergency") return { reply: EMERGENCY_REPLY, mode: "safety" };
  if (safety === "dosage") return { reply: DOSAGE_REPLY, mode: "safety" };
  if (aiEnabled()) {
    try {
      return { reply: await askAI(message), mode: "ai" };
    } catch {
      /* jatuh ke aturan lokal bila AI gagal */
    }
  }

  const text = String(message).toLowerCase();

  // 1. Cek aturan edukasi terstruktur
  const hit = RULES.find(([re]) => re.test(text));
  if (hit) return { reply: hit[1], mode: "rules" };

  // 2. Cek apakah pengguna menanyakan makanan tertentu di basis data
  const words = text
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const stopWords = ["berapa", "kandungan", "makanan", "minuman", "apakah", "dalam", "untuk", "sehari", "adalah", "tentang", "makan"];
  for (const w of words) {
    if (stopWords.includes(w)) continue;
    const found = searchFoods(w);
    if (found.length > 0) {
      const f = found[0];
      const indicator = f.light === "hijau" ? "RENDAH (Aman)" : f.light === "kuning" ? "SEDANG (Batasi)" : "TINGGI (Hati-hati)";
      return {
        reply: `Berdasarkan basis data gizi GulaSadar: ${f.name} takaran ${f.portion} mengandung sekitar ${f.sugar_g} gram gula dan ${f.carbs_g} gram karbohidrat (Indikator: ${indicator}). Kamu bisa langsung mencatatnya di menu 'Pindai Makanan' untuk memantau sisa jatah gulamu hari ini.`,
        mode: "rules",
      };
    }
  }

  return { reply: FALLBACK, mode: "rules" };
}
