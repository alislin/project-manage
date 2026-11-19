import { describe, it, expect, vi, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { runValidate } from "../src/commands/validate";
import { makeVaultRoot, writePmFile, readPmFile, pathExists } from "./helpers";

/** TC-03 · CLI validate 用例（P0，退出码 03-cli §1.3；临时目录 vault fixture） */

const PROJECT_MD = `---
type: project
id: proj
name: 项目Proj
status: active
period: ["2026-01-01", "2026-12-31"]
tags: []
---
`;

/** 同 02-core §4.7/01-数据规范 §1.2 结构合规的需求文件（TC-03-002 用） */
const REQ_001_MD = `---
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
`;

/** 非法文件（status: pool 对 project 非法，03-cli §2.3 示例） */
const PROJECT_MD_INVALID = PROJECT_MD.replace("status: active", "status: pool");

describe("TC-03 validate", () => {
  let root: string;
  let vault: string;

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function newRoot(): string {
    root = makeVaultRoot("pm-cli-validate-");
    return (vault = path.join(root, "vault"));
  }

  it("TC-03-001: pm validate 全通过（exit 0）", async () => {
    const v = newRoot();
    writePmFile(v, "projects/proj/project.md", PROJECT_MD);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runValidate({ root });
    expect(code).toBe(0);
    const out = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("✅");
    expect(out).toContain("校验通过");
  });

  it("TC-03-003: pm validate 非法文件（file+field 精确，exit 4）", async () => {
    const v = newRoot();
    const abs = writePmFile(v, "projects/proj/project.md", PROJECT_MD_INVALID);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await runValidate({ root });
    expect(code).toBe(4);
    const out = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain(abs);
    expect(out).toContain("status");
    expect(out).toContain("E_VALIDATION");
  });

  it("TC-03-004: pm validate 空 vault（exit 0, checkedFiles=0）", async () => {
    newRoot();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runValidate({ root, json: true });
    expect(code).toBe(0);
    const parsed = JSON.parse(logSpy.mock.calls.map((c) => String(c[0])).join(""));
    expect(parsed.checkedFiles).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.errors).toEqual([]);
  });

  it("TC-03-005: pm validate --json 输出结构（checkedFiles/ok/errors[{file,field?,code,message}]）", async () => {
    const v = newRoot();
    writePmFile(v, "projects/proj/project.md", PROJECT_MD);
    writePmFile(v, "projects/proj/requirements/REQ-proj-001.md", REQ_001_MD);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runValidate({ root, json: true });
    expect(code).toBe(0);
    const parsed = JSON.parse(logSpy.mock.calls.map((c) => String(c[0])).join(""));
    expect(parsed.checkedFiles).toBe(2);
    expect(parsed.ok).toBe(true);
    expect(parsed.errors).toEqual([]);
  });

  it("TC-03-002: pm validate <dir>（指定文件夹，checkedFiles = 该目录 md 数）", async () => {
    const v = newRoot();
    writePmFile(v, "projects/other/project.md", PROJECT_MD.replace(/id: proj/g, "id: other"));
    writePmFile(v, "projects/proj/project.md", PROJECT_MD);
    writePmFile(v, "projects/proj/requirements/REQ-proj-001.md", REQ_001_MD);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runValidate({ root, files: ["projects/proj"], json: true });
    expect(code).toBe(0);
    const parsed = JSON.parse(logSpy.mock.calls.map((c) => String(c[0])).join(""));
    expect(parsed.checkedFiles).toBe(2);
    expect(parsed.ok).toBe(true);
  });

  it("TC-03-044: pm validate 中文/空格路径（exit 0）", async () => {
    const v = newRoot();
    writePmFile(v, "projects/我的应用-v2/project.md", PROJECT_MD.replace(/id: proj/g, "id: 我的应用-v2").replace(/name: 项目Proj/g, "name: 我的应用 v2"));
    const code = await runValidate({ root });
    expect(code).toBe(0);
    expect(pathExists(v, "projects/我的应用-v2/project.md")).toBe(true);
  });
});
