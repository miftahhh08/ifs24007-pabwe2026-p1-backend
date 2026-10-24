// Pemeriksaan keselamatan chatbot kesehatan (edukasi, bukan diagnosis).
const EMERGENCY = [
  /pingsan/, /tidak sadar/, /kejang/, /sesak (napas|nafas)/, /nyeri dada/,
  /bunuh diri/, /ingin mati/, /mengakhiri hidup/, /gula darah.*(sangat|terlalu) (rendah|tinggi)/,
  /hipoglikemia berat/, /koma/,
];
const DOSAGE = [
  /dosis/, /(ubah|ganti|naikkan|turunkan|kurangi|tambah|hentikan|stop|lewatkan).{0,25}(insulin|obat|metformin)/,
  /(insulin|obat|metformin).{0,25}(berapa|unit|mg|dosis)/, /berapa unit/,
];

export const EMERGENCY_REPLY =
  "Ini terdengar seperti kondisi darurat. Segera hubungi layanan gawat darurat (119) atau pergi ke IGD terdekat, dan minta bantuan orang di sekitarmu. Sobat Gula tidak dapat menangani keadaan darurat.";
export const DOSAGE_REPLY =
  "Aku tidak dapat memberi atau mengubah dosis obat maupun insulin. Hal itu harus ditentukan dokter atau apoteker sesuai kondisimu. Silakan hubungi tenaga kesehatan yang menanganimu.";

/** Mengembalikan "emergency", "dosage", atau "ok". */
export function checkSafety(message) {
  const text = String(message ?? "").toLowerCase();
  if (EMERGENCY.some((r) => r.test(text))) return "emergency";
  if (DOSAGE.some((r) => r.test(text))) return "dosage";
  return "ok";
}
