import { test, expect, describe, beforeAll, afterAll } from "bun:test";

process.env.DB_PATH = ":memory:";
const { default: app } = await import("../src/app.js");
const { trafficLight, searchFoods, getFood, DAILY_LIMIT_G } = await import("../src/foods.js");

let server, base;
beforeAll(() => {
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());

const post = (body) =>
  fetch(`${base}/api/logs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("logika makanan", () => {
  test("trafficLight mengikuti batas hijau/kuning/merah", () => {
    expect(trafficLight(0)).toBe("hijau");
    expect(trafficLight(5)).toBe("hijau");
    expect(trafficLight(5.1)).toBe("kuning");
    expect(trafficLight(15)).toBe("kuning");
    expect(trafficLight(15.1)).toBe("merah");
  });

  test("searchFoods tanpa kata kunci mengembalikan semua makanan", () => {
    expect(searchFoods().length).toBeGreaterThanOrEqual(10);
    expect(searchFoods("tidak-ada-makanan-ini")).toEqual([]);
  });

  test("getFood", () => {
    expect(getFood("bakso").name).toBe("Bakso");
    expect(getFood("xxx")).toBeNull();
    expect(DAILY_LIMIT_G).toBe(50);
  });
});

describe("API makanan", () => {
  test("health check", async () => {
    const r = await fetch(`${base}/api/health`);
    expect((await r.json()).status).toBe("ok");
  });

  test("cari makanan lewat alias", async () => {
    const { data } = await (await fetch(`${base}/api/foods?q=es teh`)).json();
    expect(data[0].id).toBe("es-teh-manis");
    expect(data[0].light).toBe("merah");
  });

  test("daftar penuh jika q kosong", async () => {
    const { data } = await (await fetch(`${base}/api/foods`)).json();
    expect(data.length).toBeGreaterThanOrEqual(10);
  });

  test("detail makanan dan 404", async () => {
    const ok = await fetch(`${base}/api/foods/bakso`);
    expect(ok.status).toBe(200);
    expect((await ok.json()).data.name).toBe("Bakso");
    const missing = await fetch(`${base}/api/foods/tidak-ada`);
    expect(missing.status).toBe(404);
  });
});

describe("API catatan konsumsi", () => {
  test("catat konsumsi, hitung total, lalu hapus", async () => {
    const created = await post({ foodId: "es-teh-manis", servings: 2 });
    expect(created.status).toBe(201);
    const { data } = await created.json();
    expect(data.sugar_g).toBe(40);

    const today = await (await fetch(`${base}/api/logs/today`)).json();
    expect(today.data.total_sugar_g).toBe(40);
    expect(today.data.percent).toBe(80);
    expect(today.data.logs.length).toBe(1);

    const del = await fetch(`${base}/api/logs/${data.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    const after = await (await fetch(`${base}/api/logs/today`)).json();
    expect(after.data.total_sugar_g).toBe(0);
  });

  test("servings default 1 jika tidak dikirim", async () => {
    const r = await post({ foodId: "soda" });
    expect((await r.json()).data.sugar_g).toBe(35);
  });

  test("foodId kosong ditolak (400)", async () => {
    expect((await post({ servings: 1 })).status).toBe(400);
  });

  test("body kosong ditolak (400)", async () => {
    const r = await fetch(`${base}/api/logs`, { method: "POST" });
    expect(r.status).toBe(400);
  });

  test("makanan tidak dikenal ditolak (404)", async () => {
    expect((await post({ foodId: "tidak-ada", servings: 1 })).status).toBe(404);
  });

  test("servings di luar rentang ditolak (400)", async () => {
    expect((await post({ foodId: "soda", servings: 99 })).status).toBe(400);
    expect((await post({ foodId: "soda", servings: 0 })).status).toBe(400);
    expect((await post({ foodId: "soda", servings: "abc" })).status).toBe(400);
  });

  test("hapus catatan yang tidak ada (404)", async () => {
    const r = await fetch(`${base}/api/logs/999999`, { method: "DELETE" });
    expect(r.status).toBe(404);
  });
});
