/**
 * globalSetup（S12 任务书第 1 条）：生成临时 vault 与 pm.config.json、env 设定临时 vault。
 * 生成逻辑与 webServer.command 同源（support/prepare-vault.mjs）：Playwright 1.59 先启 webServer
 * 后跑 globalSetup，故 webServer 启动前已生成 vault；此处幂等兜底（vault 缺失时重建）并导出 env，
 * 保证 reuseExistingServer 跳过 webServer 时 vault 依然就绪。
 */
import fs from "node:fs";
import { prepareVault } from "./support/prepare-vault.mjs";
import { PM_CONFIG_PATH, VAULT_DIR } from "./support/paths";

export default async function globalSetup(): Promise<void> {
  if (!fs.existsSync(PM_CONFIG_PATH)) {
    prepareVault(VAULT_DIR);
  }
  // env 设定临时 vault（供测试进程与派生子进程同源引用）
  process.env.PM_E2E_VAULT = VAULT_DIR;
  if (!fs.existsSync(PM_CONFIG_PATH)) {
    throw new Error(`globalSetup 后 pm.config.json 仍缺失：${PM_CONFIG_PATH}`);
  }
}
