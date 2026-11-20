import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ok, err, type AppResult, type Config } from "./types.js";
import { E_CONFIG_INVALID } from "./errors.js";

/**
 * pm.config.json 结构（02-core §4.1，plan §7：vaultPath/pmRoot/可选 defaultAuthor）。
 * S5R1 OBS-5：vaultPath 允许空串——约定「vault = 工程根目录」，由 loadConfig 回退解析
 * （仓库根 pm.config.json `{"vaultPath":"","pmRoot":"PM"}` 形态即合法）。
 */
export const ZConfig = z.object({
  vaultPath: z.string(),
  pmRoot: z.string().min(1),
  defaultAuthor: z.string().optional(),
});

/** pmRoot 默认 = vaultPath/PM（02-core §4.1 RAW_CONFIG_DEFAULTS） */
export const RAW_CONFIG_DEFAULTS = (vaultPath: string): Config => ({
  vaultPath,
  pmRoot: path.join(vaultPath, "PM"),
});

/**
 * loadConfig（02-core §4.1 + S5R1 OBS-5）：读取 `projectRoot/pm.config.json` 并解析校验。
 * - vaultPath 为空串/空白 → 回退为工程根目录（约定 vault = 工程根）；
 * - pmRoot 为相对路径 → 相对最终 vaultPath 解析（绝对路径原样保留，与 RAW_CONFIG_DEFAULTS 同语义）。
 * ok=true 返回 Config；ok=false 为 E_CONFIG_INVALID：缺失/非法 JSON/字段不合法/
 * vaultPath 指向不存在目录（02-core §4.8 注，TC-02-025）。
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
    return err({ code: E_CONFIG_INVALID, message: "pm.config.json 字段不合法（vaultPath/pmRoot 缺失或类型非法）" });
  }
  // OBS-5：空 vaultPath 回退为工程根目录（空白串视同空串）
  const vaultPath = parsed.data.vaultPath.trim() === "" ? root : parsed.data.vaultPath;
  // 相对 pmRoot 相对最终 vaultPath 解析（绝对路径原样保留）
  const pmRoot = path.isAbsolute(parsed.data.pmRoot) ? parsed.data.pmRoot : path.join(vaultPath, parsed.data.pmRoot);
  if (!fs.existsSync(vaultPath)) {
    return err({
      code: E_CONFIG_INVALID,
      message: `vaultPath "${parsed.data.vaultPath}" 指向不存在目录（02-core §4.8）`,
    });
  }
  return ok({
    vaultPath,
    pmRoot,
    ...(parsed.data.defaultAuthor !== undefined ? { defaultAuthor: parsed.data.defaultAuthor } : {}),
  });
}
