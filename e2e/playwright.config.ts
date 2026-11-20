/**
 * S12 E2E Playwright 配置（任务书第 1 条）：
 * - webServer：测试前自动 `node packages/cli/dist/index.js serve --port 3199 --root <临时vault>`
 *   （globalSetup 已生成临时 vault 与 pm.config.json；web dist 由 @pm/server 默认托管 apps/web/dist）；
 * - baseURL 指向 http://127.0.0.1:3199；
 * - globalTeardown 在测试完全结束后清理临时 vault；
 * - workers=1 串行：全部用例共享同一 server + vault，测试间以各自独立 slug 隔离。
 * 不设置 timezoneId：浏览器与 Node 同用本机时区，保证 today()/completed 断言口径一致。
 */
import { defineConfig } from "@playwright/test";
import { BASE_URL, CLI_ENTRY, E2E_PORT, E2E_ROOT, HEALTH_URL, VAULT_DIR } from "./support/paths";

export default defineConfig({
  testDir: "./tests",
  outputDir: "./.artifacts",
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",

  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],

  use: {
    baseURL: BASE_URL,
    locale: "zh-CN",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  webServer: {
    // Playwright 1.59 先启 webServer 后跑 globalSetup（probe 实测）：
    // serve 前先以同源 prepare-vault.mjs 生成临时 vault 与 pm.config.json（globalSetup 幂等兜底）
    command: `node "${E2E_ROOT}\\support\\prepare-vault.mjs" "${VAULT_DIR}" && node "${CLI_ENTRY}" serve --port ${E2E_PORT} --root "${VAULT_DIR}"`,
    url: HEALTH_URL,
    timeout: 30_000,
    reuseExistingServer: !process.env.CI,
  },
});
