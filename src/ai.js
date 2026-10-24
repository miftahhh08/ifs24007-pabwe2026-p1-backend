// Integrasi AI opsional. Mendukung Google Gemini (GEMINI_API_KEY, prioritas) atau Anthropic (ANTHROPIC_API_KEY).
// Tanpa API key, fitur AI nonaktif dan aplikasi memakai aturan lokal + basis data.
import { getFood, allFoodIds, saveAiFood } from "./foods.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

export const aiProvider = () =>
  process.env.GEMINI_API_KEY ? "gemini" : process.env.ANTHROPIC_API_KEY ? "anthropic" : null;
export const aiEnabled = () => aiProvider() !== null;

const toText = (parts) => parts.filter((c) => c?.type === "text").map((c) => c.text).join("\n");

/** parts: [{ text }] atau [{ image, mediaType }] */
async function callGemini({ system, parts, schema }) {
  const body = {
    model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
    input: parts.map((p) => (p.image ? { type: "image", data: p.image, mime_type: p.mediaType } : { type: "text", text: p.text })),
    store: false,
  };
  if (system) body.system_instruction = system;
  if (schema) body.response_format = { type: "text", mime_type: "application/json", schema };
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`AI error ${res.status}`);
  const json = await res.json();
  return toText((json.steps ?? []).filter((s) => s.type === "model_output").flatMap((s) => s.content ?? []));
}

async function callAnthropic({ system, parts }) {
  const content = parts.map((p) =>
    p.image ? { type: "image", source: { type: "base64", media_type: p.mediaType, data: p.image } } : { type: "text", text: p.text });
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      max_tokens: 1000,
      ...(system ? { system } : {}),
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) throw new Error(`AI error ${res.status}`);
  const json = await res.json();
  return toText(json.content ?? []);
}

const callAI = (req) => (aiProvider() === "gemini" ? callGemini(req) : callAnthropic(req));

export const CHAT_SYSTEM =
  "Kamu Sobat Gula, pendamping edukasi gaya hidup sehat dalam Bahasa Indonesia. Jangan mendiagnosis. " +
  "Jangan memberi atau mengubah dosis obat/insulin. Jawab singkat, ramah, dan anjurkan ke tenaga kesehatan bila perlu.";

export async function askAI(message) {
  return callAI({ system: CHAT_SYSTEM, parts: [{ text: message }] });
}

// --- Identifikasi foto makanan ---
export const IDENTIFY_SCHEMA = {
  type: "object",
  properties: {
    is_food: { type: "boolean", description: "false jika foto tidak berisi makanan/minuman" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Nama makanan/minuman dalam Bahasa Indonesia, sertakan merek bila terlihat" },
          matched_id: { type: "string", description: "ID basis data yang cocok, atau string kosong" },
          portion: { type: "string", description: "Takaran porsi, mis. '1 bungkus (68 g)'" },
          servings: { type: "number", description: "Jumlah porsi yang terlihat" },
          sugar_g: { type: "number", description: "Gula (gram) per porsi" },
          carbs_g: { type: "number", description: "Karbohidrat (gram) per porsi" },
          label_read: { type: "boolean", description: "true jika angka gula dibaca dari tabel Informasi Nilai Gizi" },
          confidence: { type: "string", enum: ["tinggi", "sedang", "rendah"] },
        },
        required: ["name", "matched_id", "portion", "servings", "sugar_g", "carbs_g", "label_read", "confidence"],
      },
    },
  },
  required: ["is_food", "items"],
};

export function identifyPrompt(ids) {
  return (
    "Kamu ahli gizi Indonesia. Kenali SEMUA makanan dan minuman pada foto: makanan rumahan, jajanan, buah, " +
    "minuman, dan makanan kemasan (ciki/keripik, biskuit, permen, cokelat, wafer, minuman botol/kotak). " +
    "Jika ada kemasan dengan tabel Informasi Nilai Gizi yang terbaca, pakai angka gula dari label itu (label_read=true). " +
    `Jika item sama dengan salah satu ID basis data berikut, isi matched_id dengan ID tersebut: ${ids.join(", ")}. ` +
    "Jika tidak ada yang cocok, kosongkan matched_id lalu perkirakan gula per porsi umum berdasarkan TKPI Kemenkes " +
    "atau label produk sejenis yang beredar di Indonesia. Jika foto bukan makanan, is_food=false dan items kosong."
  );
}

const round1 = (n) => Math.round(n * 10) / 10;
const clampServings = (v) => Math.min(10, Math.max(0.5, Number(v) || 1));
const CONFIDENCE = ["tinggi", "sedang", "rendah"];

/**
 * Item yang cocok dengan basis data memakai nilai basis data (sumber tepercaya).
 * Item baru disimpan sebagai "estimasi AI" / "label kemasan (AI)" agar bisa dicatat dan ditandai jelas sumbernya.
 */
