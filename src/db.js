import { Database } from "bun:sqlite";

const db = new Database(process.env.DB_PATH || "gulasadar.db", { create: true });
db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA foreign_keys = ON");

db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
)`);

db.run(`CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  expires_at TEXT NOT NULL
)`);

db.run(`CREATE TABLE IF NOT EXISTS foods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  portion TEXT NOT NULL,
  sugar_g REAL NOT NULL,
  carbs_g REAL NOT NULL,
  category TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT ''
)`);

db.run(`CREATE TABLE IF NOT EXISTS food_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  food_id TEXT NOT NULL REFERENCES foods(id),
  servings REAL NOT NULL DEFAULT 1,
  sugar_g REAL NOT NULL,
  eaten_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
)`);

db.run(`CREATE TABLE IF NOT EXISTS glucose_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  value REAL NOT NULL,
  context TEXT NOT NULL,
  category TEXT NOT NULL,
  measured_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
)`);

try {
  db.run("ALTER TABLE food_logs ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE");
} catch {}

try {
  db.run("ALTER TABLE glucose_logs ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE");
} catch {}

export default db;

