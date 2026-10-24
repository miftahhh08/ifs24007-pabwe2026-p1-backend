# GulaSadar Backend

REST API untuk aplikasi edukasi pencegahan diabetes **GulaSadar** (Kenali gula di piringmu).
Repo frontend: *(isi link repo frontend di sini)*

## Teknologi
Express.js, SQLite (`bun:sqlite`), dijalankan dengan Bun. Pengujian memakai `bun test` (coverage minimal 90%).

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
| `DB_PATH` | Lokasi file SQLite (default `gulasadar.db`) |
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

## Deploy dengan Docker
```bash
CORS_ORIGIN=https://URL-FRONTEND docker compose up -d --build
```
Data SQLite tersimpan di volume `gula-data`.

## CI
`Jenkinsfile` menjalankan: install Bun, install dependency, test, lalu (cabang `main`) build image dan deploy.

> GulaSadar bersifat edukatif dan bukan alat diagnosis medis.
