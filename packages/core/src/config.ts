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
 * loadConfig（02-core §4.1 + S5R1 OBS-5 + S13 祖先链解析）：读取工程根的 pm.config.json 并解析校验。
 * - 工程根定位（S13）：projectRoot 显式传入（CLI --root、MCP/server 显式参数）→ 直接使用该目录，
 *   不向上查找；未显式传入 → 从 process.cwd() 向上逐级目录查找 pm.config.json（至盘根止），
 *   命中即用该目录为工程根，全链未命中保持 E_CONFIG_INVALID（02-core §4.1）。
 * - vaultPath 为空串/空白 → 回退为工程根目录（约定 vault = 工程根）；
 * - pmRoot 为相对路径 → 相对最终 vaultPath 解析（绝对路径原样保留，与 RAW_CONFIG_DEFAULTS 同语义）。
 * ok=true 返回 Config；ok=false 为 E_CONFIG_INVALID：缺失/非法 JSON/字段不合法/
 * vaultPath 指向不存在目录（02-core §4.8 注，TC-02-025）。
 */
export function loadConfig(projectRoot?: string): AppResult<Config> {
  // S13：显式传入 → 直接使用该目录（保持原行为，不向上查找）
  if (projectRoot !== undefined) return readConfigAt(projectRoot);
  // S13：缺省 → 从 cwd 向上逐级查找 pm.config.json（至盘根止；02-core §4.1）
  let dir = process.cwd();
  for (;;) {
    if (fs.existsSync(path.join(dir, "pm.config.json"))) return readConfigAt(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break; // 已到盘根
    dir = parent;
  }
  return err({ code: E_CONFIG_INVALID, message: "读取 pm.config.json 失败或内容不是合法 JSON" });
}

/** 读取 `<root>/pm.config.json` 并解析校验（工程根已定位，不再向上查找） */
function readConfigAt(root: string): AppResult<Config> {
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
