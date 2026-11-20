/**
 * E2E-05 任务看板流转（用户旅程：任务卡在 todo 列 → 拖拽到 done 列 → 卡片迁移 → 磁盘 completed 收敛）。
 * 验收点：拖拽 todo→done 后卡片迁移；磁盘 frontmatter status: "done" 且 completed 为今天。
 */
import { expect, test } from "@playwright/test";
import { e2eApi, localToday } from "../support/api";
import { dragCardTo } from "../support/dnd";
import { taskFile } from "../support/paths";
import { expectField } from "../support/vault-files";

const RUN = Date.now().toString(36);

test("E2E-05 任务看板拖拽 todo→done 后卡片迁移且磁盘 completed 为今天", async ({ page }) => {
  const slug = `e2e05-${RUN}`;
  await e2eApi.createProject(slug, "E2E-05 任务看板项目");
  const req = await e2eApi.createRequirement(slug, "任务流转宿主需求");
  await e2eApi.patchRequirement(req.id, "reviewing");
  await e2eApi.patchRequirement(req.id, "accepted");
  const task = await e2eApi.createTask(slug, req.id, "任务看板拖拽验收", { due: localToday(3), priority: "P2" });
  const taskId = task.created.id;

  // 直达任务看板
  await page.goto(`/p/${slug}/tasks-board`);
  const card = page.locator(`[data-testid="task-card"][data-id="${taskId}"]`);
  await expect(card).toBeVisible();
  const todoLane = page.getByTestId("task-lane-todo");
  const doneLane = page.getByTestId("task-lane-done");
  await expect(todoLane.locator(`[data-id="${taskId}"]`)).toBeVisible();

  // 拖拽：Todo → Done（todo->done 为合法流转，01-数据规范 §3.3）
  await dragCardTo(card, doneLane);

  // 卡片迁移到 Done 列
  await expect(doneLane.locator(`[data-id="${taskId}"]`)).toBeVisible();
  await expect(todoLane.locator(`[data-id="${taskId}"]`)).toHaveCount(0);

  // 磁盘 frontmatter：status: "done" + completed 为今天（02-core moveStatus 副作用）
  expectField(taskFile(slug, taskId), "status", "done");
  expectField(taskFile(slug, taskId), "completed", localToday());
});
