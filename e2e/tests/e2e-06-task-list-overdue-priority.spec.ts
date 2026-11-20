/**
 * E2E-06 任务列表（用户旅程：打开任务列表 → 逾期任务行/due 日期标红 → 优先级筛选 → 重置）。
 * 验收点：逾期行标红（pm-tasklist__row--overdue + pm-date--overdue）；priority 筛选只保留匹配行。
 */
import { expect, test } from "@playwright/test";
import { e2eApi, localToday } from "../support/api";

const RUN = Date.now().toString(36);

test("E2E-06 任务列表逾期标红与 priority 筛选", async ({ page }) => {
  const slug = `e2e06-${RUN}`;
  await e2eApi.createProject(slug, "E2E-06 任务列表项目");
  const req = await e2eApi.createRequirement(slug, "任务列表宿主需求");
  await e2eApi.patchRequirement(req.id, "reviewing");
  await e2eApi.patchRequirement(req.id, "accepted");

  const p0Overdue = (await e2eApi.createTask(slug, req.id, "P0 逾期任务", { priority: "P0", due: localToday(-1) })).created.id;
  const p1Overdue = (await e2eApi.createTask(slug, req.id, "P1 逾期任务", { priority: "P1", due: localToday(-2) })).created.id;
  const p2Future = (await e2eApi.createTask(slug, req.id, "P2 未逾期任务", { priority: "P2", due: localToday(2) })).created.id;

  await page.goto(`/p/${slug}/tasks-list`);
  const rowP0 = page.getByTestId(`task-row-${p0Overdue}`);
  const rowP1 = page.getByTestId(`task-row-${p1Overdue}`);
  const rowP2 = page.getByTestId(`task-row-${p2Future}`);
  await expect(rowP0).toBeVisible();
  await expect(rowP1).toBeVisible();
  await expect(rowP2).toBeVisible();

  // 逾期行标红：行级 class + due 单元格 class（02-core §2.4 口径：todo/doing && due < today）
  await expect(rowP0).toHaveClass(/pm-tasklist__row--overdue/);
  await expect(rowP1).toHaveClass(/pm-tasklist__row--overdue/);
  await expect(rowP0.locator(".pm-date--overdue")).toBeVisible();
  await expect(rowP1.locator(".pm-date--overdue")).toBeVisible();
  // 未逾期行无标红
  await expect(rowP2).not.toHaveClass(/pm-tasklist__row--overdue/);
  await expect(rowP2.locator(".pm-date--overdue")).toHaveCount(0);

  // priority 筛选：仅 P0 行保留
  await page.getByTestId("filter-priority-P0").check();
  await expect(rowP0).toBeVisible();
  await expect(rowP1).toBeHidden();
  await expect(rowP2).toBeHidden();

  // 重置筛选后全部恢复
  await page.getByTestId("filter-reset").click();
  await expect(rowP1).toBeVisible();
  await expect(rowP2).toBeVisible();
});
