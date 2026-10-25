import express from "express";
import cors from "cors";
import db, { initDb, NOW, TODAY, TZ } from "./db.js";
import { seedStatements, searchFoods, getFood, calcLabel, DAILY_LIMIT_G } from "./foods.js";
import { validateRisk, assessRisk } from "./risk.js";
import { validateGlucose, classifyGlucose } from "./glucose.js";
import { reply, chatStatus } from "./chat.js";
import { aiEnabled, aiProvider, identifyFood } from "./ai.js";
import {
  validateRegister,
  validateLogin,
  registerUser,
  loginUser,
  logoutToken,
  authMiddleware,
} from "./auth.js";

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "6mb" }));

// Pastikan tabel dan data awal siap sebelum permintaan diproses (sekali per instance).
app.use(async (_req, _res, next) => {
  await initDb(seedStatements());
  next();
});

app.use(authMiddleware);

app.get("/", (_req, res) =>
  res.json({ name: "GulaSadar API", status: "ok", docs: "/api/health" })
);
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.get("/api/chat/status", (_req, res) => res.json({ data: chatStatus() }));
app.get("/api/ai/status", (_req, res) =>
  res.json({
    data: {
      enabled: aiEnabled(),
      provider: aiProvider() || "local",
      mode: aiEnabled() ? "cloud" : "local",
    },
  })
);

// --- Authentication Endpoints ---
app.post("/api/auth/register", async (req, res) => {
  const err = validateRegister(req.body ?? {});
  if (err) return res.status(400).json({ error: err });

  const result = await registerUser(req.body);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  res.status(201).json({ data: result.data });
});

app.post("/api/auth/login", async (req, res) => {
  const err = validateLogin(req.body ?? {});
  if (err) return res.status(400).json({ error: err });

  const result = await loginUser(req.body);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  res.json({ data: result.data });
});

app.get("/api/auth/me", (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "Sesi tidak valid atau telah berakhir" });
  }
  res.json({ data: { user: req.user } });
});

app.post("/api/auth/logout", async (req, res) => {
  if (req.token) {
    await logoutToken(req.token);
  }
  res.json({ data: { message: "Berhasil keluar" } });
});

// --- Foods Endpoints ---
app.get("/api/foods", async (req, res) => {
  res.json({ data: await searchFoods(String(req.query.q ?? "")) });
});

app.get("/api/foods/:id", async (req, res) => {
  const food = await getFood(req.params.id);
  if (!food) return res.status(404).json({ error: "Makanan tidak ditemukan" });
  res.json({ data: food });
});

// --- Food Consumption Logs ---
app.post("/api/logs", async (req, res) => {
  const { foodId, servings = 1 } = req.body ?? {};
  const n = Number(servings);
  if (typeof foodId !== "string" || !foodId)
    return res.status(400).json({ error: "foodId wajib diisi" });
  if (!Number.isFinite(n) || n <= 0 || n > 10)
    return res.status(400).json({ error: "servings harus 0-10" });

  const food = await getFood(foodId);
  if (!food) return res.status(404).json({ error: "Makanan tidak ditemukan" });

  const sugar = Math.round(food.sugar_g * n * 10) / 10;
  const userId = req.user ? req.user.id : null;
  const info = await db.run(
    `INSERT INTO food_logs (user_id, food_id, servings, sugar_g, eaten_at) VALUES (?,?,?,?,${NOW})`,
    [userId, food.id, n, sugar]
  );
  res.status(201).json({
    data: { id: info.lastInsertRowid, food: food.name, servings: n, sugar_g: sugar },
  });
});

app.get("/api/logs/today", async (req, res) => {
  const userId = req.user ? req.user.id : null;
  const logs = userId
    ? await db.all(
        `SELECT l.id, f.name, l.servings, l.sugar_g, l.eaten_at
         FROM food_logs l JOIN foods f ON f.id = l.food_id
         WHERE date(l.eaten_at) = ${TODAY} AND l.user_id = ?
         ORDER BY l.id DESC`,
        [userId]
      )
    : await db.all(
        `SELECT l.id, f.name, l.servings, l.sugar_g, l.eaten_at
         FROM food_logs l JOIN foods f ON f.id = l.food_id
         WHERE date(l.eaten_at) = ${TODAY} AND l.user_id IS NULL
         ORDER BY l.id DESC`
      );
  const total = Math.round(logs.reduce((s, l) => s + l.sugar_g, 0) * 10) / 10;
  res.json({
    data: {
      total_sugar_g: total,
      limit_g: DAILY_LIMIT_G,
      percent: Math.round((total / DAILY_LIMIT_G) * 100),
      logs,
    },
  });
});

