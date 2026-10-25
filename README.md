# GulaSadar Backend

REST API untuk aplikasi edukasi pencegahan diabetes **GulaSadar** (Kenali gula di piringmu).
Repo frontend: *(isi link repo frontend di sini)*

## Teknologi
Express.js 5, SQLite lewat libSQL (file lokal saat pengembangan, [Turso](https://turso.tech) saat online). Dijalankan dengan Bun atau Node.js. Pengujian memakai `bun test` (coverage minimal 90%).

## Menjalankan secara lokal
Pastikan [Bun](https://bun.sh) terpasang.
```bash
git clone <URL-REPO-BACKEND>
cd gulasadar-backend
bun install
bun run test
bun run dev
```
API berjalan di `http://localhost:4000`. Cek `http://localhost:4000/api/health`.

## Konfigurasi (environment)
Salin `.env.example` bila perlu. Variabel yang dikenali:
| Variabel | Fungsi |
|---|---|
| `PORT` | Port server (default 4000) |
| `DB_PATH` | Lokasi file SQLite lokal (default `gulasadar.db`) |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Database online (Turso). Bila diisi, `DB_PATH` diabaikan. |
| `TZ_OFFSET_HOURS` | Zona waktu pencatatan harian (default 7 = WIB) |
| `CORS_ORIGIN` | Origin frontend yang diizinkan (default `*`) |
| `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` | Opsional, mengaktifkan chatbot AI dan identifikasi foto. Jangan commit key asli. |

## Endpoint
| Method | Path | Keterangan |
|---|---|---|
| GET | `/api/health` | Status server |
| GET | `/api/foods?q=` | Cari makanan |
| GET | `/api/foods/:id` | Detail makanan |
| POST | `/api/foods/identify` | Identifikasi makanan dari foto (butuh API key AI) |
| GET | `/api/logs/today` | Ringkasan dan catatan hari ini |
| GET | `/api/logs/stats` | Tren 7 hari dan rangkaian hari |
| POST | `/api/logs` | Catat konsumsi `{foodId, servings}` |
| DELETE | `/api/logs/:id` | Hapus catatan |
| POST | `/api/label` | Hitung gula dari label kemasan |
| POST | `/api/risk` | Skrining risiko diabetes (edukatif) |
| GET/POST | `/api/glucose` | Riwayat / catat gula darah |
| DELETE | `/api/glucose/:id` | Hapus catatan gula darah |
| GET | `/api/chat/status` | Mode chatbot (AI atau dasar) |
| POST | `/api/chat` | Tanya Sobat Gula `{message}` |

Prinsip: **AI mengenali, basis data menghitung.** ID makanan hasil AI yang tidak ada di basis data dibuang.

## Deploy online di Vercel + Turso
Vercel bersifat serverless (tidak punya disk persisten), jadi data disimpan di Turso, yaitu SQLite yang di-host.

1. **Buat database Turso** (gratis) di [turso.tech](https://turso.tech): Create Database, lalu salin **Database URL** (`libsql://...`) dan buat **Token** (Create Token).
2. **Push repo ini ke GitHub** lalu impor ke Vercel. Framework Preset: *Other*. Biarkan Build Command kosong. Root Directory: root repo.
3. Di Vercel, **Settings, Environment Variables**, tambahkan:
   | Nama | Nilai |
   |---|---|
   | `TURSO_DATABASE_URL` | URL database Turso |
   | `TURSO_AUTH_TOKEN` | Token Turso |
   | `CORS_ORIGIN` | URL frontend, contoh `https://nama-frontend.vercel.app` (tanpa garis miring di akhir) |
   | `GEMINI_API_KEY` | Opsional, untuk chatbot AI |
4. **Redeploy** (Deployments, titik tiga, Redeploy).
5. Uji: buka `https://URL-BACKEND/api/health`, harusnya muncul `{"status":"ok"}`. Tabel dan data makanan dibuat otomatis pada permintaan pertama.

## Deploy dengan Docker (alternatif, VPS)
```bash
CORS_ORIGIN=https://URL-FRONTEND docker compose up -d --build
```
Data SQLite tersimpan di volume `gula-data`.

## CI
`Jenkinsfile` menjalankan: install Bun, install dependency, test, lalu (cabang `main`) build image dan deploy.

> GulaSadar bersifat edukatif dan bukan alat diagnosis medis.
