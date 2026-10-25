import fs from "fs";
import nodePath from "path";

// Akses database SQLite lewat libSQL. Lokal: file SQLite biasa. Online (Vercel): Turso (SQLite yang di-host).
// Turso (online) memakai klien web (HTTP, tanpa modul native) agar andal di serverless; lokal memakai klien file.
const remote = Boolean(process.env.TURSO_DATABASE_URL);
const { createClient } = await import(remote ? "@libsql/client/web" : "@libsql/client");

const rawPath = process.env.DB_PATH || "gulasadar.db";
if (!remote && rawPath !== ":memory:") {
  const cleanPath = rawPath.startsWith("file:") ? rawPath.slice(5) : rawPath;
  const dir = nodePath.dirname(cleanPath);
  if (dir && dir !== "." && dir !== "/") {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
  }
}

const fileUrl = rawPath === ":memory:" ? ":memory:" : (rawPath.startsWith("file:") ? rawPath : `file:${rawPath}`);
const client = createClient({
  url: process.env.TURSO_DATABASE_URL || fileUrl,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Zona waktu tetap (default WIB, UTC+7) agar "hari ini" konsisten di server mana pun, termasuk server UTC.
const offset = Number(process.env.TZ_OFFSET_HOURS ?? 7);
export const TZ = `${offset >= 0 ? "+" : ""}${offset} hours`;
export const NOW = `datetime('now','${TZ}')`;
export const TODAY = `date('now','${TZ}')`;

export async function all(sql, args = []) {
  const res = await client.execute({ sql, args });
  return res.rows.map((r) => ({ ...r }));
}

export async function get(sql, args = []) {
  return (await all(sql, args))[0] ?? null;
}

export async function run(sql, args = []) {
  const res = await client.execute({ sql, args });
  return { lastInsertRowid: Number(res.lastInsertRowid ?? 0), changes: res.rowsAffected };
}

export const batch = (statements) => client.batch(statements, "write");

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (${NOW})
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (${NOW}),
    expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS foods (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, portion TEXT NOT NULL,
    sugar_g REAL NOT NULL, carbs_g REAL NOT NULL, category TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS food_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    food_id TEXT NOT NULL REFERENCES foods(id),
    servings REAL NOT NULL DEFAULT 1,
    sugar_g REAL NOT NULL,
    eaten_at TEXT NOT NULL DEFAULT (${NOW})
  )`,
  `CREATE TABLE IF NOT EXISTS glucose_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    value REAL NOT NULL, context TEXT NOT NULL, category TEXT NOT NULL,
    measured_at TEXT NOT NULL DEFAULT (${NOW})
  )`,
];

let ready;
/** Membuat tabel dan mengisi data makanan sekali per proses/instance. */
export function initDb(seed = []) {
  ready ??= (async () => {
    await batch([...SCHEMA, ...seed]);
    try {
      await client.execute("ALTER TABLE food_logs ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE");
    } catch {}
    try {
      await client.execute("ALTER TABLE glucose_logs ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE");
    } catch {}
  })();
  return ready;
}

export default { all, get, run, batch, initDb, client };
