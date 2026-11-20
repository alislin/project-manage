/**
 * E2E-03 非法流转拒绝（用户旅程：pool 卡片直接拖到终态 done 列 → 服务端 E_INVALID_TRANSITION → 回滚）。
 * 验收点：非法流转拖拽被拒，出现错误 toast 提示，卡片回到原列，磁盘状态未变。
 */
import { expect, test } from "@playwright/test";
import { e2eApi } from "../support/api";
import { dragCardTo } from "../support/dnd";
import { requirementFile } from "../support/paths";
import { expectField } from "../support/vault-files";

const RUN = Date.now().toString(36);

test("E2E-03 非法流转拖拽被拒：toast 提示且卡片回原列", async ({ page }) => {
  const slug = `e2e03-${RUN}`;
  await e2eApi.createProject(slug, "E2E-03 非法流转项目");
  const req = await e2eApi.createRequirement(slug, "非法流转验收卡片", { module: "ui", priority: "P0" });
  const reqId = req.id;

  await page.goto(`/p/${slug}/requirements`);
  const card = page.locator(`[data-testid="req-card"][data-id="${reqId}"]`);
  await expect(card).toBeVisible();
  const poolLane = page.getByTestId("req-lane-pool");
  const doneLane = page.getByTestId("req-lane-done");
  await expect(poolLane.locator(`[data-id="${reqId}"]`)).toBeVisible();

  // pool -> done 不在合法流转表（01-数据规范 §3.2）：拖拽被拒
  await dragCardTo(card, doneLane);

  // 错误 toast（store 回滚后 pushToast，文案含"非法状态流转"）
  const toast = page.locator('[data-testid="toast"]').filter({ hasText: "非法状态流转" });
  await expect(toast).toBeVisible();

  // 卡片回原列（乐观更新回滚，TC-06-007）
  await expect(poolLane.locator(`[data-id="${reqId}"]`)).toBeVisible();
  await expect(doneLane.locator(`[data-id="${reqId}"]`)).toHaveCount(0);

  // 磁盘状态未被非法流转污染
  expectField(requirementFile(slug, reqId), "status", "pool");
});
