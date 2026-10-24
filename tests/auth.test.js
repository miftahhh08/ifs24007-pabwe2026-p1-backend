import { test, expect, describe, beforeAll, afterAll } from "bun:test";

process.env.DB_PATH = ":memory:";
const { default: app } = await import("../src/app.js");

let server, base;
beforeAll(() => {
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());

const register = (body) =>
  fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const login = (body) =>
  fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const getMe = (token) =>
  fetch(`${base}/api/auth/me`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

const logout = (token) =>
  fetch(`${base}/api/auth/logout`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

describe("Autentikasi Pengguna", () => {
  test("validasi pendaftaran (nama, email, kata sandi)", async () => {
    // nama terlalu pendek
    const r1 = await register({ name: "A", email: "user@test.com", password: "password123" });
    expect(r1.status).toBe(400);

    // email tidak valid
    const r2 = await register({ name: "Budi Santoso", email: "budi-bukan-email", password: "password123" });
    expect(r2.status).toBe(400);

    // password kurang dari 6 karakter
    const r3 = await register({ name: "Budi Santoso", email: "budi@test.com", password: "123" });
    expect(r3.status).toBe(400);
  });

  test("berhasil mendaftar pengguna baru dan mendapatkan token", async () => {
    const res = await register({
      name: "Miftahul Jannah",
      email: "miftah@del.ac.id",
      password: "password123",
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.user.name).toBe("Miftahul Jannah");
    expect(body.data.user.email).toBe("miftah@del.ac.id");
    expect(body.data.token).toBeDefined();
  });

  test("menolak pendaftaran email yang sudah ada (409)", async () => {
    const res = await register({
      name: "Miftah Duplikat",
      email: "miftah@del.ac.id",
      password: "password123",
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/Email sudah terdaftar/);
  });

  test("login berhasil dengan kredensial benar", async () => {
    const res = await login({
      email: "miftah@del.ac.id",
      password: "password123",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.user.email).toBe("miftah@del.ac.id");
    expect(body.data.token).toBeDefined();
  });

  test("login gagal jika kata sandi salah atau email tidak ada", async () => {
    const r1 = await login({ email: "miftah@del.ac.id", password: "wrongpassword" });
    expect(r1.status).toBe(401);

    const r2 = await login({ email: "tidakada@del.ac.id", password: "password123" });
    expect(r2.status).toBe(401);
  });

  test("cek profil pengguna via /api/auth/me", async () => {
    // Login untuk mendapatkan token
    const loginRes = await login({ email: "miftah@del.ac.id", password: "password123" });
    const { token } = (await loginRes.json()).data;

    // Akses profil dengan token
    const meRes = await getMe(token);
    expect(meRes.status).toBe(200);
    const meBody = await meRes.json();
    expect(meBody.data.user.email).toBe("miftah@del.ac.id");

    // Akses tanpa token -> 401
    const noTokenRes = await getMe(null);
    expect(noTokenRes.status).toBe(401);

    // Logout
    const logoutRes = await logout(token);
    expect(logoutRes.status).toBe(200);

    // Setelah logout, token sudah hangus
    const afterLogoutRes = await getMe(token);
    expect(afterLogoutRes.status).toBe(401);
  });

  test("isolasi data catatan antar pengguna", async () => {
    // Daftar user A
    const uA = (
      await (
        await register({ name: "User A", email: "usera@test.com", password: "password123" })
      ).json()
    ).data;

    // Daftar user B
    const uB = (
      await (
        await register({ name: "User B", email: "userb@test.com", password: "password123" })
      ).json()
    ).data;

    // User A mencatat es teh manis
    await fetch(`${base}/api/logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${uA.token}` },
      body: JSON.stringify({ foodId: "es-teh-manis", servings: 1 }),
    });

    // User A cek catatan hari ini -> ada 1
    const logsA = await (
      await fetch(`${base}/api/logs/today`, {
        headers: { Authorization: `Bearer ${uA.token}` },
      })
    ).json();
    expect(logsA.data.logs.length).toBe(1);
    expect(logsA.data.total_sugar_g).toBe(20);

    // User B cek catatan hari ini -> kosong (0)
    const logsB = await (
      await fetch(`${base}/api/logs/today`, {
        headers: { Authorization: `Bearer ${uB.token}` },
      })
    ).json();
    expect(logsB.data.logs.length).toBe(0);
    expect(logsB.data.total_sugar_g).toBe(0);

    // User A mencatat gula darah
    const postGlucRes = await fetch(`${base}/api/glucose`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${uA.token}` },
      body: JSON.stringify({ value: 110, context: "puasa" }),
    });
    expect(postGlucRes.status).toBe(201);


    // User A punya 1 catatan gula darah
    const glucA = await (
      await fetch(`${base}/api/glucose`, {
        headers: { Authorization: `Bearer ${uA.token}` },
      })
    ).json();
    expect(glucA.data.length).toBe(1);

    // User B punya 0 catatan gula darah
    const glucB = await (
      await fetch(`${base}/api/glucose`, {
        headers: { Authorization: `Bearer ${uB.token}` },
      })
    ).json();
    expect(glucB.data.length).toBe(0);
  });
});
