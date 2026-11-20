/**
 * E2E-08 SSE 实时刷新（用户旅程：A 停留在项目需求池页；B（独立 browser context 的操作者）
 * 通过 pm CLI 新增需求 → 外部进程写入 → watcher → SSE vault:updated → A 页面无需刷新出现新卡片）。
 * 验收点：A 页面无需刷新出现新卡片（window 标记仍在证明未发生 reload）。
 *
 * 说明：服务端自身写入带自写过滤（02-core §5.3，不推 SSE），故 B 侧必须走 CLI 外部进程写入
 * （任务书允许 "CLI 或 API"，此处选 CLI 以覆盖真实 SSE 链路）。
 */
import { expect, test } from "@playwright/test";
import { e2eApi } from "../support/api";
import { pmNewRequirement } from "../support/cli";

const RUN = Date.now().toString(36);

test("E2E-08 SSE 实时刷新：B 侧 CLI 新增需求，A 页面无需刷新出现新卡片", async ({ page, browser }) => {
  const slug = `e2e08-${RUN}`;
  await e2eApi.createProject(slug, "E2E-08 SSE 实时项目");
  const first = await e2eApi.createRequirement(slug, "SSE 初始需求");

  // Context A：停留在项目需求池页
  await page.goto(`/p/${slug}/requirements`);
  await expect(page.locator(`[data-testid="req-card"][data-id="${first.id}"]`)).toBeVisible();
  // 页面标记：若发生 reload 将丢失
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__e2eNoReload = "pm-e2e-A";
  });

  // Context B：独立 browser context 的操作者，经 CLI 新增需求（外部进程写文件）
  const ctxB = await browser.newContext();
  try {
    const newTitle = "SSE 实时新增需求";
    const newId = await pmNewRequirement(slug, newTitle, { module: "sse" });

    // A 页面无需刷新出现新卡片（SSE vault:updated → 静默 refresh，超时上限 < 15s 兜底轮询间隔）
    const newCard = page.locator(`[data-testid="req-card"][data-id="${newId}"]`);
    await expect(newCard).toBeVisible();
    await expect(newCard).toContainText(newTitle);
    await expect(page.getByTestId("req-lane-pool").locator(`[data-id="${newId}"]`)).toBeVisible();
  } finally {
    await ctxB.close();
  }

  // 证明未发生页面刷新：window 标记仍在、URL 未变
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__e2eNoReload)).toBe("pm-e2e-A");
  expect(page.url()).toContain(`/p/${slug}/requirements`);
});
