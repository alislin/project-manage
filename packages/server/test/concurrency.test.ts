import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { runExclusive } from "@pm/core";
import {
  makeVaultRoot,
  writePmFile,
  readPmFile,
  rmRetry,
  buildTestServer,
  teardownServer,
  today,
  shiftDays,
  PROJECT_MD_WEB,
  reqMd,
  taskMd,
  type BuiltServer,
} from "./helpers";

/**
 * 并发写保护（review-m1-r2 O1 / 05-server §6.2 / 02-core §4.7.1）：
 * - runExclusive 原子挂接（「读取链尾+替换链尾」同步完成）消除 TOCTOU，禁止字面「先 get 再 await」；
 * - 服务端 PATCH 同路径并发请求严格串行：一次生效，其余按序检测到冲突/非法流转，不丢更新。
 */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("S5 并发写保护（review-m1-r2 O1）", () => {
  let root: string;
  let vault: string;
  let built: BuiltServer;

  afterEach(async () => {
    if (built) await teardownServer(built);
    if (root) rmRetry(root);
  });

  it("O1-1: runExclusive 同路径异步任务严格串行（链尾原子挂接，无 TOCTOU）", async () => {
    const order: string[] = [];
    const p1 = runExclusive("same.md", async () => {
      order.push("1-start");
      await sleep(40);
      order.push("1-end");
      return 1;
    });
    const p2 = runExclusive("same.md", async () => {
      order.push("2-start");
      await sleep(10);
      order.push("2-end");
      return 2;
    });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(1);
    expect(r2).toBe(2);
    // 若存在「先 get 再 await」的 TOCTOU，2-start 会插在 1-end 之前并发执行
    expect(order).toEqual(["1-start", "1-end", "2-start", "2-end"]);
  });

  it("O1-2: runExclusive 不同路径互不阻塞", async () => {
    const order: string[] = [];
    const p1 = runExclusive("a.md", async () => {
      order.push("a-start");
      await sleep(40);
      order.push("a-end");
    });
    const p2 = runExclusive("b.md", async () => {
      order.push("b-start");
    });
    await Promise.all([p1, p2]);
    expect(order.indexOf("b-start")).toBeLessThan(order.indexOf("a-end")); // b 不等 a
  });

  it("O1-3: runExclusive fn 抛异常不污染链尾（后续排队者正常执行）", async () => {
    const first = runExclusive("err.md", async () => {
      throw new Error("boom");
    });
    await expect(first).rejects.toThrow("boom");
    const result = await runExclusive("err.md", () => "ok");
    expect(result).toBe("ok");
  });

  it("O1-4: 两个并发 PATCH 同路径（同基准 M0）串行化——一成一拒，终态一致（TC-05-016/018 并发流程）", async () => {
    root = makeVaultRoot("pm-server-race-");
    vault = path.join(root, "vault");
    writePmFile(vault, "projects/web/project.md", PROJECT_MD_WEB);
    writePmFile(vault, "projects/web/requirements/REQ-web-001.md", reqMd("REQ-web-001", "pool"));
    built = await buildTestServer(root);

    const list = await built.app.inject({ method: "GET", url: "/api/projects/web/requirements" });
    const m0 = (JSON.parse(list.body) as { data: { requirements: Array<{ id: string; mtimeMs: number }> } }).data.requirements[0].mtimeMs;

    // 同一请求体并发发出：首个成功流转，第二个在锁内按新状态检测 → 非法流转 409
    const payload = { status: "reviewing", expectedMtimeMs: m0 };
    const [r1, r2] = await Promise.all([
      built.app.inject({ method: "PATCH", url: "/api/requirements/REQ-web-001", payload }),
      built.app.inject({ method: "PATCH", url: "/api/requirements/REQ-web-001", payload }),
    ]);
    const statuses = [r1.statusCode, r2.statusCode].sort();
    expect(statuses).toEqual([200, 409]);
    const failed = r1.statusCode === 409 ? r1 : r2;
    expect(JSON.parse(failed.body).error.code).toBe("E_INVALID_TRANSITION");

    // 终态唯一且正确：无丢更新/无重复写入
    const detail = await built.app.inject({ method: "GET", url: "/api/requirements/REQ-web-001" });
    expect(JSON.parse(detail.body).data.requirement.status).toBe("reviewing");
    const content = readPmFile(vault, "projects/web/requirements/REQ-web-001.md");
    expect(content).toContain("status: reviewing");
    expect(content).toMatch(new RegExp(`updated: ['"]${today()}['"]`));
  });

  it("O1-5: 并发 PATCH 排队期间外部基准过期 → 409 E_CONFLICT（05-server §6.1 序列化语义）", async () => {
    root = makeVaultRoot("pm-server-race-conflict-");
    vault = path.join(root, "vault");
    writePmFile(vault, "projects/web/project.md", PROJECT_MD_WEB);
    writePmFile(vault, "projects/web/requirements/REQ-web-001.md", reqMd("REQ-web-001", "reviewing"));
    writePmFile(vault, "projects/web/tasks/TASK-web-001.md", taskMd("TASK-web-001", "todo", shiftDays(10)));
    built = await buildTestServer(root);

    const m0 = (JSON.parse((await built.app.inject({ method: "GET", url: "/api/projects/web/tasks" })).body) as {
      data: { tasks: Array<{ id: string; mtimeMs: number }> };
    }).data.tasks[0].mtimeMs;

    // 请求 A：todo→doing（先入锁写入，mtime 变更）
    // 请求 B：doing→done，但携带过期基准 M0 → 锁内冲突预检 409 E_CONFLICT（§6.1 步骤 2–3）
    const resA = built.app.inject({ method: "PATCH", url: "/api/tasks/TASK-web-001", payload: { status: "doing" } });
    await sleep(10); // 保证 A 先挂接锁链（B 串行排在 A 之后）
    const resB = built.app.inject({
      method: "PATCH",
      url: "/api/tasks/TASK-web-001",
      payload: { status: "done", expectedMtimeMs: m0 },
    });
    const [ra, rb] = await Promise.all([resA, resB]);
    expect(ra.statusCode).toBe(200);
    expect(rb.statusCode).toBe(409);
    const body = JSON.parse(rb.body) as { error: { code: string; expectedMtimeMs?: number; currentMtimeMs?: number } };
    expect(body.error.code).toBe("E_CONFLICT");
    expect(body.error.expectedMtimeMs).toBe(m0);
    expect(typeof body.error.currentMtimeMs).toBe("number");

    // 文件终态：A 的写入保留（doing），B 未盲覆盖
    expect(readPmFile(vault, "projects/web/tasks/TASK-web-001.md")).toContain("status: doing");
  });
});
