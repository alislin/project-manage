import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runInboxList, runInboxProcess, runInboxArchive } from "../src/commands/inbox";
import { makeVaultRoot, writePmFile, readPmFile, pathExists, today } from "./helpers";

/** TC-03 · CLI inbox 用例（03-cli §7，01-数据规范 §7；临时目录 vault fixture） */

const INBOX_001_MD = `---
type: inbox
id: INBOX-inbox-001
slug: inbox
created: "2026-11-19"
tags: ["想法"]
source: 人工收集
archived: null
---
- 需要加 OAuth 登录
`;

const INBOX_002_MD = `---
type: inbox
id: INBOX-inbox-002
slug: inbox
created: "2026-11-18"
tags: ["bug"]
source: 人工收集
archived: null
---
支付回调失败
`;

describe("TC-03 inbox", () => {
  let root: string;
  let vault: string;

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function newRoot(): string {
    root = makeVaultRoot("pm-cli-inbox-");
    return (vault = path.join(root, "vault"));
  }

  function inboxFileNames(): string[] {
    const dir = path.join(vault, "PM", "inbox");
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  }

  it("TC-03-035: pm inbox list --json（created 降序，字段齐全，status=active）", async () => {
    const v = newRoot();
    writePmFile(v, "inbox/2026-11-19-idea.md", INBOX_001_MD);
    writePmFile(v, "inbox/2026-11-18-old.md", INBOX_002_MD);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runInboxList({ root, json: true });
    expect(code).toBe(0);
    const parsed = JSON.parse(logSpy.mock.calls.map((c) => String(c[0])).join(""));
    expect(parsed.count).toBe(2);
    expect(parsed.entries[0].id).toBe("INBOX-inbox-001"); // created 降序
    expect(parsed.entries[0].created >= parsed.entries[1].created).toBe(true);
    expect(parsed.entries[0].status).toBe("active");
    expect(parsed.entries[0].file).toBe("inbox/2026-11-19-idea.md");
    expect(parsed.entries[0].bodyFirstLine).toBe("- 需要加 OAuth 登录");
    expect(parsed.entries[0].tags).toEqual(["想法"]);
    expect(parsed.entries[0].source).toBe("人工收集");
  });

  it("TC-03-036: pm inbox list 空 inbox（exit 0，count=0）", async () => {
    newRoot();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runInboxList({ root, json: true });
    expect(code).toBe(0);
    const parsed = JSON.parse(logSpy.mock.calls.map((c) => String(c[0])).join(""));
    expect(parsed.count).toBe(0);
    expect(parsed.entries).toEqual([]);
  });

  it("TC-03-037: pm inbox process 预览 + --dry-run --json（不产生写入/归档）", async () => {
    const v = newRoot();
    writePmFile(v, "inbox/2026-11-19-idea.md", INBOX_001_MD);
    writePmFile(v, "inbox/2026-11-18-old.md", INBOX_002_MD);
    const before = inboxFileNames();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const code1 = await runInboxProcess({ root }); // 人类输出
    expect(code1).toBe(0);
    const human = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(human).toContain("inbox 未处理（2 条）");
    expect(human).toContain("INBOX-inbox-001");

    const code2 = await runInboxProcess({ root, json: true, dryRun: true, limit: 1 });
    expect(code2).toBe(0);
    const parsed = JSON.parse(logSpy.mock.calls.map((c) => String(c[0])).at(-1));
    expect(parsed.count).toBe(1); // limit=1 截断
    expect(parsed.entries[0].id).toBe("INBOX-inbox-001");
    expect(inboxFileNames()).toEqual(before); // --dry-run：不产生写入/归档
  });

  it("TC-03-037 补充: pm inbox process --limit 非正数（E_USAGE，exit 2）", async () => {
    newRoot();
    const code = await runInboxProcess({ root, limit: 0 });
    expect(code).toBe(2);
  });

  it("TC-03-038: pm inbox archive（移动 + archived=今天 + 正文保留 + list 不再列出）", async () => {
    const v = newRoot();
    writePmFile(v, "inbox/2026-11-19-idea.md", INBOX_001_MD);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await runInboxArchive({ root, id: "INBOX-inbox-001" });
    expect(code).toBe(0);
    const out = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("已归档至 PM/inbox/archive/2026-11-19-idea.md");
    expect(pathExists(v, "inbox/2026-11-19-idea.md")).toBe(false);
    expect(pathExists(v, "inbox/archive/2026-11-19-idea.md")).toBe(true);
    const archived = readPmFile(v, "inbox/archive/2026-11-19-idea.md");
    expect(archived).toContain(String(today()));
    expect(archived).toContain("需要加 OAuth 登录"); // 正文保留
    // 归档产物不入索引：list 不再列出（TC-03-038 预期）
    const code2 = await runInboxList({ root, json: true });
    expect(code2).toBe(0);
    const parsed = JSON.parse(logSpy.mock.calls.map((c) => String(c[0])).at(-1) ?? "");
    expect(parsed.count).toBe(0);
  });

  it("TC-03-039: pm inbox archive 不存在 id（E_NOT_FOUND，exit 1）", async () => {
    newRoot();
    const code = await runInboxArchive({ root, id: "INBOX-inbox-999" });
    expect(code).toBe(1);
  });

  it("TC-03-040: pm inbox archive 非法 id（\"bad-id\" → E_NOT_FOUND，exit 1）", async () => {
    newRoot();
    const code = await runInboxArchive({ root, id: "bad-id" });
    expect(code).toBe(1);
  });
});
