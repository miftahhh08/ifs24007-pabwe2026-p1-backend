import { test, expect, describe, beforeAll, afterAll, afterEach } from "bun:test";

process.env.DB_PATH = ":memory:";
delete process.env.ANTHROPIC_API_KEY;
const { default: app } = await import("../src/app.js");
const { calcLabel, allFoodIds } = await import("../src/foods.js");
const { checkSafety } = await import("../src/safety.js");
const { validateRisk, assessRisk, bmi } = await import("../src/risk.js");
const { validateGlucose, classifyGlucose } = await import("../src/glucose.js");
const { filterAiItems, aiEnabled } = await import("../src/ai.js");

let server, base;
beforeAll(() => { server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`; });
afterAll(() => server.close());
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; delete process.env.ANTHROPIC_API_KEY; });
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
});

describe("identifikasi foto", () => {
  const img = { image: "abc", mediaType: "image/png" };
  const aiReply = (text) => (globalThis.fetch = async (url, o) => url.startsWith("https://api.anthropic")
    ? new Response(JSON.stringify({ content: [{ type: "text", text }, { type: "x" }] }))
    : realFetch(url, o));
  test("nonaktif tanpa API key", async () => {
    expect(aiEnabled()).toBe(false);
    expect((await send("/api/foods/identify", img)).status).toBe(503);
  });
  test("validasi input", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    expect((await send("/api/foods/identify", { image: "a", mediaType: "x" })).status).toBe(400);
    expect((await send("/api/foods/identify")).status).toBe(400);
  });
  test("ID tidak dikenal dibuang, nilai gizi dari basis data", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    aiReply('```json\n{"items":[{"id":"es-teh-manis","servings":2},{"id":"ngarang","servings":1},{"servings":99}]}\n```');
    const { data } = await (await send("/api/foods/identify", img)).json();
    expect(data.foods).toHaveLength(1);
    expect(data.foods[0].sugar_total_g).toBe(40);
    expect(data.unknown).toEqual(["ngarang", "?"]);
  });
  test("JSON AI tidak valid dan kegagalan layanan", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    aiReply("bukan json");
    expect((await (await send("/api/foods/identify", img)).json()).data).toEqual({ foods: [], unknown: [] });
    globalThis.fetch = async (url, o) => url.startsWith("https://api.anthropic")
      ? new Response("{}", { status: 500 }) : realFetch(url, o);
    expect((await send("/api/foods/identify", img)).status).toBe(502);
  });
  test("filterAiItems", async () => {
    expect(await filterAiItems("x")).toEqual({ foods: [], unknown: [] });
    expect(await filterAiItems([{ id: "soda", servings: 0 }])).toBeDefined();
    expect((await filterAiItems([{ id: "soda", servings: 50 }])).foods[0].servings).toBe(10);
    expect(await allFoodIds()).toContain("soda");
  });
});

describe("rangkaian hari terputus", () => {
  test("hari tanpa catatan memutus streak", async () => {
    const { default: db, TZ } = await import("../src/db.js");
    const NOW_MINUS = (d) => `datetime('now','${TZ}','${d}')`;
    await db.run("DELETE FROM food_logs");
    await db.run(`INSERT INTO food_logs (food_id, servings, sugar_g, eaten_at) VALUES ('soda',1,35,${NOW_MINUS('-3 days')})`);
    const s = (await (await realFetch(base + "/api/logs/stats")).json()).data;
    expect(s.streak).toBe(0);
    await db.run(`INSERT INTO food_logs (food_id, servings, sugar_g, eaten_at) VALUES ('soda',1,35,${NOW_MINUS('-1 days')})`);
    expect((await (await realFetch(base + "/api/logs/stats")).json()).data.streak).toBe(1);
    await db.run("DELETE FROM food_logs");
  });
});

describe("asisten lokal yang lebih pintar", () => {
  const chat = async (message) => (await (await send("/api/chat", { message })).json()).data;
  test("menjawab kandungan gula dari basis data makanan", async () => {
    const a = await chat("berapa gula di es teh manis?");
    expect(a.mode).toBe("rules");
    expect(a.reply).toContain("20 g gula");
    expect(a.reply).toContain("merah");
    expect((await chat("gula di air putih")).reply).toContain("hampir tidak mengandung");
    expect(a.suggestions.length).toBe(3);
  });
  test("beberapa makanan: pilih nama terpanjang", async () => {
    expect((await chat("lebih manis es teh manis atau soda?")).reply).toContain("Es teh manis");
  });
  test("batas harian tidak tertimpa nama makanan", async () => {
    expect((await chat("batas gula sehari kalau minum soda?")).reply).toContain("50 g");
  });
  test("ringkasan hari ini kosong dan terisi", async () => {
    const { default: db, TZ } = await import("../src/db.js");
    const NOW_MINUS = (d) => `datetime('now','${TZ}','${d}')`;
    await db.run("DELETE FROM food_logs");
    expect((await chat("ringkasan gulaku hari ini")).reply).toContain("belum mencatat");
    await send("/api/logs", { foodId: "soda" });
    expect((await chat("ringkasan gulaku hari ini")).reply).toContain("35 g");
    await send("/api/logs", { foodId: "soda" });
    expect((await chat("sisa jatah gula hari ini")).reply).toContain("melewati");
    await db.run("DELETE FROM food_logs");
  });
  test("topik pengetahuan", async () => {
    const qs = ["beda diabetes tipe 1 dan 2", "arti lampu lalu lintas", "tips mengurangi gula", "cara baca label kemasan",
      "madu sehat?", "olahraga apa", "cara mencegah diabetes", "riwayat keluarga diabetes", "gula darah normal berapa",
      "menu sehat piring", "makasih", "halo", "gejala diabetes", "xyz acak"];
    for (const q of qs) expect((await chat(q)).reply.length).toBeGreaterThan(20);
    expect((await chat("xyz acak")).reply).toContain("belum punya jawaban");
  });
  test("status chat", async () => {
    const r = await (await realFetch(base + "/api/chat/status")).json();
    expect(r.data.mode).toBe("rules");
    expect(r.data.suggestions.length).toBeGreaterThan(3);
    process.env.GEMINI_API_KEY = "g";
    expect((await (await realFetch(base + "/api/chat/status")).json()).data).toMatchObject({ mode: "ai", provider: "gemini" });
    delete process.env.GEMINI_API_KEY;
  });
});

describe("provider Gemini", () => {
  afterEach(() => { delete process.env.GEMINI_API_KEY; });
  const gemini = (text) => (globalThis.fetch = async (url, o) => url.startsWith("https://generativelanguage")
    ? (o.headers["x-goog-api-key"] === "g" ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }, {}] } }] })) : new Response("{}", { status: 403 }))
    : realFetch(url, o));
  test("chat memakai Gemini", async () => {
    process.env.GEMINI_API_KEY = "g";
    gemini("Halo dari Gemini");
    const d = (await (await send("/api/chat", { message: "tes" })).json()).data;
    expect(d).toMatchObject({ mode: "ai", reply: "Halo dari Gemini" });
  });
  test("identifikasi foto memakai Gemini", async () => {
    process.env.GEMINI_API_KEY = "g";
    gemini('{"items":[{"id":"soda"}]}');
    const d = (await (await send("/api/foods/identify", { image: "abc", mediaType: "image/png" })).json()).data;
    expect(d.foods[0].sugar_total_g).toBe(35);
  });
  test("Gemini gagal -> chat jatuh ke aturan lokal", async () => {
    process.env.GEMINI_API_KEY = "salah";
    gemini("x");
    expect((await (await send("/api/chat", { message: "halo" })).json()).data.mode).toBe("rules");
  });
  test("Gemini tanpa kandidat", async () => {
    process.env.GEMINI_API_KEY = "g";
    globalThis.fetch = async (url, o) => url.startsWith("https://generativelanguage")
      ? new Response("{}") : realFetch(url, o);
    expect((await (await send("/api/foods/identify", { image: "abc", mediaType: "image/png" })).json()).data).toEqual({ foods: [], unknown: [] });
  });
});

describe("route akar dan penanganan error", () => {
  test("GET / menjelaskan API", async () => {
    const r = await (await realFetch(base + "/")).json();
    expect(r).toMatchObject({ name: "GulaSadar API", status: "ok" });
  });
  test("JSON rusak menghasilkan 400 berformat JSON", async () => {
    const r = await realFetch(base + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{rusak" });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBeString();
  });
  test("error tak terduga menghasilkan 500 tanpa membocorkan detail", async () => {
    const { default: db } = await import("../src/db.js");
    const orig = db.all; // db.all dipakai rute glucose; paksa gagal sekali lewat tabel yang dihapus
    await db.run("ALTER TABLE glucose_logs RENAME TO glucose_tmp");
    const spy = console.error; console.error = () => {};
    const r = await realFetch(base + "/api/glucose");
    console.error = spy;
    await db.run("ALTER TABLE glucose_tmp RENAME TO glucose_logs");
    expect(r.status).toBe(500);
    expect((await r.json()).error).toBe("Terjadi kesalahan pada server");
    expect(db.all).toBe(orig);
  });
});
