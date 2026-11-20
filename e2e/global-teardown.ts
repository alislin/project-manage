/**
 * globalTeardown（S12 任务书第 1 条）：测试完全结束后清理临时 vault。
 * webServer 可能仍有 watcher 句柄，Windows 上删除可能短暂 EBUSY —— 重试数次，最终失败不阻塞报告。
 */
import fs from "node:fs";
import { VAULT_DIR } from "./support/paths";

export default async function globalTeardown(): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.rmSync(VAULT_DIR, { recursive: true, force: true });
      if (!fs.existsSync(VAULT_DIR)) return;
    } catch (e) {
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  // 兜底：tmpdir 内残留不污染仓库，仅提示
  console.warn(`[e2e] 临时 vault 清理未完全成功（可手动删除）：${VAULT_DIR}`, lastError);
}
