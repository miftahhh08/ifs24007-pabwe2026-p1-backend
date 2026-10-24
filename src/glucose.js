// Klasifikasi gula darah edukatif (mg/dL). Bukan interpretasi medis.
export const CONTEXTS = ["puasa", "sesudah_makan", "sewaktu"];

export function validateGlucose({ value, context } = {}) {
  const v = Number(value);
  if (!Number.isFinite(v) || v < 20 || v > 600) return "Nilai gula darah harus 20-600 mg/dL";
  if (!CONTEXTS.includes(context)) return "Konteks harus puasa, sesudah_makan, atau sewaktu";
  return null;
}

export function classifyGlucose(value, context) {
  if (value < 70) return { category: "rendah", note: "Di bawah rentang normal. Jika gejala muncul, segera cari bantuan medis." };
  if (context === "puasa") {
    if (value < 100) return { category: "normal", note: "Dalam rentang normal untuk puasa." };
    if (value < 126) return { category: "waspada", note: "Di atas normal untuk puasa. Konsultasikan ke tenaga kesehatan." };
    return { category: "tinggi", note: "Tinggi untuk puasa. Segera periksa ke dokter." };
  }
  if (context === "sesudah_makan") {
    if (value < 140) return { category: "normal", note: "Dalam rentang normal setelah makan." };
    if (value < 200) return { category: "waspada", note: "Agak tinggi setelah makan. Konsultasikan ke tenaga kesehatan." };
    return { category: "tinggi", note: "Tinggi setelah makan. Segera periksa ke dokter." };
  }
  if (value < 140) return { category: "normal", note: "Dalam rentang normal." };
  if (value < 200) return { category: "waspada", note: "Agak tinggi. Konsultasikan ke tenaga kesehatan." };
  return { category: "tinggi", note: "Tinggi. Segera periksa ke dokter." };
}
