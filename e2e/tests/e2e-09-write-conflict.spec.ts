/**
 * E2E-09 写冲突（用户旅程：页面打开期间需求文件被外部修改两次 → 页面拖拽流转 →
 * PATCH 预检 mtime 失配 409（E_CONFLICT）→ Q-05 自动刷新重试一次仍冲突 → ConflictDialog 弹出）。
 * 验收点：外部改文件后操作触发 ConflictDialog；卡片回原列；磁盘 status 未被覆盖。
 *
 * 确定性说明：外部修改通过 page.route 钩子在「PATCH 到达服务端之前」真实落盘（appendFileSync），
 * 保证：第一次 PATCH（基准 = 打开页面时的 mtime）必然 409；store 自动刷新 GET 后重试第二次 PATCH，
 * 但文件在 GET 之后、PATCH#2 之前再次被外部修改 → 重试也必然 409 → ui.showConflict。
 * 全链路为真实磁盘修改 + 真实服务端 409，无 mock 响应体。
 */
import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { e2eApi } from "../support/api";
import { dragCardTo } from "../support/dnd";
import { requirementFile } from "../support/paths";
import { expectField } from "../support/vault-files";

const RUN = Date.now().toString(36);

test("E2E-09 页面打开期间外部改文件，操作触发 ConflictDialog", async ({ page }) => {
  const slug = `e2e09-${RUN}`;
  await e2eApi.createProject(slug, "E2E-09 写冲突项目");
  const req = await e2eApi.createRequirement(slug, "写冲突验收卡片", { module: "core" });
  const reqId = req.id;
  const file = requirementFile(slug, reqId);

  // 页面打开（此时 store 基准 mtime = M0）
  await page.goto(`/p/${slug}/requirements`);
  const card = page.locator(`[data-testid="req-card"][data-id="${reqId}"]`);
  await expect(card).toBeVisible();

  // 拦截 PATCH：每次 PATCH 到达前真实追加写文件（页面打开期间的外部修改），再代发到真实服务端
  // 注意：route.fetch() 只代发不回填，必须显式 route.fulfill({ response }) 把真实响应送回页面
  let externalWrites = 0;
  await page.route("**/api/requirements/*", async (route) => {
    if (route.request().method() === "PATCH" && externalWrites < 2) {
      externalWrites += 1;
      await new Promise((r) => setTimeout(r, 25)); // 保证两次外部写 mtime 间隔 > 1ms（整数毫秒口径）
      fs.appendFileSync(file, `\n<!-- e2e external write #${externalWrites} -->\n`, "utf8");
    }
    const resp = await route.fetch();
    await route.fulfill({ response: resp });
  });

  // 拖拽 Pool → Reviewing：触发 PATCH（基准已过期）→ 409 → 刷新重试 → 再 409 → ConflictDialog
  await dragCardTo(card, page.getByTestId("req-lane-reviewing"));

  const dialog = page.getByTestId("conflict-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("文件已被外部修改");
  await expect(dialog).toContainText(reqId);
  await expect(dialog).toContainText("刷新并重试");

  // 卡片回原列（第二次冲突后回滚）
  await expect(page.getByTestId("req-lane-pool").locator(`[data-id="${reqId}"]`)).toBeVisible();
  await expect(page.getByTestId("req-lane-reviewing").locator(`[data-id="${reqId}"]`)).toHaveCount(0);

  // 冲突保护：磁盘 status 未被页面操作覆盖（外部追加仅改正文体）
  expectField(file, "status", "pool");

  // 取消关闭弹窗
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(dialog).toBeHidden();
});
