import crypto from "crypto";
import db, { TZ } from "./db.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function hashPassword(password) {
  if (typeof Bun !== "undefined" && Bun?.password?.hash) {
    return await Bun.password.hash(password);
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt}:${derivedKey.toString("hex")}`;
}

async function verifyPassword(password, hash) {
  if (typeof hash === "string" && hash.startsWith("scrypt:")) {
    const [, salt, key] = hash.split(":");
    const derivedKey = crypto.scryptSync(password, salt, 64);
    return crypto.timingSafeEqual(Buffer.from(key, "hex"), derivedKey);
  }
  if (typeof Bun !== "undefined" && Bun?.password?.verify) {
    try {
      return await Bun.password.verify(password, hash);
    } catch {
      return false;
    }
  }
  return false;
}

export function validateRegister(body = {}) {
  const { name, email, password } = body;
  if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 100) {
    return "Nama lengkap wajib diisi (2-100 karakter)";
  }
  if (typeof email !== "string" || !EMAIL_REGEX.test(email.trim()) || email.trim().length > 150) {
    return "Format email tidak valid";
  }
  if (typeof password !== "string" || password.length < 6 || password.length > 100) {
    return "Kata sandi minimal 6 karakter";
  }
  return null;
}

export function validateLogin(body = {}) {
  const { email, password } = body;
  if (typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
    return "Format email tidak valid";
  }
  if (typeof password !== "string" || !password) {
    return "Kata sandi wajib diisi";
  }
  return null;
}

export async function registerUser({ name, email, password }) {
  const cleanName = name.trim();
  const cleanEmail = email.trim().toLowerCase();

  const existing = await db.get("SELECT id FROM users WHERE LOWER(email) = LOWER(?)", [cleanEmail]);
  if (existing) {
    return { error: "Email sudah terdaftar. Silakan gunakan email lain atau masuk.", status: 409 };
  }

  const passwordHash = await hashPassword(password);
  const info = await db.run(
    "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
    [cleanName, cleanEmail, passwordHash]
  );

  const userId = Number(info.lastInsertRowid);
  const token = crypto.randomUUID();

  await db.run(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '${TZ}', '+30 days'))`,
    [token, userId]
  );

  return {
    data: {
      user: { id: userId, name: cleanName, email: cleanEmail },
      token,
    },
  };
}

export async function loginUser({ email, password }) {
  const cleanEmail = email.trim().toLowerCase();
  const user = await db.get("SELECT * FROM users WHERE LOWER(email) = LOWER(?)", [cleanEmail]);

  if (!user) {
    return { error: "Email atau kata sandi tidak cocok", status: 401 };
  }

  const match = await verifyPassword(password, user.password_hash);
  if (!match) {
    return { error: "Email atau kata sandi tidak cocok", status: 401 };
  }

  const token = crypto.randomUUID();
  await db.run(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '${TZ}', '+30 days'))`,
    [token, user.id]
  );

  return {
    data: {
      user: { id: user.id, name: user.name, email: user.email },
      token,
    },
  };
}

export async function getUserByToken(token) {
  if (!token || typeof token !== "string") return null;
  const row = await db.get(
    `SELECT u.id, u.name, u.email
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND datetime(s.expires_at) > datetime('now', '${TZ}')`,
    [token]
  );
  return row ?? null;
}

export async function logoutToken(token) {
  if (!token || typeof token !== "string") return;
  await db.run("DELETE FROM sessions WHERE token = ?", [token]);
}

export async function authMiddleware(req, _res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    const user = await getUserByToken(token);
    if (user) {
      req.user = user;
      req.token = token;
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Akses ditolak. Silakan masuk terlebih dahulu." });
  }
  next();
}
