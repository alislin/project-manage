/**
 * S12 E2E 公共路径常量（playwright.config / global-setup / tests 共用同一计算，保证一致性）。
 * 临时 vault 默认位于系统临时目录（可用 PM_E2E_VAULT 覆盖）；每次运行由 globalSetup 重建、globalTeardown 清理。
 */
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** e2e/support 目录 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
/** e2e 工作区根 */
export const E2E_ROOT = path.resolve(HERE, "..");
/** 仓库根（monorepo root） */
export const REPO_ROOT = path.resolve(E2E_ROOT, "..");

/** Web 服务端口（任务书固定 3199；PM_E2E_PORT 可覆盖） */
export const E2E_PORT = Number(process.env.PM_E2E_PORT ?? 3199);
export const HOST = "127.0.0.1";
/** baseURL：Web 服务地址 */
export const BASE_URL = `http://${HOST}:${E2E_PORT}`;
/** webServer 就绪探测（Playwright 轮询至 2xx） */
export const HEALTH_URL = `${BASE_URL}/api/health`;

/** CLI 构建产物入口（webServer 与 CLI 写入方共用） */
export const CLI_ENTRY = path.join(REPO_ROOT, "packages", "cli", "dist", "index.js");

/** 临时 vault 目录（globalSetup 生成 pm.config.json，globalTeardown 删除） */
export const VAULT_DIR = process.env.PM_E2E_VAULT ?? path.join(os.tmpdir(), "pm-e2e-vault");
export const PM_CONFIG_PATH = path.join(VAULT_DIR, "pm.config.json");
/** pmRoot = <vault>/PM（与仓库根 pm.config.json 同构，02-core §4.1） */
export const PM_ROOT = path.join(VAULT_DIR, "PM");

/** vault 内记录文件定位（位于 pmRoot 下） */
export function requirementFile(slug: string, id: string): string {
  return path.join(PM_ROOT, "projects", slug, "requirements", `${id}.md`);
}
export function taskFile(slug: string, id: string): string {
  return path.join(PM_ROOT, "projects", slug, "tasks", `${id}.md`);
}
