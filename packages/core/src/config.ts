import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ok, err, type AppResult, type Config } from "./types.js";
import { E_CONFIG_INVALID } from "./errors.js";

/** pm.config.json 结构（02-core §4.1，plan §7：vaultPath/pmRoot/可选 defaultAuthor） */
export const ZConfig = z.object({
  vaultPath: z.string().min(1),
  pmRoot: z.string().min(1),
  defaultAuthor: z.string().optional(),
});

/** pmRoot 默认 = vaultPath/PM（02-core §4.1 RAW_CONFIG_DEFAULTS） */
export const RAW_CONFIG_DEFAULTS = (vaultPath: string): Config => ({
  vaultPath,
  pmRoot: path.join(vaultPath, "PM"),
});

/**
 * loadConfig（02-core §4.1）：读取 `projectRoot/pm.config.json` 并解析校验。
 * ok=true 返回 Config；ok=false 为 E_CONFIG_INVALID：缺失/非法 JSON/字段不合法/
 * vaultPath 为空（ZConfig min(1) 拦截）/vaultPath 指向不存在目录（02-core §4.8 注，TC-02-025）。
 */
export function loadConfig(projectRoot?: string): AppResult<Config> {
  const root = projectRoot ?? process.cwd();
  const cfgPath = path.join(root, "pm.config.json");
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch {
    return err({ code: E_CONFIG_INVALID, message: "读取 pm.config.json 失败或内容不是合法 JSON" });
  }
  const parsed = ZConfig.safeParse(data);
  if (!parsed.success) {
    return err({ code: E_CONFIG_INVALID, message: "pm.config.json 字段不合法（vaultPath 缺失或为空）" });
  }
  if (!fs.existsSync(parsed.data.vaultPath)) {
    return err({
      code: E_CONFIG_INVALID,
      message: `vaultPath "${parsed.data.vaultPath}" 指向不存在目录（02-core §4.8）`,
    });
  }
  return ok(parsed.data);
}
