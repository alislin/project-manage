/**
 * E2E-10 深链与编码（用户旅程：深链直达子页 → 中文标题 UTF-8 显示 → 未知路径回首页）。
 * 验收点：深链直达任务列表；未知路径重定向回首页卡片墙；中文标题 UTF-8 正确显示。
 */
import { expect, test } from "@playwright/test";
import { e2eApi, localToday } from "../support/api";
import { BASE_URL } from "../support/paths";

const RUN = Date.now().toString(36);

test("E2E-10 深链直达、未知路径回首页、中文标题 UTF-8 显示", async ({ page }) => {
  const slug = `e2e10-${RUN}`;
  const projectName = "中文标题验收项目";
  const reqTitle = "中文需求卡片：交付验收";
  await e2eApi.createProject(slug, projectName);
  const req = await e2eApi.createRequirement(slug, reqTitle, { module: "core" });
  await e2eApi.patchRequirement(req.id, "reviewing");
  await e2eApi.patchRequirement(req.id, "accepted");
  const task = await e2eApi.createTask(slug, req.id, "中文任务卡片", { due: localToday(1) });
  const taskId = task.created.id;

  // 深链直达任务列表（服务端 SPA fallback → 前端路由命中 project-tasks-list）
  await page.goto(`/p/${slug}/tasks-list`);
  await expect(page.getByTestId("tab-tasks-list")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId(`task-row-${taskId}`)).toBeVisible();
  await expect(page.getByTestId(`task-row-${taskId}`)).toContainText("中文任务卡片");

  // 深链直达进度总览
  await page.goto(`/p/${slug}/overview`);
  await expect(page.getByTestId("tab-overview")).toHaveAttribute("aria-selected", "true");

  // 项目工作台中文标题 UTF-8
  await page.goto(`/p/${slug}`);
  await expect(page.locator("h1.pm-project__name")).toHaveText(projectName);

  // 首页卡片墙中文标题
  await page.goto("/");
  const card = page.locator(`[data-testid="project-card"][data-slug="${slug}"]`);
  await expect(card).toContainText(projectName);

  // 未知路径回首页（前端路由兜底 redirect → /）
  await page.goto("/definitely-not-a-route-e2e10");
  await expect(page).toHaveURL(`${BASE_URL}/`);
  await expect(page.locator(".pm-home__title")).toHaveText("项目总览");
  await expect(page).toHaveTitle("PM 台账");
});
