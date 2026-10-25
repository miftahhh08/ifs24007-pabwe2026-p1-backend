// Integrasi AI opsional. Prioritas: GEMINI_API_KEY (ada tier gratis), lalu ANTHROPIC_API_KEY.
// Tanpa key, fitur AI nonaktif dan aplikasi memakai asisten lokal.
import { getFood, allFoodIds } from "./foods.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const geminiUrl = () =>
  `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || "gemini-2.5-flash"}:generateContent`;

export const aiProvider = () =>
  process.env.GEMINI_API_KEY ? "gemini" : process.env.ANTHROPIC_API_KEY ? "anthropic" : null;
export const aiEnabled = () => aiProvider() !== null;

async function generate({ system, text, image }) {
  if (aiProvider() === "gemini") {
    const parts = [];
    if (image) parts.push({ inlineData: { mimeType: image.mediaType, data: image.data } });
    parts.push({ text });
    const res = await fetch(geminiUrl(), {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: [{ role: "user", parts }],
      }),
    });
    if (!res.ok) throw new Error(`AI error ${res.status}`);
    const json = await res.json();
    return (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text).filter(Boolean).join("\n");
  }
  const content = image
    ? [{ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } }, { type: "text", text }]
    : text;
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      max_tokens: 600,
      ...(system ? { system } : {}),
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) throw new Error(`AI error ${res.status}`);
  const json = await res.json();
  return (json.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
}

export const CHAT_SYSTEM =
  "Kamu Sobat Gula, pendamping edukasi gaya hidup sehat dalam Bahasa Indonesia yang ramah dan singkat (maksimal 5 kalimat). " +
  "Jangan mendiagnosis. Jangan memberi atau mengubah dosis obat/insulin. Anjurkan ke tenaga kesehatan bila perlu. " +
  "Batas gula tambahan acuan: 50 g per hari.";

export async function askAI(message, context = "") {
  const system = context ? `${CHAT_SYSTEM}\nKonteks pengguna hari ini: ${context}` : CHAT_SYSTEM;
  return generate({ system, text: message });
}

/** AI hanya memilih ID dari daftar; ID tidak dikenal dibuang. Nilai gizi selalu dari basis data. */
export async function filterAiItems(items) {
  const foods = [], unknown = [];
  for (const it of Array.isArray(items) ? items : []) {
    const food = await getFood(String(it?.id));
    if (!food) { unknown.push(String(it?.id ?? "?")); continue; }
    const servings = Math.min(10, Math.max(0.5, Number(it?.servings) || 1));
    foods.push({ ...food, servings, sugar_total_g: Math.round(food.sugar_g * servings * 10) / 10 });
  }
  return { foods, unknown };
}

export async function identifyFood(imageBase64, mediaType) {
  const text =
    `Kenali makanan/minuman pada foto. Pilih HANYA dari ID berikut: ${(await allFoodIds()).join(", ")}. ` +
    `Balas JSON saja: {"items":[{"id":"...","servings":1}]}. Jangan menulis angka gizi.`;
  const out = await generate({ text, image: { mediaType, data: imageBase64 } });
  let parsed;
  try { parsed = JSON.parse(out.replace(/```json|```/g, "").trim()); }
  catch { return { foods: [], unknown: [] }; }
  return filterAiItems(parsed.items);
}