app.delete("/api/logs/:id", async (req, res) => {
  const userId = req.user ? req.user.id : null;
  const r = userId
    ? await db.run(
        "DELETE FROM food_logs WHERE id = ? AND (user_id = ? OR user_id IS NULL)",
        [Number(req.params.id), userId]
      )
    : await db.run("DELETE FROM food_logs WHERE id = ?", [Number(req.params.id)]);
  if (r.changes === 0) return res.status(404).json({ error: "Catatan tidak ditemukan" });
  res.json({ data: { deleted: true } });
});

app.get("/api/logs/stats", async (req, res) => {
  const userId = req.user ? req.user.id : null;
  const rows = userId
    ? await db.all(
        `SELECT date(eaten_at) AS day, ROUND(SUM(sugar_g),1) AS sugar_g
         FROM food_logs WHERE date(eaten_at) >= date('now','${TZ}','-6 days') AND user_id = ?
         GROUP BY day`,
        [userId]
      )
    : await db.all(
        `SELECT date(eaten_at) AS day, ROUND(SUM(sugar_g),1) AS sugar_g
         FROM food_logs WHERE date(eaten_at) >= date('now','${TZ}','-6 days') AND user_id IS NULL
         GROUP BY day`
      );
  const byDay = Object.fromEntries(rows.map((r) => [r.day, r.sugar_g]));
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = (await db.get(`SELECT date('now','${TZ}',?) AS d`, [`-${i} days`])).d;
    days.push({ day: d, sugar_g: byDay[d] ?? 0 });
  }
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].sugar_g > 0) streak++;
    else if (i !== days.length - 1) break;
  }
  res.json({ data: { days, streak, limit_g: DAILY_LIMIT_G } });
});

// --- Label & Risk Assessment ---
app.post("/api/label", (req, res) => {
  const result = calcLabel(req.body ?? {});
  if (!result) return res.status(400).json({ error: "Data label tidak valid" });
  res.json({ data: result });
});

app.post("/api/risk", (req, res) => {
  const err = validateRisk(req.body ?? {});
  if (err) return res.status(400).json({ error: err });
  res.json({ data: assessRisk(req.body) });
});

// --- Glucose Logs ---
app.post("/api/glucose", async (req, res) => {
  const err = validateGlucose(req.body ?? {});
  if (err) return res.status(400).json({ error: err });
  const value = Number(req.body.value);
  const c = classifyGlucose(value, req.body.context);
  const userId = req.user ? req.user.id : null;
  const info = await db.run(
    `INSERT INTO glucose_logs (user_id, value, context, category, measured_at) VALUES (?,?,?,?,${NOW})`,
    [userId, value, req.body.context, c.category]
  );
  res.status(201).json({
    data: { id: info.lastInsertRowid, value, context: req.body.context, ...c },
  });
});

app.get("/api/glucose", async (req, res) => {
  const userId = req.user ? req.user.id : null;
  const rows = userId
    ? await db.all(
        "SELECT * FROM glucose_logs WHERE user_id = ? ORDER BY id DESC LIMIT 30",
        [userId]
      )
    : await db.all("SELECT * FROM glucose_logs WHERE user_id IS NULL ORDER BY id DESC LIMIT 30");
  res.json({ data: rows });
});

app.delete("/api/glucose/:id", async (req, res) => {
  const userId = req.user ? req.user.id : null;
  const r = userId
    ? await db.run(
        "DELETE FROM glucose_logs WHERE id = ? AND (user_id = ? OR user_id IS NULL)",
        [Number(req.params.id), userId]
      )
    : await db.run("DELETE FROM glucose_logs WHERE id = ?", [Number(req.params.id)]);
  if (r.changes === 0) return res.status(404).json({ error: "Catatan tidak ditemukan" });
  res.json({ data: { deleted: true } });
});

// --- Chatbot ---
app.post("/api/chat", async (req, res) => {
  const message = req.body?.message;
  if (typeof message !== "string" || !message.trim() || message.length > 500)
    return res.status(400).json({ error: "Pesan wajib diisi (maksimal 500 karakter)" });
  res.json({ data: await reply(message.trim()) });
});

// --- Photo Identification ---
app.post("/api/foods/identify", async (req, res) => {
  if (!aiEnabled())
    return res.status(503).json({ error: "Identifikasi foto tidak aktif. Gunakan pencarian makanan." });
  const { image, mediaType } = req.body ?? {};
  if (typeof image !== "string" || !image || !["image/jpeg", "image/png", "image/webp"].includes(mediaType))
    return res.status(400).json({ error: "Gambar (base64) dan mediaType jpeg/png/webp wajib diisi" });
  try {
    res.json({ data: await identifyFood(image, mediaType) });
  } catch {
    res.status(502).json({ error: "Layanan AI gagal. Gunakan pencarian makanan." });
  }
});

// Penanganan error terakhir: respons JSON, bukan halaman HTML.
app.use((err, _req, res, _next) => {
  if (!err.status || err.status >= 500) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : "Terjadi kesalahan pada server" });
});

export default app;
