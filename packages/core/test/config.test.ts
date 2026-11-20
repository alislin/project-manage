import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, RAW_CONFIG_DEFAULTS, ZConfig } from "../src/config";

/** TC-02 · 02-core §4.1 loadConfig（P0 用例）+ 02-core §4.8 注（TC-02-025）+ S13 祖先链解析（TC-02-033~035） */

/** 非源码产物测试根：优先 C:\Users\Aidee\AppData\Local\Temp\opencode（环境允许外部访问） */
function makeTempRoot(prefix: string): string {
  const base = path.join(os.tmpdir(), "opencode");
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, prefix));
}

describe("TC-02 config", () => {
  it("TC-02-001: loadConfig 正常（vaultPath → Config.vaultPath/pmRoot，02-core §4.1）", () => {
    const vault = makeTempRoot("vault-");
    const root = makeTempRoot("root-");
    const pmRoot = path.join(vault, "PM");
    fs.writeFileSync(path.join(root, "pm.config.json"), JSON.stringify({ vaultPath: vault, pmRoot }));
    const res = loadConfig(root);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.vaultPath).toBe(vault);
      expect(res.value.pmRoot).toBe(pmRoot);
      expect(res.value.defaultAuthor).toBeUndefined();
    }
  });

  it("TC-02-002: loadConfig E_CONFIG_INVALID（缺失/非法 JSON/字段不合法）", () => {
    const rootMissing = makeTempRoot("root-missing-");
    const r1 = loadConfig(rootMissing);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error.code).toBe("E_CONFIG_INVALID");

    const rootBadJson = makeTempRoot("root-badjson-");
    fs.writeFileSync(path.join(rootBadJson, "pm.config.json"), "{ not valid json");
    const r2 = loadConfig(rootBadJson);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.code).toBe("E_CONFIG_INVALID");

    const rootBadField = makeTempRoot("root-badfield-");
    fs.writeFileSync(path.join(rootBadField, "pm.config.json"), JSON.stringify({ vaultPath: "" }));
    const r3 = loadConfig(rootBadField);
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.error.code).toBe("E_CONFIG_INVALID");
  });

  it("doc: vaultPath 为空但 pmRoot 也为空 → E_CONFIG_INVALID（OBS-5：空 vaultPath 本身已合法，回退由 loadConfig 处理）", () => {
    const root = makeTempRoot("root-emptyvault-");
    fs.writeFileSync(path.join(root, "pm.config.json"), JSON.stringify({ vaultPath: "", pmRoot: "" }));
    const r = loadConfig(root);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_CONFIG_INVALID");
  });

  it("S5R1 OBS-5: vaultPath 空串回退为工程根目录，pmRoot 相对路径相对 vaultPath 解析", () => {
    const root = makeTempRoot("root-emptyvault-fallback-");
    fs.writeFileSync(path.join(root, "pm.config.json"), JSON.stringify({ vaultPath: "", pmRoot: "PM" }));
    const r = loadConfig(root);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.vaultPath).toBe(root);
      expect(r.value.pmRoot).toBe(path.join(root, "PM"));
    }
  });

  it("S5R1 OBS-5: vaultPath 空白串视同空串（回退工程根）；绝对 pmRoot 原样保留", () => {
    const root = makeTempRoot("root-blankvault-");
    const absPmRoot = path.join(root, "vault", "PM");
    fs.writeFileSync(path.join(root, "pm.config.json"), JSON.stringify({ vaultPath: "  ", pmRoot: absPmRoot }));
    const r = loadConfig(root);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.vaultPath).toBe(root);
      expect(r.value.pmRoot).toBe(absPmRoot);
    }
  });

  it("TC-02-025: vault 不存在（vaultPath 指向不存在目录）→ loadConfig E_CONFIG_INVALID", () => {
    const root = makeTempRoot("root-novault-");
    const vault = path.join(root, "vault-missing");
    fs.writeFileSync(path.join(root, "pm.config.json"), JSON.stringify({ vaultPath: vault, pmRoot: path.join(vault, "PM") }));
    const r = loadConfig(root);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_CONFIG_INVALID");
  });

  it("doc: RAW_CONFIG_DEFAULTS pmRoot = vaultPath/PM（02-core §4.1）+ ZConfig 字段校验（OBS-5：空 vaultPath 合法，回退由 loadConfig 处理）", () => {
    expect(RAW_CONFIG_DEFAULTS("D:\\vault").pmRoot).toBe(path.join("D:\\vault", "PM"));
    expect(ZConfig.safeParse({ vaultPath: "v", pmRoot: "p" }).success).toBe(true);
    expect(ZConfig.safeParse({ vaultPath: "", pmRoot: "p" }).success).toBe(true); // OBS-5：空串允许，语义 = 工程根
    expect(ZConfig.safeParse({ vaultPath: "v" }).success).toBe(false); // pmRoot 缺失仍非法
  });

  it("TC-02-033: S13 祖先链解析——cwd 在工程根子目录（祖先链命中 pm.config.json）→ 以命中目录为工程根（02-core §4.1）", () => {
    const root = makeTempRoot("root-ancestor-");
    fs.writeFileSync(path.join(root, "pm.config.json"), JSON.stringify({ vaultPath: "", pmRoot: "PM" }));
    const sub = path.join(root, "deep", "deeper");
    fs.mkdirSync(sub, { recursive: true });
    // 模拟 IDE 任务/子目录执行：不显式传 projectRoot，cwd = 工程根的深层子目录
    const prevCwd = process.cwd();
    process.chdir(sub);
    try {
      const r = loadConfig();
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.vaultPath).toBe(root);
        expect(r.value.pmRoot).toBe(path.join(root, "PM"));
      }
    } finally {
      process.chdir(prevCwd);
    }
  });

  it("TC-02-034: S13 显式 projectRoot 不向上查找——显式目录无 pm.config.json（祖先有）→ E_CONFIG_INVALID（02-core §4.1）", () => {
    const root = makeTempRoot("root-explicit-noasc-");
    fs.writeFileSync(path.join(root, "pm.config.json"), JSON.stringify({ vaultPath: "", pmRoot: "PM" }));
    const sub = path.join(root, "sub");
    fs.mkdirSync(sub, { recursive: true });
    // 显式传 sub（等价 CLI --root / server 显式参数）：直接使用该目录，不向上命中 root 的配置
    const r = loadConfig(sub);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_CONFIG_INVALID");
  });

  it("TC-02-035: S13 盘根未命中——cwd 祖先链全程无 pm.config.json → E_CONFIG_INVALID（02-core §4.1）", () => {
    // 临时目录在仓库外（祖先链至盘根均无 pm.config.json），模拟全链未命中
    const dir = makeTempRoot("root-noconfig-anywhere-");
    const prevCwd = process.cwd();
    process.chdir(dir);
    try {
      const r = loadConfig();
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("E_CONFIG_INVALID");
    } finally {
      process.chdir(prevCwd);
    }
  });
});
