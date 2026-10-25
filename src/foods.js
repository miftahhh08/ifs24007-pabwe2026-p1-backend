import { all, get, initDb } from "./db.js";

export const DAILY_LIMIT_G = 50; // anjuran maksimal gula per hari (Kemenkes)

// Estimasi awal. Verifikasi dengan TKPI atau label produk sebelum dikumpulkan.
const SEED = [
  ["es-teh-manis", "Es teh manis", "1 gelas (250 ml)", 20, 21, "minuman", "teh manis dingin,es teh"],
  ["teh-botol", "Teh kemasan botol", "1 botol (350 ml)", 24, 24, "minuman", "teh botol"],
  ["kopi-susu-gula-aren", "Kopi susu gula aren", "1 gelas (250 ml)", 18, 20, "minuman", "kopi susu"],
  ["soda", "Minuman soda", "1 kaleng (330 ml)", 35, 35, "minuman", "cola,minuman bersoda"],
  ["air-putih", "Air putih", "1 gelas (250 ml)", 0, 0, "minuman", "air mineral"],
  ["nasi-putih", "Nasi putih", "1 piring (150 g)", 0, 40, "makanan pokok", "nasi"],
  ["gorengan-pisang", "Pisang goreng", "2 potong", 12, 35, "jajanan", "pisang goreng"],
  ["martabak-manis", "Martabak manis", "1 potong", 20, 40, "jajanan", "terang bulan"],
  ["roti-coklat", "Roti isi coklat", "1 buah", 14, 30, "jajanan", "roti manis"],
  ["bakso", "Bakso", "1 mangkuk", 3, 35, "makanan berat", "mie bakso"],
  ["nasi-goreng", "Nasi goreng", "1 piring", 4, 55, "makanan berat", "nasgor"],
  ["mie-instan", "Mi instan goreng", "1 bungkus", 5, 50, "makanan berat", "indomie,mie goreng"],
  ["es-krim", "Es krim", "1 cup (100 g)", 21, 24, "jajanan", "ice cream"],
  ["jus-jeruk-kemasan", "Jus jeruk kemasan", "1 kotak (250 ml)", 25, 26, "minuman", "jus jeruk"],
  ["apel", "Apel", "1 buah sedang", 14, 25, "buah", "buah apel"],
  ["teh-tawar", "Teh tawar", "1 gelas (250 ml)", 0, 0, "minuman", "teh pahit"],
  ["kopi-hitam", "Kopi hitam tanpa gula", "1 cangkir (150 ml)", 0, 0, "minuman", "kopi pahit"],
  ["boba-milk-tea", "Boba milk tea", "1 gelas (500 ml)", 38, 60, "minuman", "boba,bubble tea"],
  ["susu-kental-manis", "Susu kental manis", "1 sachet (40 g)", 22, 23, "minuman", "skm"],
  ["es-cendol", "Es cendol", "1 mangkuk", 28, 45, "jajanan", "cendol,dawet"],
  ["donat-glaze", "Donat glaze", "1 buah", 14, 28, "jajanan", "donat,donut"],
  ["coklat-batang", "Coklat batang", "1 batang (40 g)", 20, 24, "jajanan", "cokelat,chocolate"],
  ["yogurt-manis", "Yogurt manis", "1 cup (150 g)", 17, 20, "minuman", "yoghurt"],
  ["pisang", "Pisang", "1 buah sedang", 14, 27, "buah", "buah pisang"],
  ["semangka", "Semangka", "1 potong (200 g)", 10, 15, "buah", "melon"],
  ["bubur-ayam", "Bubur ayam", "1 mangkuk", 2, 40, "makanan berat", "bubur"],
  ["soto-ayam", "Soto ayam", "1 mangkuk", 3, 30, "makanan berat", "soto"],
  ["gado-gado", "Gado-gado", "1 piring", 8, 30, "makanan berat", "pecel,lotek"],
];

/** Perintah SQL untuk mengisi data makanan (INSERT OR IGNORE, aman dijalankan berulang). */
export const seedStatements = () =>
  SEED.map((args) => ({
    sql: "INSERT OR IGNORE INTO foods (id,name,portion,sugar_g,carbs_g,category,aliases) VALUES (?,?,?,?,?,?,?)",
    args,
  }));

// Indikator lampu lalu lintas (edukasi, bukan penilaian medis)
export function trafficLight(sugarG) {
  if (sugarG <= 5) return "hijau";
  if (sugarG <= 15) return "kuning";
  return "merah";
}

export async function searchFoods(q = "") {
  await initDb(seedStatements());
  const like = `%${q.trim().toLowerCase()}%`;
  const rows = await all(
    `SELECT * FROM foods
     WHERE lower(name) LIKE ?1 OR lower(aliases) LIKE ?1
     ORDER BY name LIMIT 50`,
    [like]
  );
  return rows.map((f) => ({ ...f, light: trafficLight(f.sugar_g) }));
}

export async function getFood(id) {
  await initDb(seedStatements());
  const f = await get("SELECT * FROM foods WHERE id = ?", [id]);
  return f ? { ...f, light: trafficLight(f.sugar_g) } : null;
}

export async function allFoodIds() {
  await initDb(seedStatements());
  return (await all("SELECT id FROM foods ORDER BY id")).map((r) => r.id);
}

/** Hitung gula dari label kemasan. */
export function calcLabel({ sugarPerServingG, servingsPerPack = 1, consumedServings = 1 } = {}) {
  const a = Number(sugarPerServingG), b = Number(servingsPerPack), c = Number(consumedServings);
  if (![a, b, c].every(Number.isFinite) || a < 0 || a > 500 || b <= 0 || b > 100 || c <= 0 || c > 100)
    return null;
  const total = Math.round(a * c * 10) / 10;
  return {
    total_sugar_g: total,
    pack_sugar_g: Math.round(a * b * 10) / 10,
    spoons: Math.round((total / 12.5) * 10) / 10, // 1 sdm gula ≈ 12,5 g
    percent_of_limit: Math.round((total / DAILY_LIMIT_G) * 100),
    light: trafficLight(total),
  };
}
