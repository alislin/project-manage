import { describe, it, expect } from "vitest";
import {
  allocateSeq,
  isNumberId,
  parseNumberId,
  REQ_ID_PATTERN,
  TASK_ID_PATTERN,
  INBOX_ID_PATTERN,
} from "../src/id";
import { E_SEQ_EXHAUSTED } from "../src/errors";

/** TC-01 · 01-数据规范 §1.5 编号分配 + 02-core §2.7 allocateId（纯函数） */
describe("TC-01 编号分配", () => {
  it("TC-01-025: 编号池耗尽（>999）→ E_SEQ_EXHAUSTED", () => {
    const r = allocateSeq(["REQ-proj-999"], "REQ", "proj");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(E_SEQ_EXHAUSTED);
  });

  it("doc: 下一序号 = 同前缀+同 slug 最大序号 + 1；无现有 → 001", () => {
    expect(allocateSeq([], "REQ", "proj")).toEqual({ ok: true, value: "REQ-proj-001" });
    expect(allocateSeq(["REQ-proj-001"], "REQ", "proj")).toEqual({ ok: true, value: "REQ-proj-002" });
    expect(allocateSeq(["REQ-proj-998"], "REQ", "proj")).toEqual({ ok: true, value: "REQ-proj-999" });
  });

  it("doc: 同前缀同 slug 隔离（01-数据规范 §1.5）", () => {
    expect(allocateSeq(["REQ-a-002"], "REQ", "proj")).toEqual({ ok: true, value: "REQ-proj-001" });
    expect(allocateSeq(["TASK-proj-002"], "REQ", "proj")).toEqual({ ok: true, value: "REQ-proj-001" });
    expect(allocateSeq(["REQ-proj-002"], "TASK", "proj")).toEqual({ ok: true, value: "TASK-proj-001" });
    expect(allocateSeq(["REQ-proj-001", "REQ-proj-005"], "REQ", "proj")).toEqual({ ok: true, value: "REQ-proj-006" });
  });

  it("doc: parseNumberId 解析 slug 与序号（纯函数）", () => {
    expect(parseNumberId("REQ", "REQ-proj-001")).toEqual({ slug: "proj", seq: 1 });
    expect(parseNumberId("INBOX", "INBOX-inbox-007")).toEqual({ slug: "inbox", seq: 7 });
    expect(parseNumberId("REQ", "REQ-proj-01")).toBeNull();
  });

  it("doc: 编号正则校验 isNumberId（纯函数，R-106）", () => {
    expect(isNumberId("REQ", "REQ-proj-001")).toBe(true);
    expect(isNumberId("REQ", "REQ-proj-01")).toBe(false);
    expect(isNumberId("REQ", "REQ-proj-1000")).toBe(false);
    expect(isNumberId("TASK", "TASK-proj-001")).toBe(true);
    expect(isNumberId("INBOX", "INBOX-inbox-001")).toBe(true);
    expect(isNumberId("INBOX", "INBOX--001")).toBe(false);
    expect(REQ_ID_PATTERN.test("REQ-proj-001")).toBe(true);
    expect(TASK_ID_PATTERN.test("TASK-proj-001")).toBe(true);
    expect(INBOX_ID_PATTERN.test("INBOX-inbox-001")).toBe(true);
  });
});
