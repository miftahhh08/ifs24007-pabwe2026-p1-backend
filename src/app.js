import express from "express";
import cors from "cors";
import db from "./db.js";
import { seedFoods, searchFoods, getFood, calcLabel, DAILY_LIMIT_G } from "./foods.js";
import { validateRisk, assessRisk } from "./risk.js";
import { validateGlucose, classifyGlucose } from "./glucose.js";
import { reply } from "./chat.js";
import { aiEnabled, aiProvider, identifyFood } from "./ai.js";
import {
  validateRegister,
  validateLogin,
  registerUser,
  loginUser,
  logoutToken,
  authMiddleware,
} from "./auth.js";

seedFoods();

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: "6mb" }));
app.use(authMiddleware);

app.get("/", (_req, res) => {
  res.json({
    app: "GulaSadar API",
    status: "online",
    message: "Backend berjalan dengan baik. Silakan akses endpoint /api/*",
    health: "/api/health",
    foods: "/api/foods",
    ai_status: "/api/ai/status",
  });
});

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.get("/api/ai/status", (_req, res) => res.json({ data: { enabled: true, provider: aiProvider() || "local", mode: aiEnabled() ? "cloud" : "local" } }));

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

app.post("/api/auth/logout", (req, res) => {
  if (req.token) {
    logoutToken(req.token);
  }
  res.json({ data: { message: "Berhasil keluar" } });
});

// --- Foods Endpoints ---
app.get("/api/foods", (req, res) => {
  res.json({ data: searchFoods(String(req.query.q ?? "")) });
});

app.get("/api/foods/:id", (req, res) => {
  const food = getFood(req.params.id);
  if (!food) return res.status(404).json({ error: "Makanan tidak ditemukan" });
  res.json({ data: food });
});

// --- Food Consumption Logs ---
app.post("/api/logs", (req, res) => {
  const { foodId, servings = 1 } = req.body ?? {};
  const n = Number(servings);
  if (typeof foodId !== "string" || !foodId)
    return res.status(400).json({ error: "foodId wajib diisi" });
  if (!Number.isFinite(n) || n <= 0 || n > 10)
    return res.status(400).json({ error: "servings harus 0-10" });

  const food = getFood(foodId);
  if (!food) return res.status(404).json({ error: "Makanan tidak ditemukan" });

  const sugar = Math.round(food.sugar_g * n * 10) / 10;
  const userId = req.user ? req.user.id : null;
  const info = db
    .query("INSERT INTO food_logs (user_id, food_id, servings, sugar_g) VALUES (?,?,?,?)")
    .run(userId, food.id, n, sugar);
  res.status(201).json({
    data: { id: Number(info.lastInsertRowid), food: food.name, servings: n, sugar_g: sugar },
  });
});

app.get("/api/logs/today", (req, res) => {
  const userId = req.user ? req.user.id : null;
  const logs = userId
    ? db
        .query(
          `SELECT l.id, f.name, l.servings, l.sugar_g, l.eaten_at
           FROM food_logs l JOIN foods f ON f.id = l.food_id
           WHERE date(l.eaten_at) = date('now','localtime') AND l.user_id = ?
           ORDER BY l.id DESC`
        )
        .all(userId)
    : db
        .query(
          `SELECT l.id, f.name, l.servings, l.sugar_g, l.eaten_at
           FROM food_logs l JOIN foods f ON f.id = l.food_id
           WHERE date(l.eaten_at) = date('now','localtime') AND l.user_id IS NULL
           ORDER BY l.id DESC`
        )
        .all();
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

app.delete("/api/logs/:id", (req, res) => {
  const userId = req.user ? req.user.id : null;
  const r = userId
    ? db.query("DELETE FROM food_logs WHERE id = ? AND (user_id = ? OR user_id IS NULL)").run(Number(req.params.id), userId)
    : db.query("DELETE FROM food_logs WHERE id = ?").run(Number(req.params.id));
  if (r.changes === 0) return res.status(404).json({ error: "Catatan tidak ditemukan" });
  res.json({ data: { deleted: true } });
});

app.get("/api/logs/stats", (req, res) => {
  const userId = req.user ? req.user.id : null;
  const rows = userId
    ? db
        .query(
          `SELECT date(eaten_at) AS day, ROUND(SUM(sugar_g),1) AS sugar_g
           FROM food_logs WHERE date(eaten_at) >= date('now','localtime','-6 days') AND user_id = ?
           GROUP BY day`
        )
        .all(userId)
    : db
        .query(
          `SELECT date(eaten_at) AS day, ROUND(SUM(sugar_g),1) AS sugar_g
           FROM food_logs WHERE date(eaten_at) >= date('now','localtime','-6 days') AND user_id IS NULL
           GROUP BY day`
        )
        .all();
  const byDay = Object.fromEntries(rows.map((r) => [r.day, r.sugar_g]));
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = db.query("SELECT date('now','localtime',?) AS d").get(`-${i} days`).d;
    days.push({ day: d, sugar_g: byDay[d] ?? 0 });
  }
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].sugar_g > 0) streak++;
    else if (i !== days.length - 1) break; // hari ini belum dicatat tidak memutus rangkaian
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
app.post("/api/glucose", (req, res) => {
  const err = validateGlucose(req.body ?? {});
  if (err) return res.status(400).json({ error: err });
  const value = Number(req.body.value);
  const c = classifyGlucose(value, req.body.context);
  const userId = req.user ? req.user.id : null;
  const info = db
    .query("INSERT INTO glucose_logs (user_id, value, context, category) VALUES (?,?,?,?)")
    .run(userId, value, req.body.context, c.category);
  res.status(201).json({
    data: { id: Number(info.lastInsertRowid), value, context: req.body.context, ...c },
  });
});

app.get("/api/glucose", (req, res) => {
  const userId = req.user ? req.user.id : null;
  const rows = userId
    ? db.query("SELECT * FROM glucose_logs WHERE user_id = ? ORDER BY id DESC LIMIT 30").all(userId)
    : db.query("SELECT * FROM glucose_logs WHERE user_id IS NULL ORDER BY id DESC LIMIT 30").all();
  res.json({ data: rows });
});

app.delete("/api/glucose/:id", (req, res) => {
  const userId = req.user ? req.user.id : null;
  const r = userId
    ? db.query("DELETE FROM glucose_logs WHERE id = ? AND (user_id = ? OR user_id IS NULL)").run(Number(req.params.id), userId)
    : db.query("DELETE FROM glucose_logs WHERE id = ?").run(Number(req.params.id));
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
  const { image, mediaType, filename, hint } = req.body ?? {};
  if (typeof image !== "string" || !image || !["image/jpeg", "image/png", "image/webp"].includes(mediaType))
    return res.status(400).json({ error: "Gambar (base64) dan mediaType jpeg/png/webp wajib diisi" });
  res.json({ data: await identifyFood(image, mediaType, filename, hint) });
});

export default app;

