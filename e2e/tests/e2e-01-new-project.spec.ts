/**
 * E2E-01 新建项目（用户旅程：首页入口 → 模态表单 → 提交 → 跳转工作台 → 卡片墙出现）。
 * 验收点：表单提交后项目卡片出现在卡片墙，且自动跳转项目工作台 /p/:slug（需求池 Tab）。
 */
import { expect, test } from "@playwright/test";

/** 本文件运行标识：保证 slug 在同一 vault 内唯一（vault 每次运行由 globalSetup 重建） */
const RUN = Date.now().toString(36);

test("E2E-01 新建项目表单提交后卡片墙出现并跳转工作台", async ({ page }) => {
  const slug = `e2e01-${RUN}`;
  const name = "端到端新建项目";

  // 首页（S12 首测时 vault 为空 → 空态引导文案可见）
  await page.goto("/");
  await expect(page.locator(".pm-home__title")).toHaveText("项目总览");
  await expect(page.getByTestId("nav-new-project")).toBeVisible();

  // 打开新建项目模态表单
  await page.getByTestId("nav-new-project").click();
  const dialog = page.getByTestId("new-project-dialog");
  await expect(dialog).toBeVisible();

  // 填写并提交（slug 显式填写，URL 断言稳定）
  await page.locator("#np-name").fill(name);
  await page.locator("#np-slug").fill(slug);
  await page.getByTestId("np-submit").click();

  // 跳转工作台：/p/<slug>（子路由默认重定向需求池 Tab /p/<slug>/requirements），页头为项目名
  await expect(page).toHaveURL(new RegExp(`/p/${slug}/requirements$`));
  await expect(page.getByTestId("tab-requirements")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("h1.pm-project__name")).toHaveText(name);

  // 卡片墙出现新项目卡片
  await page.goto("/");
  const card = page.locator(`[data-testid="project-card"][data-slug="${slug}"]`);
  await expect(card).toBeVisible();
  await expect(card).toContainText(name);
});
