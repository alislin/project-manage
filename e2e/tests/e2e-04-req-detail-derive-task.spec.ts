/**
 * E2E-04 需求详情与派生任务（用户旅程：点击卡片开详情模态 → 核对 frontmatter 全字段 →
 * accepted 需求经 POST /api/requirements/:id/derive-task 派生任务 → 任务看板出现派生任务卡片）。
 * 验收点：详情模态字段完整；派生任务成功出现在任务看板。
 */
import { expect, test } from "@playwright/test";
import { e2eApi } from "../support/api";

const RUN = Date.now().toString(36);

test("E2E-04 需求详情模态字段完整，accepted 需求派生任务出现在任务看板", async ({ page }) => {
  const slug = `e2e04-${RUN}`;
  const title = "需求详情与派生任务验收";
  await e2eApi.createProject(slug, "E2E-04 详情模态项目");
  const req = await e2eApi.createRequirement(slug, title, {
    module: "core",
    priority: "P1",
    source: "S12 验收：详情模态来源说明正文",
  });
  const reqId = req.id;
  // 流转到 accepted（reviewing → accepted，为派生任务做准备）
  await e2eApi.patchRequirement(reqId, "reviewing");
  await e2eApi.patchRequirement(reqId, "accepted");

  // 打开详情模态
  await page.goto(`/p/${slug}/requirements`);
  const card = page.locator(`[data-testid="req-card"][data-id="${reqId}"]`);
  await expect(card).toBeVisible();
  await card.click();

  // 字段完整性：frontmatter 全字段（01-数据规范 §1.2）
  const fields = page.getByTestId("req-fields");
  await expect(fields).toBeVisible();
  for (const key of ["id", "type", "title", "status", "priority", "module", "created", "updated", "mtimeMs"]) {
    await expect(fields.locator("dt").filter({ hasText: key })).toHaveCount(1);
  }
  await expect(fields).toContainText(reqId);
  await expect(fields).toContainText("accepted");
  await expect(fields).toContainText("P1");
  await expect(fields).toContainText("core");
  // 正文（source）区展示来源说明
  const modalDialog = page.locator(".pm-modal__dialog");
  await expect(modalDialog).toContainText("S12 验收：详情模态来源说明正文");

  // accepted 需求派生任务（05-server §2.8：默认 due = today+7，title = 需求标题）
  const derived = await e2eApi.deriveTask(reqId);
  const taskId = derived.created.id;
  expect(taskId).toMatch(new RegExp(`^TASK-${slug}-\\d{3}$`));

  // 关闭模态后切换到任务看板，派生任务卡片出现
  await page.getByRole("button", { name: "关闭" }).click();
  await expect(page.locator('[aria-label="需求详情"]')).toHaveCount(0);
  await page.getByTestId("tab-tasks-board").click();
  const taskCard = page.locator(`[data-testid="task-card"][data-id="${taskId}"]`);
  await expect(taskCard).toBeVisible();
  await expect(taskCard).toContainText(title);
  await expect(page.getByTestId("task-lane-todo").locator(`[data-id="${taskId}"]`)).toBeVisible();
});
