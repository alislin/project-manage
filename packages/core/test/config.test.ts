import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, RAW_CONFIG_DEFAULTS, ZConfig } from "../src/config";

/** TC-02 · 02-core §4.1 loadConfig（P0 用例）+ 02-core §4.8 注（TC-02-025） */

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

  it("doc: vaultPath 为空 → E_CONFIG_INVALID", () => {
    const root = makeTempRoot("root-emptyvault-");
    fs.writeFileSync(path.join(root, "pm.config.json"), JSON.stringify({ vaultPath: "" }));
    const r = loadConfig(root);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_CONFIG_INVALID");
  });

  it("TC-02-025: vault 不存在（vaultPath 指向不存在目录）→ loadConfig E_CONFIG_INVALID", () => {
    const root = makeTempRoot("root-novault-");
    const vault = path.join(root, "vault-missing");
    fs.writeFileSync(path.join(root, "pm.config.json"), JSON.stringify({ vaultPath: vault, pmRoot: path.join(vault, "PM") }));
    const r = loadConfig(root);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("E_CONFIG_INVALID");
  });

  it("doc: RAW_CONFIG_DEFAULTS pmRoot = vaultPath/PM（02-core §4.1）+ ZConfig 字段校验", () => {
    expect(RAW_CONFIG_DEFAULTS("D:\\vault").pmRoot).toBe(path.join("D:\\vault", "PM"));
    expect(ZConfig.safeParse({ vaultPath: "v", pmRoot: "p" }).success).toBe(true);
    expect(ZConfig.safeParse({ vaultPath: "", pmRoot: "p" }).success).toBe(false);
    expect(ZConfig.safeParse({ vaultPath: "v" }).success).toBe(false);
  });
});
