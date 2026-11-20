import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildServer } from "../src/index.js";
import { makeVaultRoot, rmRetry, sleep, type BuiltServer } from "./helpers";

/** TC-05-039 · 静态托管与 SPA fallback（05-server §7.1） */

describe("TC-05 静态托管（05-server §7.1）", () => {
  let root: string;
  let built: BuiltServer | undefined;
  let distDir: string | undefined;

  afterEach(async () => {
    if (built) {
      built.state.watcher.stop();
      await built.app.close();
    }
    if (root) rmRetry(root);
    if (distDir && distDir !== path.join(process.cwd(), "apps")) rmRetry(distDir);
  });

  it("TC-05-039: / 与 /p/web 返回 index.html，缺失静态文件 404，API 404 走信封（P0）", async () => {
    root = makeVaultRoot("pm-server-static-");
    distDir = path.join(root, "web-dist");
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, "index.html"), "<!doctype html><html><body>PM Web</body></html>", "utf8");
    fs.mkdirSync(path.join(distDir, "assets"), { recursive: true });
    fs.writeFileSync(path.join(distDir, "assets", "style.css"), "body{color:red}", "utf8");

    const res = await buildServer({ root, webDist: distDir, pingIntervalMs: 0 });
    if (!res.ok) throw new Error(res.error.message);
    built = res.value;

    // 1) GET / → index.html（index:false + SPA fallback）
    const home = await built.app.inject({ method: "GET", url: "/" });
    expect(home.statusCode).toBe(200);
    expect(home.headers["content-type"]).toContain("text/html");
    expect(home.body).toContain("PM Web");

    // 2) GET /p/web（无扩展名路由）→ SPA fallback index.html
    const spa = await built.app.inject({ method: "GET", url: "/p/web" });
    expect(spa.statusCode).toBe(200);
    expect(spa.body).toContain("PM Web");

    // 3) GET /nonexistent.css（带扩展名但缺失）→ 404
    const missing = await built.app.inject({ method: "GET", url: "/nonexistent.css" });
    expect(missing.statusCode).toBe(404);

    // 4) 存在的静态文件正常返回
    const css = await built.app.inject({ method: "GET", url: "/assets/style.css" });
    expect(css.statusCode).toBe(200);
    expect(css.body).toContain("color:red");

    // 5) API 未知路径 → 404 信封（非 HTML）
    const apiMiss = await built.app.inject({ method: "GET", url: "/api/nope" });
    expect(apiMiss.statusCode).toBe(404);
    expect(JSON.parse(apiMiss.body).error.code).toBe("E_NOT_FOUND");
  });

  it("apps/web/dist 不存在（webDist:null）→ 根路径 404，不托管", async () => {
    root = makeVaultRoot("pm-server-nostatic-");
    const res = await buildServer({ root, webDist: null, pingIntervalMs: 0 });
    if (!res.ok) throw new Error(res.error.message);
    built = res.value;
    const home = await built.app.inject({ method: "GET", url: "/" });
    expect(home.statusCode).toBe(404);
  });
});
