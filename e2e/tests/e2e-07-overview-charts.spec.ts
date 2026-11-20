/**
 * E2E-07 进度总览（用户旅程：造数后进入进度总览 Tab → 四张图表容器渲染 → 全程无控制台错误）。
 * 验收点：环形/漏斗/趋势/模块分布四张图表容器渲染且无控制台错误。
 */
import { expect, test } from "@playwright/test";
import { e2eApi, localToday } from "../support/api";

const RUN = Date.now().toString(36);

test("E2E-07 进度总览四张图表容器渲染且无控制台错误", async ({ page }) => {
  const slug = `e2e07-${RUN}`;

  // 造数：1 需求（accepted）、2 任务（一完成一进行）→ 四图均为非空态
  await e2eApi.createProject(slug, "E2E-07 进度总览项目");
  const req = await e2eApi.createRequirement(slug, "进度总览宿主需求", { module: "core", priority: "P1" });
  await e2eApi.patchRequirement(req.id, "reviewing");
  await e2eApi.patchRequirement(req.id, "accepted");
  const t1 = (await e2eApi.createTask(slug, req.id, "已完成任务", { due: localToday(-1) })).created.id;
  await e2eApi.patchTask(t1, "done");
  await e2eApi.createTask(slug, req.id, "进行中任务", { due: localToday(2), priority: "P2" });

  // 收集控制台错误（console.error / 未捕获异常）
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`[console.error] ${msg.text()}`);
  });
  page.on("pageerror", (err) => consoleErrors.push(`[pageerror] ${err.message}`));

  await page.goto(`/p/${slug}/overview`);

  // 四张图表容器渲染
  for (const cell of ["ring", "funnel", "trend", "module"]) {
    await expect(page.getByTestId(`overview-cell-${cell}`)).toBeVisible();
    await expect(page.getByTestId(`overview-cell-${cell}`).getByTestId("chart-canvas")).toBeVisible();
  }
  await expect(page.getByTestId("overview-cell-trend")).toContainText("任务累计完成趋势");

  // echarts 实例初始化：4 个非空态 canvas 容器
  await expect(page.locator('[data-testid="chart-canvas"]')).toHaveCount(4);
  await expect(page.locator('[data-testid="chart-empty"]')).toHaveCount(0);

  // 汇总卡片联动（数据已收敛）
  await expect(page.locator(".pm-overview__stat-value").first()).toBeVisible();

  // 全程无控制台错误
  expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
});
