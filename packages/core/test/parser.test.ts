import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseFile } from "../src/index";
import { ZRequirement } from "../src/schema";

/** TC-02 · 02-core §4.3 parseFile（TC-02-005, TC-02-006） */

function makeTempRoot(prefix: string): string {
  const base = path.join(os.tmpdir(), "opencode");
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, prefix));
}

describe("TC-02 parser", () => {
  it("TC-02-005: parseFile 正常（02-core §4.3）：ok=true, data = 校验后 Requirement", () => {
    const vault = makeTempRoot("vault-parse-");
    const abs = path.join(vault, "REQ-proj-001.md");
    fs.writeFileSync(
      abs,
      `---
type: requirement
id: REQ-proj-001
title: 需求001
status: pool
priority: P2
module: auth
source: human
created: 2026-11-19
updated: 2026-11-19
---
正文内容
`,
      "utf8",
    );
    const res = parseFile(abs, ZRequirement);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.id).toBe("REQ-proj-001");
      expect(res.data.status).toBe("pool");
      expect(res.body).toContain("正文内容");
    }
  });

  it("TC-02-006: parseFile broken（02-core §4.3）：ok=false, issues 含具体 path", () => {
    const vault = makeTempRoot("vault-parse-bad-");
    const abs = path.join(vault, "REQ-proj-001.md");
    // 缺少必填字段（title/source/updated 缺失，status 越界）
    fs.writeFileSync(
      abs,
      `---
type: requirement
id: REQ-proj-001
status: online
priority: P2
---
`,
      "utf8",
    );
    const res = parseFile(abs, ZRequirement);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues.length).toBeGreaterThan(0);
      expect(res.issues.some((i) => i.path.length > 0)).toBe(true);
    }
  });
});
