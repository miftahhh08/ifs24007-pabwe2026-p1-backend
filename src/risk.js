// Skrining risiko diabetes tipe 2 (edukatif, diadaptasi dari FINDRISC). Bukan diagnosis.
export const MIN_AGE = 18;

export function validateRisk(b = {}) {
  const age = Number(b.age), h = Number(b.heightCm), w = Number(b.weightKg), waist = Number(b.waistCm);
  if (!Number.isFinite(age) || age < MIN_AGE || age > 120) return `Umur harus ${MIN_AGE}-120 tahun`;
  if (!Number.isFinite(h) || h < 100 || h > 250) return "Tinggi badan harus 100-250 cm";
  if (!Number.isFinite(w) || w < 20 || w > 300) return "Berat badan harus 20-300 kg";
  if (!Number.isFinite(waist) || waist < 40 || waist > 200) return "Lingkar pinggang harus 40-200 cm";
  if (!["pria", "wanita"].includes(b.sex)) return "Jenis kelamin harus pria atau wanita";
  if (!["tidak", "kerabat", "orangtua"].includes(b.familyHistory ?? "tidak"))
    return "Riwayat keluarga tidak valid";
  return null;
}

export function bmi(heightCm, weightKg) {
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

export function assessRisk(b) {
  const bmiVal = bmi(Number(b.heightCm), Number(b.weightKg));
  const age = Number(b.age), waist = Number(b.waistCm);
  let score = 0;
  score += age < 45 ? 0 : age < 55 ? 2 : age < 65 ? 3 : 4;
  score += bmiVal < 25 ? 0 : bmiVal < 30 ? 1 : 3;
  const [lo, hi] = b.sex === "pria" ? [94, 102] : [80, 88];
  score += waist < lo ? 0 : waist <= hi ? 3 : 4;
  if (!b.active) score += 2;
  if (!b.dailyVegetables) score += 1;
  if (b.bpMedication) score += 2;
  if (b.highGlucoseHistory) score += 5;
  score += b.familyHistory === "orangtua" ? 5 : b.familyHistory === "kerabat" ? 3 : 0;

  const level = score < 7 ? "rendah" : score < 12 ? "sedang" : score < 15 ? "tinggi" : "sangat tinggi";
  const advice = {
    rendah: "Pertahankan pola makan seimbang dan aktivitas fisik rutin.",
    sedang: "Kurangi minuman manis, perbanyak aktivitas, dan pertimbangkan cek gula darah berkala.",
    tinggi: "Disarankan memeriksakan gula darah ke fasilitas kesehatan dan memperbaiki pola hidup.",
    "sangat tinggi": "Segera konsultasikan ke dokter untuk pemeriksaan gula darah.",
  }[level];
  return { score, level, bmi: bmiVal, advice, disclaimer: "Hasil ini edukatif dan bukan diagnosis." };
}
