import { test, expect, describe, beforeAll, afterAll, afterEach } from "bun:test";

process.env.DB_PATH = ":memory:";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.GEMINI_API_KEY;
const { default: app } = await import("../src/app.js");
const { calcLabel, allFoodIds } = await import("../src/foods.js");
const { checkSafety } = await import("../src/safety.js");
const { validateRisk, assessRisk, bmi } = await import("../src/risk.js");
const { validateGlucose, classifyGlucose } = await import("../src/glucose.js");
const { processIdentified, aiEnabled, aiProvider, identifyPrompt } = await import("../src/ai.js");
const { saveAiFood, slugify, getFood } = await import("../src/foods.js");

let server, base;
beforeAll(() => { server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`; });
afterAll(() => server.close());
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
});
const send = (path, body, method = "POST") =>
  realFetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });

const person = { age: 50, sex: "pria", heightCm: 170, weightKg: 85, waistCm: 100, active: false,
  dailyVegetables: false, bpMedication: true, highGlucoseHistory: true, familyHistory: "orangtua" };

describe("keselamatan", () => {
  test("darurat, dosis, dan aman", () => {
    expect(checkSafety("saya pingsan")).toBe("emergency");
    expect(checkSafety("berapa dosis insulin saya?")).toBe("dosage");
    expect(checkSafety("kurangi obat metformin")).toBe("dosage");
    expect(checkSafety("apa itu gula?")).toBe("ok");
    expect(checkSafety(undefined)).toBe("ok");
  });
});

describe("skrining risiko", () => {
  test("validasi input", () => {
    expect(validateRisk(person)).toBeNull();
    expect(validateRisk()).toContain("Umur");
    expect(validateRisk({ ...person, age: 17 })).toContain("Umur");
    expect(validateRisk({ ...person, heightCm: 10 })).toContain("Tinggi");
    expect(validateRisk({ ...person, weightKg: 5 })).toContain("Berat");
    expect(validateRisk({ ...person, waistCm: 1 })).toContain("pinggang");
    expect(validateRisk({ ...person, sex: "x" })).toContain("kelamin");
    expect(validateRisk({ ...person, familyHistory: "x" })).toContain("keluarga");
  });
  test("tingkat risiko", () => {
    expect(bmi(170, 85)).toBe(29.4);
    expect(assessRisk(person).level).toBe("sangat tinggi");
    const low = { age: 30, sex: "wanita", heightCm: 165, weightKg: 55, waistCm: 70, active: true, dailyVegetables: true };
    expect(assessRisk(low)).toMatchObject({ score: 0, level: "rendah" });
    expect(assessRisk({ ...low, age: 50, weightKg: 70, waistCm: 85, active: false }).level).toBe("sedang");
    expect(assessRisk({ ...low, age: 60, weightKg: 85, waistCm: 90, familyHistory: "kerabat" }).level).toBe("tinggi");
    expect(assessRisk({ ...low, age: 70, sex: "pria", waistCm: 95 }).score).toBe(7);
  });
  test("API risk", async () => {
    expect((await send("/api/risk", person)).status).toBe(200);
    expect((await send("/api/risk", { age: 5 })).status).toBe(400);
    expect((await send("/api/risk")).status).toBe(400);
  });
});

describe("gula darah", () => {
  test("validasi dan klasifikasi", () => {
    expect(validateGlucose({ value: 100, context: "puasa" })).toBeNull();
    expect(validateGlucose()).toContain("Nilai");
    expect(validateGlucose({ value: 100, context: "x" })).toContain("Konteks");
    const cases = [
      [60, "puasa", "rendah"], [90, "puasa", "normal"], [110, "puasa", "waspada"], [130, "puasa", "tinggi"],
      [120, "sesudah_makan", "normal"], [150, "sesudah_makan", "waspada"], [210, "sesudah_makan", "tinggi"],
      [120, "sewaktu", "normal"], [150, "sewaktu", "waspada"], [210, "sewaktu", "tinggi"],
    ];
    for (const [v, c, cat] of cases) expect(classifyGlucose(v, c).category).toBe(cat);
  });
  test("API catat, daftar, hapus", async () => {
    const r = await send("/api/glucose", { value: 110, context: "puasa" });
    expect(r.status).toBe(201);
    const { data } = await r.json();
    expect(data.category).toBe("waspada");
    expect((await (await realFetch(base + "/api/glucose")).json()).data.length).toBe(1);
    expect((await send(`/api/glucose/${data.id}`, null, "DELETE")).status).toBe(200);
    expect((await send(`/api/glucose/${data.id}`, null, "DELETE")).status).toBe(404);
    expect((await send("/api/glucose", { value: 1, context: "puasa" })).status).toBe(400);
    expect((await send("/api/glucose")).status).toBe(400);
  });
});

describe("label kemasan dan statistik", () => {
  test("calcLabel", () => {
    expect(calcLabel({ sugarPerServingG: 10, servingsPerPack: 3, consumedServings: 2 }))
      .toEqual({ total_sugar_g: 20, pack_sugar_g: 30, spoons: 1.6, percent_of_limit: 40, light: "merah" });
    expect(calcLabel({ sugarPerServingG: 3 }).light).toBe("hijau");
    expect(calcLabel()).toBeNull();
    expect(calcLabel({ sugarPerServingG: -1 })).toBeNull();
    expect(calcLabel({ sugarPerServingG: 1, servingsPerPack: 0 })).toBeNull();
  });
  test("API label", async () => {
    expect((await send("/api/label", { sugarPerServingG: 5 })).status).toBe(200);
    expect((await send("/api/label", { sugarPerServingG: "x" })).status).toBe(400);
    expect((await send("/api/label")).status).toBe(400);
  });
  test("statistik 7 hari dan rangkaian", async () => {
    const get = async () => (await (await realFetch(base + "/api/logs/stats")).json()).data;
    const before = await get();
    expect(before.days.length).toBe(7);
    const { data } = await (await send("/api/logs", { foodId: "soda" })).json();
    const after = await get();
    expect(Math.round((after.days[6].sugar_g - before.days[6].sugar_g) * 10) / 10).toBe(35);
    expect(after.streak).toBeGreaterThanOrEqual(1);
    await send(`/api/logs/${data.id}`, null, "DELETE"); // bersihkan agar tes lain tidak terganggu
  });
});

describe("chatbot", () => {
  const chat = async (message) => (await (await send("/api/chat", { message })).json()).data;
  test("aturan lokal dan keselamatan", async () => {
    expect((await chat("apa batas gula sehari?")).mode).toBe("rules");
    for (const q of ["minuman manis bahaya?", "gejala diabetes?", "olahraga apa?", "cara mencegah diabetes?", "halo"])
      expect((await chat(q)).reply.length).toBeGreaterThan(10);
    expect((await chat("saya pingsan")).mode).toBe("safety");
    expect((await chat("berapa dosis insulin")).mode).toBe("safety");
  });
  test("validasi pesan", async () => {
    expect((await send("/api/chat", { message: "" })).status).toBe(400);
    expect((await send("/api/chat", { message: "x".repeat(501) })).status).toBe(400);
    expect((await send("/api/chat")).status).toBe(400);
  });
  test("mode AI dan fallback jika AI gagal", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    globalThis.fetch = async (url, o) => url.startsWith("https://api.anthropic")
      ? new Response(JSON.stringify({ content: [{ type: "text", text: "Halo dari AI" }] }))
      : realFetch(url, o);
    expect((await chat("halo")).mode).toBe("ai");
    globalThis.fetch = async (url, o) => url.startsWith("https://api.anthropic")
      ? new Response("{}", { status: 500 }) : realFetch(url, o);
    expect((await chat("apa batas gula sehari?")).mode).toBe("rules");
  });
  test("mode AI dengan Gemini", async () => {
    process.env.GEMINI_API_KEY = "test";
    let sent;
    globalThis.fetch = async (url, o) => {
      if (!url.startsWith("https://generativelanguage")) return realFetch(url, o);
      sent = JSON.parse(o.body);
      return new Response(JSON.stringify({ steps: [
        { type: "thought" },
        { type: "model_output", content: [{ type: "text", text: "Halo dari Gemini" }] },
      ] }));
    };
    const r = await chat("halo");
    expect(r).toEqual({ reply: "Halo dari Gemini", mode: "ai" });
    expect(sent.system_instruction).toContain("Sobat Gula");
    expect(sent.response_format).toBeUndefined();
  });
});

describe("identifikasi foto", () => {
  const img = { image: "abc", mediaType: "image/png" };
  const anthropicReply = (text) => (globalThis.fetch = async (url, o) => url.startsWith("https://api.anthropic")
    ? new Response(JSON.stringify({ content: [{ type: "text", text }, { type: "x" }] }))
    : realFetch(url, o));
  const geminiReply = (obj, capture = {}) => (globalThis.fetch = async (url, o) => {
    if (!url.startsWith("https://generativelanguage")) return realFetch(url, o);
    capture.body = JSON.parse(o.body);
    capture.headers = o.headers;
    return new Response(JSON.stringify({ steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(obj) }] }] }));
  });
  const item = (o) => ({ name: "", matched_id: "", portion: "1 bungkus", servings: 1, sugar_g: 0, carbs_g: 0,
    label_read: false, confidence: "sedang", ...o });

  test("mode lokal otomatis tanpa API key, status AI", async () => {
    expect(aiEnabled()).toBe(false);
    expect(aiProvider()).toBeNull();
    // Tanpa API key, identifikasi foto tetap berhasil secara lokal (200 OK)
    const localRes = await send("/api/foods/identify", { ...img, filename: "chitato.png" });
    expect(localRes.status).toBe(200);
    const localData = (await localRes.json()).data;
    expect(localData.foods[0].id).toBe("ciki-chitato");
    expect(localData.mode).toBe("local");

    const lolipopRes = await send("/api/foods/identify", { ...img, filename: "lolipop.png" });
    expect((await lolipopRes.json()).data.foods[0].id).toBe("permen-lolipop");

    const unknownRes = await send("/api/foods/identify", { ...img, filename: "random-doc.pdf" });
    expect((await unknownRes.json()).data.foods).toHaveLength(0);

    expect((await (await realFetch(base + "/api/ai/status")).json()).data).toEqual({ enabled: true, provider: "local", mode: "local" });
    process.env.ANTHROPIC_API_KEY = "a";
    expect(aiProvider()).toBe("anthropic");
    process.env.GEMINI_API_KEY = "g";
    expect(aiProvider()).toBe("gemini");
    expect((await (await realFetch(base + "/api/ai/status")).json()).data).toEqual({ enabled: true, provider: "gemini", mode: "cloud" });
  });
  test("validasi input", async () => {
    process.env.GEMINI_API_KEY = "test";
    expect((await send("/api/foods/identify", { image: "a", mediaType: "x" })).status).toBe(400);
    expect((await send("/api/foods/identify")).status).toBe(400);
  });
  test("Gemini: makanan apa pun dikenali (ciki kemasan), basis data diutamakan", async () => {
    process.env.GEMINI_API_KEY = "test";
    const cap = {};
    geminiReply({ is_food: true, items: [
      item({ name: "Es teh manis", matched_id: "es-teh-manis", servings: 2 }),
      item({ name: "Chitato Sapi Panggang", portion: "1 bungkus (68 g)", sugar_g: 2, carbs_g: 38, label_read: true, confidence: "tinggi" }),
      item({ name: "Kue cubit", sugar_g: 9, carbs_g: "x", confidence: "ngawur", portion: "" }),
    ] }, cap);
    const { data } = await (await send("/api/foods/identify", img)).json();
    expect(cap.headers["x-goog-api-key"]).toBe("test");
    expect(cap.body.response_format.mime_type).toBe("application/json");
    expect(cap.body.input[0]).toEqual({ type: "image", data: "abc", mime_type: "image/png" });
    expect(data.notFood).toBe(false);
    expect(data.foods).toHaveLength(3);
    expect(data.foods[0]).toMatchObject({ id: "es-teh-manis", source: "database", sugar_total_g: 40 });
    expect(data.foods[1]).toMatchObject({ id: "ai-chitato-sapi-panggang", source: "label", confidence: "tinggi", sugar_g: 2 });
    expect(data.foods[2]).toMatchObject({ source: "ai", confidence: "sedang", carbs_g: 0, portion: "1 porsi" });
    // makanan hasil AI bisa langsung dicatat
    const log = await send("/api/logs", { foodId: "ai-chitato-sapi-panggang", servings: 1 });
    expect(log.status).toBe(201);
    await send(`/api/logs/${(await log.json()).data.id}`, null, "DELETE");
  });
  test("Anthropic: JSON dalam blok kode, item tidak valid dibuang", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    anthropicReply('```json\n' + JSON.stringify({ is_food: true, items: [
      item({ name: "Minuman soda", matched_id: "soda", servings: 50 }),
      item({ name: "", sugar_g: 5 }),
      item({ name: "Permen", sugar_g: 999 }),
      item({ name: "!!!", sugar_g: 3 }),
    ] }) + '\n```');
    const { data } = await (await send("/api/foods/identify", img)).json();
    expect(data.foods).toHaveLength(1);
    expect(data.foods[0].servings).toBe(10);
    expect(data.unknown).toEqual(["?", "Permen", "!!!"]);
  });
  test("bukan makanan, JSON tidak valid, dan fallback mulus ke lokal", async () => {
    process.env.GEMINI_API_KEY = "test";
    geminiReply({ is_food: false, items: [] });
    expect((await (await send("/api/foods/identify", img)).json()).data).toEqual({ foods: [], unknown: [], notFood: true });
    // JSON tidak valid jatuh ke mode lokal
    globalThis.fetch = async (url, o) => url.startsWith("https://generativelanguage")
      ? new Response(JSON.stringify({})) : realFetch(url, o);
    const fallbackRes = await (await send("/api/foods/identify", { ...img, filename: "taro.jpg" })).json();
    expect(fallbackRes.data.foods[0].id).toBe("ciki-taro");
    // Kegagalan cloud AI juga jatuh mulus ke mode lokal tanpa error 502
    globalThis.fetch = async (url, o) => url.startsWith("https://generativelanguage")
      ? new Response("{}", { status: 500 }) : realFetch(url, o);
    const cloudFailRes = await (await send("/api/foods/identify", { ...img, filename: "oreo.png" })).json();
    expect(cloudFailRes.data.foods[0].id).toBe("biskuit-oreo");
  });
  test("processIdentified, saveAiFood, dan prompt", () => {
    expect(processIdentified("x")).toEqual({ foods: [], unknown: [], notFood: false });
    expect(processIdentified({ items: [{ matched_id: "soda", servings: 0 }] }).foods[0].servings).toBe(1);
    expect(slugify("Kue Lumpur Éclair!")).toBe("kue-lumpur-eclair");
    expect(saveAiFood({ name: "***", portion: "1", sugarG: 1, carbsG: 1 })).toBeNull();
    // nilai dari label tidak ditimpa estimasi kasar
    saveAiFood({ name: "Wafer Coklat", portion: "1 bungkus", sugarG: 12, carbsG: 20, labelRead: true });
    saveAiFood({ name: "Wafer Coklat", portion: "1 bungkus", sugarG: 30, carbsG: 20, labelRead: false });
    expect(getFood("ai-wafer-coklat").sugar_g).toBe(12);
    // item AI lama tidak dianggap sumber basis data resmi
    expect(processIdentified({ items: [item({ name: "Wafer Coklat", matched_id: "ai-wafer-coklat", sugar_g: 12, label_read: true })] })
      .foods[0].source).toBe("label");
    expect(identifyPrompt(["soda"])).toContain("ciki");
    expect(allFoodIds()).toContain("soda");
  });
});

describe("rangkaian hari terputus", () => {
  test("hari tanpa catatan memutus streak", async () => {
    const { default: db } = await import("../src/db.js");
    db.run("DELETE FROM food_logs");
    db.run("INSERT INTO food_logs (food_id, servings, sugar_g, eaten_at) VALUES ('soda',1,35,datetime('now','localtime','-3 days'))");
    const s = (await (await realFetch(base + "/api/logs/stats")).json()).data;
    expect(s.streak).toBe(0);
    db.run("INSERT INTO food_logs (food_id, servings, sugar_g, eaten_at) VALUES ('soda',1,35,datetime('now','localtime','-1 days'))");
    expect((await (await realFetch(base + "/api/logs/stats")).json()).data.streak).toBe(1);
    db.run("DELETE FROM food_logs");
  });
});
