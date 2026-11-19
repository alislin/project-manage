import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { allocateId, buildIndex } from "../src/index";
import { E_SEQ_EXHAUSTED } from "../src/errors";
import type { Requirement, Task, VaultIndex } from "../src/types";

/** TC-02 · services/seq 编号分配（01-数据规范 §1.5, §2.6; 02-core §4.7, §2.7 allocateId） */

function makeTempRoot(prefix: string): string {
  const base = path.join(os.tmpdir(), "opencode");
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, prefix));
}

function mkIndex(): VaultIndex {
  const vault = makeTempRoot("vault-seq-");
  fs.mkdirSync(path.join(vault, "PM"), { recursive: true });
  return buildIndex({ vaultPath: vault, pmRoot: path.join(vault, "PM") });
}

describe("TC-02 services/seq", () => {
  it("doc: allocateId 基本分配（01-数据规范 §1.5）", () => {
    const index = mkIndex();
    expect(allocateId(index, "REQ", "proj")).toEqual({ ok: true, value: "REQ-proj-001" });
    index.requirements.push({ id: "REQ-proj-001" } as Requirement);
    expect(allocateId(index, "REQ", "proj")).toEqual({ ok: true, value: "REQ-proj-002" });
  });

  it("doc: allocateId 项目前缀（projects: id = slug）", () => {
    const index = mkIndex();
    expect(allocateId(index, "project", "proj")).toEqual({ ok: true, value: "proj" });
  });

  it("doc: allocateId 池耗尽（>999）→ E_SEQ_EXHAUSTED", () => {
    const index = mkIndex();
    index.requirements.push({ id: "REQ-proj-999" } as Requirement);
    const r = allocateId(index, "REQ", "proj");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(E_SEQ_EXHAUSTED);
  });

  it("doc: allocateId TASK/INBOX 前缀隔离（01-数据规范 §1.5）", () => {
    const index = mkIndex();
    index.tasks.push({ id: "TASK-proj-002" } as Task);
    expect(allocateId(index, "REQ", "proj")).toEqual({ ok: true, value: "REQ-proj-001" });
    expect(allocateId(index, "TASK", "proj")).toEqual({ ok: true, value: "TASK-proj-003" });
  });
});
