/**
 * E2E-02 需求池流转（用户旅程：需求创建入池 → 打开需求池 → 拖拽 Pool→Reviewing → 卡片迁移 → 磁盘收敛）。
 * 验收点：pool 列出现需求卡片；拖拽到 reviewing 列后卡片迁移；磁盘 frontmatter status: "reviewing"。
 */
import { expect, test } from "@playwright/test";
import { e2eApi } from "../support/api";
import { dragCardTo } from "../support/dnd";
import { requirementFile } from "../support/paths";
import { expectField } from "../support/vault-files";

const RUN = Date.now().toString(36);

test("E2E-02 需求池创建卡片入 pool 列，拖拽到 reviewing 列后卡片迁移且磁盘 status 收敛", async ({ page }) => {
  const slug = `e2e02-${RUN}`;
  await e2eApi.createProject(slug, "E2E-02 需求池项目");
  const req = await e2eApi.createRequirement(slug, "需求池流转验收", { module: "core", priority: "P1" });
  const reqId = req.id;

  await page.goto(`/p/${slug}/requirements`);
  const card = page.locator(`[data-testid="req-card"][data-id="${reqId}"]`);
  await expect(card).toBeVisible();

  // 新建需求卡片出现在 pool 列
  const poolLane = page.getByTestId("req-lane-pool");
  const reviewingLane = page.getByTestId("req-lane-reviewing");
  await expect(poolLane.locator(`[data-id="${reqId}"]`)).toBeVisible();
  await expect(reviewingLane.locator(`[data-id="${reqId}"]`)).toHaveCount(0);

  // 拖拽：Pool → Reviewing（HTML5 原生 DnD，Playwright 原生 dragTo 驱动）
  await dragCardTo(card, reviewingLane);

  // 卡片迁移到 reviewing 列（乐观更新 + PATCH 成功落位）
  await expect(reviewingLane.locator(`[data-id="${reqId}"]`)).toBeVisible();
  await expect(poolLane.locator(`[data-id="${reqId}"]`)).toHaveCount(0);

  // 磁盘 frontmatter 断言：status: "reviewing"
  expectField(requirementFile(slug, reqId), "status", "reviewing");
});
