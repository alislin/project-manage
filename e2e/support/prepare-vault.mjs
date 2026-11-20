/**
 * 临时 vault 生成器（S12 共享模块）：
 * Playwright 1.59 实际启动顺序为 webServer 先于 globalSetup（probe 实测），因此
 * vault 生成逻辑收敛到本模块，供两处同源调用：
 * 1. playwright.config.ts 的 webServer.command：启动 serve 前先 `node prepare-vault.mjs <vault>`；
 * 2. e2e/global-setup.ts：globalSetup 兜底生成（幂等），满足「pm.config.json 由 globalSetup 生成」。
 *
 * 行为：清理重建 vault 目录，写入 pm.config.json
 * （vaultPath 空串 = vault 即工程根，pmRoot = <vault>/PM，与仓库根配置同构）。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

export function prepareVault(vaultDir) {
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.mkdirSync(vaultDir, { recursive: true });
  const configPath = path.join(vaultDir, "pm.config.json");
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        _comment: "S12 E2E 临时 vault：prepare-vault.mjs（globalSetup 同源）生成，global-teardown.ts 在测试完全结束后清理",
        vaultPath: "",
        pmRoot: "PM",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  if (!fs.existsSync(configPath)) {
    throw new Error(`prepareVault 生成 pm.config.json 失败：${configPath}`);
  }
  return configPath;
}

/** 直接执行：node prepare-vault.mjs [vaultDir]（webServer.command 使用） */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const vaultDir = process.argv[2] ?? path.join(os.tmpdir(), "pm-e2e-vault");
  prepareVault(vaultDir);
}
