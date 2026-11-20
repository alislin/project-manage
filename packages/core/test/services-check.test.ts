import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildIndex, runCheck, type Config, type VaultIndex } from "../src/index";

/** TC-02 · services/check 一致性检查（03-cli §6.2 检查清单，TC-03-028/029/030/031/032/033/034） */

function makeTempRoot(prefix: string): string {
  const base = path.join(os.tmpdir(), "opencode");
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, prefix));
}

function makeConfig(vault: string): Config {
  return { vaultPath: vault, pmRoot: path.join(vault, "PM") };
}

function write(vault: string, rel: string, content: string): string {
  const abs = path.join(vault, "PM", rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  return abs;
}

const PROJECT_MD = `---
type: project
id: proj
name: 项目Proj
status: active
period: ["2026-01-01", "2026-12-31"]
tags: []
---
`;

const REQ_MD = (id: string, created: string, updated: string): string => `---
type: requirement
id: ${id}
title: 需求
status: pool
priority: P2
module: auth
source: human
created: "${created}"
updated: "${updated}"
---
`;

const TASK_MD = (id: string, reqLink: string, created: string, updated: string, due: string): string => `---
type: task
id: ${id}
title: 任务
status: todo
requirement: "${reqLink}"
priority: P2
due: "${due}"
completed: null
created: "${created}"
updated: "${updated}"
---
`;

function checkOf(files: Array<{ rel: string; content: string }>): { index: VaultIndex; abs: (rel: string) => string } {
  const vault = makeTempRoot("vault-check-");
  const map = new Map<string, string>();
  for (const f of files) map.set(f.rel, write(vault, f.rel, f.content));
  return { index: buildIndex(makeConfig(vault)), abs: (rel: string) => map.get(rel) ?? "" };
}

describe("TC-03 services/check（pm check 共用实现）", () => {
  it("TC-03-028: runCheck 无问题（vault 一致 → ok=true, issues=[]）", () => {
    const { index } = checkOf([
      { rel: "projects/proj/project.md", content: PROJECT_MD },
      { rel: "projects/proj/requirements/REQ-proj-001.md", content: REQ_MD("REQ-proj-001", "2026-11-10", "2026-11-19") },
      { rel: "projects/proj/tasks/TASK-proj-001.md", content: TASK_MD("TASK-proj-001", "[[REQ-proj-001]]", "2026-11-10", "2026-11-19", "2026-12-01") },
    ]);
    const result = runCheck(index);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("TC-03-029: dangling-wiki（requirement 引用 [[REQ-proj-999]] 不存在）", () => {
    const { index, abs } = checkOf([
      { rel: "projects/proj/project.md", content: PROJECT_MD },
      { rel: "projects/proj/requirements/REQ-proj-001.md", content: REQ_MD("REQ-proj-001", "2026-11-10", "2026-11-19") },
      { rel: "projects/proj/tasks/TASK-proj-003.md", content: TASK_MD("TASK-proj-003", "[[REQ-proj-999]]", "2026-11-10", "2026-11-19", "2026-12-01") },
    ]);
    const result = runCheck(index);
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].code).toBe("dangling-wiki");
    expect(result.issues[0].file).toBe(abs("projects/proj/tasks/TASK-proj-003.md"));
    expect(result.issues[0].field).toBe("requirement");
    expect(result.issues[0].message).toContain("REQ-proj-999");
  });

  it("TC-03-029 补充: 跨项目关联（目标存在但不在当前项目）→ dangling-wiki", () => {
    const { index } = checkOf([
      { rel: "projects/proj/project.md", content: PROJECT_MD },
      { rel: "projects/proj/requirements/REQ-proj-001.md", content: REQ_MD("REQ-proj-001", "2026-11-10", "2026-11-19") },
      { rel: "projects/other/project.md", content: PROJECT_MD.replace(/id: proj/g, "id: other") },
      { rel: "projects/other/requirements/REQ-other-001.md", content: REQ_MD("REQ-other-001", "2026-11-10", "2026-11-19") },
      { rel: "projects/proj/tasks/TASK-proj-002.md", content: TASK_MD("TASK-proj-002", "[[REQ-other-001]]", "2026-11-10", "2026-11-19", "2026-12-01") },
    ]);
    const result = runCheck(index);
    const dangling = result.issues.filter((i) => i.code === "dangling-wiki");
    expect(dangling).toHaveLength(1);
    expect(dangling[0].message).toContain("不在当前项目 proj");
  });

  it("TC-03-030: id-conflict（两个文件 id 重复）", () => {
    const { index } = checkOf([
      { rel: "projects/proj/project.md", content: PROJECT_MD },
      { rel: "projects/proj/requirements/REQ-proj-001.md", content: REQ_MD("REQ-proj-001", "2026-11-10", "2026-11-19") },
      { rel: "projects/proj/requirements/REQ-proj-001-dup.md", content: REQ_MD("REQ-proj-001", "2026-11-10", "2026-11-19") },
    ]);
    const result = runCheck(index);
    expect(result.ok).toBe(false);
    const conflict = result.issues.find((i) => i.code === "id-conflict");
    expect(conflict).toBeDefined();
    expect(conflict?.field).toBe("id");
    expect(conflict?.message).toContain("REQ-proj-001");
    expect(conflict?.message).toContain("重复");
  });

  it("TC-03-031: date-inverted（req updated<created 走 broken 侧；task due<created 走 typed 侧）", () => {
    // (a) req updated < created：Zod superRefine 拦截 → broken → check 还原为 date-inverted
    const a = checkOf([
      { rel: "projects/proj/project.md", content: PROJECT_MD },
      { rel: "projects/proj/requirements/REQ-proj-001.md", content: REQ_MD("REQ-proj-001", "2026-11-10", "2026-11-01") },
    ]);
    const ra = runCheck(a.index);
    expect(ra.issues).toHaveLength(1);
    expect(ra.issues[0].code).toBe("date-inverted");
    expect(ra.issues[0].field).toBe("updated");

    // (b) task due < created：Zod 不校验 due → typed → date-inverted
    const b = checkOf([
      { rel: "projects/proj/project.md", content: PROJECT_MD },
      { rel: "projects/proj/requirements/REQ-proj-001.md", content: REQ_MD("REQ-proj-001", "2026-11-10", "2026-11-19") },
      { rel: "projects/proj/tasks/TASK-proj-001.md", content: TASK_MD("TASK-proj-001", "[[REQ-proj-001]]", "2026-11-19", "2026-11-19", "2026-11-10") },
    ]);
    const rb = runCheck(b.index);
    expect(rb.issues).toHaveLength(1);
    expect(rb.issues[0].code).toBe("date-inverted");
    expect(rb.issues[0].field).toBe("due");
  });

  it("TC-03-032: invalid-frontmatter（非法 frontmatter → broken → invalid-frontmatter）", () => {
    const { index } = checkOf([
      { rel: "projects/proj/project.md", content: PROJECT_MD.replace("status: active", "status: pool") },
    ]);
    const result = runCheck(index);
    expect(result.ok).toBe(false);
    const fm = result.issues.find((i) => i.code === "invalid-frontmatter");
    expect(fm).toBeDefined();
    expect(fm?.field).toBe("status");
  });

  it("TC-03-033: invalid-link-target（requirement=\"[[xxx]]\" 格式不合法）", () => {
    const { index, abs } = checkOf([
      { rel: "projects/proj/project.md", content: PROJECT_MD },
      { rel: "projects/proj/requirements/REQ-proj-001.md", content: REQ_MD("REQ-proj-001", "2026-11-10", "2026-11-19") },
      { rel: "projects/proj/tasks/TASK-proj-003.md", content: TASK_MD("TASK-proj-003", "[[xxx]]", "2026-11-10", "2026-11-19", "2026-12-01") },
    ]);
    const result = runCheck(index);
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].code).toBe("invalid-link-target");
    expect(result.issues[0].field).toBe("requirement");
    expect(result.issues[0].file).toBe(abs("projects/proj/tasks/TASK-proj-003.md"));
  });

  it("TC-03-034: CheckResult 结构（issues[{file, field?, code, message}]，code 属于 03-cli §6.3 枚举）", () => {
    const { index } = checkOf([
      { rel: "projects/proj/project.md", content: PROJECT_MD },
      { rel: "projects/proj/requirements/REQ-proj-001.md", content: REQ_MD("REQ-proj-001", "2026-11-10", "2026-11-19") },
      { rel: "projects/proj/tasks/TASK-proj-003.md", content: TASK_MD("TASK-proj-003", "[[REQ-proj-999]]", "2026-11-10", "2026-11-19", "2026-12-01") },
    ]);
    const result = runCheck(index);
    expect(typeof result.ok).toBe("boolean");
    expect(result.ok).toBe(false);
    const allowed = new Set(["dangling-wiki", "invalid-link-target", "id-conflict", "date-inverted", "invalid-frontmatter"]);
    for (const iss of result.issues) {
      expect(typeof iss.file).toBe("string");
      expect(path.isAbsolute(iss.file)).toBe(true);
      expect(allowed.has(iss.code)).toBe(true);
      expect(typeof iss.message).toBe("string");
    }
  });
});
