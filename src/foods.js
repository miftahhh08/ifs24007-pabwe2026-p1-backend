import db from "./db.js";

export const DAILY_LIMIT_G = 50; // anjuran maksimal gula per hari (Kemenkes)

// Estimasi awal. Verifikasi dengan TKPI atau label produk sebelum dikumpulkan.
const SEED = [
  ["es-teh-manis", "Es teh manis", "1 gelas (250 ml)", 20, 21, "minuman", "teh manis dingin,es teh"],
  ["teh-botol", "Teh kemasan botol", "1 botol (350 ml)", 24, 24, "minuman", "teh botol"],
  ["kopi-susu-gula-aren", "Kopi Susu Gula Aren (Point Coffee / Kopi Kenangan)", "1 gelas (250 ml)", 18, 20, "minuman", "kopi susu,point coffee,kopi point,point,kopi,latte,aren,coffee"],
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
  ["ciki-chitato", "Keripik Kentang Chitato", "1 bungkus (68 g)", 2, 38, "snack kemasan", "ciki,chitato,keripik kentang"],
  ["ciki-taro", "Taro Net Seaweed", "1 bungkus (65 g)", 2, 42, "snack kemasan", "taro,ciki taro,snack"],
  ["biskuit-oreo", "Biskuit Oreo Krim Vanila", "3 keping (28.5 g)", 12, 20, "snack kemasan", "oreo,biskuit"],
  ["wafer-tango", "Wafer Tango Cokelat", "1 bungkus (47 g)", 14, 30, "snack kemasan", "wafer,tango,wafer coklat"],
  ["cokelat-silverqueen", "Cokelat SilverQueen Cashew", "1 batang (58 g)", 28, 32, "snack kemasan", "silverqueen,cokelat"],
  ["biskuit-roma", "Biskuit Roma Kelapa", "3 keping (27 g)", 6, 19, "snack kemasan", "roma,roma kelapa,biskuit"],
  ["susu-uht-cokelat", "Susu UHT Cokelat", "1 kotak (200 ml)", 18, 24, "minuman", "susu ultra,susu coklat,uht"],
  ["boba-milk-tea", "Boba Brown Sugar Milk Tea", "1 gelas (450 ml)", 42, 58, "minuman", "boba,bubble tea,brown sugar"],
  ["donat", "Donat Gula / Cokelat", "1 buah (60 g)", 12, 28, "jajanan", "donat,doughnut,donut,donat cokelat,donat gula"],
  ["permen-lolipop", "Permen Lolipop / Permen Manis", "1 buah (15 g)", 12, 14, "jajanan", "lolipop,lollipop,permen,candy,permen lolipop,permen gagang"],
];

export function seedFoods() {
  const stmt = db.prepare(
    "INSERT OR REPLACE INTO foods (id,name,portion,sugar_g,carbs_g,category,aliases) VALUES (?,?,?,?,?,?,?)"
  );
  db.transaction(() => SEED.forEach((row) => stmt.run(...row)))();
}

// Indikator lampu lalu lintas (edukasi, bukan penilaian medis)
export function trafficLight(sugarG) {
  if (sugarG <= 5) return "hijau";
  if (sugarG <= 15) return "kuning";
  return "merah";
}

export function searchFoods(q = "") {
  const like = `%${q.trim().toLowerCase()}%`;
  const rows = db
    .query(
      `SELECT * FROM foods
       WHERE lower(name) LIKE ?1 OR lower(aliases) LIKE ?1
       ORDER BY name LIMIT 50`
    )
    .all(like);
  return rows.map((f) => ({ ...f, light: trafficLight(f.sugar_g) }));
}

export function getFood(id) {
  const f = db.query("SELECT * FROM foods WHERE id = ?").get(id);
  return f ? { ...f, light: trafficLight(f.sugar_g) } : null;
}

export function allFoodIds() {
  return db.query("SELECT id FROM foods ORDER BY id").all().map((r) => r.id);
}

export function slugify(name) {
  return String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export const AI_LABEL_CATEGORY = "label kemasan (AI)";
export const AI_ESTIMATE_CATEGORY = "estimasi AI";

/** Simpan makanan hasil AI. Nilai dari label kemasan tidak ditimpa oleh estimasi kasar. */
export function saveAiFood({ name, portion, sugarG, carbsG, labelRead }) {
  const slug = slugify(name);
  if (!slug) return null;
  const id = `ai-${slug}`;
  db.query(
    `INSERT INTO foods (id,name,portion,sugar_g,carbs_g,category,aliases) VALUES (?1,?2,?3,?4,?5,?6,'')
     ON CONFLICT(id) DO UPDATE SET portion=excluded.portion, sugar_g=excluded.sugar_g,
       carbs_g=excluded.carbs_g, category=excluded.category
     WHERE excluded.category = ?7 OR foods.category <> ?7`
  ).run(id, name, portion, sugarG, carbsG, labelRead ? AI_LABEL_CATEGORY : AI_ESTIMATE_CATEGORY, AI_LABEL_CATEGORY);
  return getFood(id);
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