export function processIdentified(parsed) {
  const items = Array.isArray(parsed?.items) ? parsed.items.slice(0, 8) : [];
  const foods = [], unknown = [];
  for (const it of items) {
    const servings = clampServings(it?.servings);
    const dbFood = it?.matched_id ? getFood(String(it.matched_id)) : null;
    if (dbFood && !dbFood.id.startsWith("ai-")) {
      foods.push({ ...dbFood, servings, sugar_total_g: round1(dbFood.sugar_g * servings), source: "database" });
      continue;
    }
    const name = String(it?.name ?? "").trim().slice(0, 60);
    const sugar = Number(it?.sugar_g);
    if (!name || !Number.isFinite(sugar) || sugar < 0 || sugar > 200) {
      unknown.push(name || "?");
      continue;
    }
    const carbs = Number(it?.carbs_g);
    const labelRead = it?.label_read === true;
    const food = saveAiFood({
      name,
      portion: String(it?.portion ?? "").trim().slice(0, 40) || "1 porsi",
      sugarG: round1(sugar),
      carbsG: Number.isFinite(carbs) && carbs >= 0 ? round1(Math.min(carbs, 500)) : 0,
      labelRead,
    });
    if (!food) { unknown.push(name); continue; }
    foods.push({
      ...food,
      servings,
      sugar_total_g: round1(food.sugar_g * servings),
      source: labelRead ? "label" : "ai",
      confidence: CONFIDENCE.includes(it?.confidence) ? it.confidence : "sedang",
    });
  }
  return { foods, unknown, notFood: parsed?.is_food === false && foods.length === 0 };
}

export function identifyFoodLocal(filename = "", hint = "", imageBase64 = "") {
  const name = String(filename).toLowerCase();
  const validHint = typeof hint === "string" ? hint.toLowerCase().trim() : "";

  // 1. Prioritaskan visual hint dari analisis warna & bentuk di browser
  if (validHint && getFood(validHint)) {
    const food = getFood(validHint);
    return {
      foods: [
        {
          ...food,
          servings: 1,
          sugar_total_g: food.sugar_g,
          source: food.category === "snack kemasan" ? "label" : "database",
          confidence: "tinggi",
        },
      ],
      unknown: [],
      notFood: false,
      mode: "local",
    };
  }

  // 2. Cocokkan kata kunci nama file bila ada
  const all = [
    { key: /lolipop|lollipop|permen|candy/, id: "permen-lolipop" },
    { key: /silverqueen|cokelat|coklat|chocolate|cadbury|kitkat|batang/, id: "cokelat-silverqueen" },
    { key: /donat|donut|doughnut/, id: "donat" },
    { key: /kopi|coffee|point|latte|cappuccino|espresso|starbucks|kenangan|machiato|aren/, id: "kopi-susu-gula-aren" },
    { key: /boba|bubble|brown.*sugar|chatime|mixue/, id: "boba-milk-tea" },
    { key: /chitato|keripik.*kentang|potato/, id: "ciki-chitato" },
    { key: /taro|ciki|snack|camilan|snak/, id: "ciki-taro" },
    { key: /oreo|biskuit.*vanila/, id: "biskuit-oreo" },
    { key: /tango|wafer/, id: "wafer-tango" },
    { key: /roma|kelapa/, id: "biskuit-roma" },
    { key: /susu|ultra|uht/, id: "susu-uht-cokelat" },
    { key: /teh.*botol|botol/, id: "teh-botol" },
    { key: /es.*teh|teh/, id: "es-teh-manis" },
    { key: /soda|cola/, id: "soda" },
    { key: /bakso|mie|mi/, id: "bakso" },
    { key: /nasi.*goreng|nasgor/, id: "nasi-goreng" },
    { key: /martabak/, id: "martabak-manis" },
    { key: /pisang|gorengan/, id: "gorengan-pisang" },
    { key: /apel|buah/, id: "apel" },
  ];

  const match = all.find((m) => m.key.test(name));
  if (!match) {
    return {
      foods: [],
      unknown: ["Foto belum dikenali otomatis"],
      notFood: false,
      mode: "local",
    };
  }

  const chosenId = match.id;
  const food = getFood(chosenId);
  if (!food) return { foods: [], unknown: [], notFood: false, mode: "local" };

  const isLabel = food.category === "snack kemasan" || food.id.startsWith("ciki") || food.id.startsWith("biskuit") || food.id.startsWith("wafer");

  return {
    foods: [
      {
        ...food,
        servings: 1,
        sugar_total_g: food.sugar_g,
        source: isLabel ? "label" : "database",
        confidence: "tinggi",
      },
    ],
    unknown: [],
    notFood: false,
    mode: "local",
  };
}

export async function identifyFood(imageBase64, mediaType, filename = "", hint = "") {
  if (aiEnabled()) {
    try {
      const gemini = aiProvider() === "gemini";
      const prompt = identifyPrompt(allFoodIds().filter((id) => !id.startsWith("ai-"))) +
        (gemini ? "" : ` Balas JSON saja sesuai skema: ${JSON.stringify(IDENTIFY_SCHEMA)}`);
      const text = await callAI({
        parts: [{ image: imageBase64, mediaType }, { text: prompt }],
        schema: gemini ? IDENTIFY_SCHEMA : undefined,
      });
      let parsed;
      try { parsed = JSON.parse(text.replace(/```json|```/g, "").trim()); }
      catch { return identifyFoodLocal(filename, hint, imageBase64); }
      const res = processIdentified(parsed);
      if (res.foods.length > 0 || res.notFood) return res;
    } catch {
      return identifyFoodLocal(filename, hint, imageBase64);
    }
  }
  return identifyFoodLocal(filename, hint, imageBase64);
}

