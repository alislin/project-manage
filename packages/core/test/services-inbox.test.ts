import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { archiveInboxEntry, buildIndex, listInbox, today, type Config, type VaultIndex } from "../src/index";

/** TC-02 · services/inbox 收集箱（03-cli §7.2/§7.4，01-数据规范 §7，TC-03-035/036/038/039/040） */

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

const INBOX_MD = (id: string, created: string, body: string): string => `---
type: inbox
id: ${id}
slug: inbox
created: "${created}"
tags: ["想法"]
source: 人工收集
archived: null
---
${body}
`;

function makeInboxIndex(files: Array<{ rel: string; content: string }>): VaultIndex {
  const vault = makeTempRoot("vault-inbox-");
  for (const f of files) write(vault, f.rel, f.content);
  return buildIndex(makeConfig(vault));
}

describe("TC-03 services/inbox（pm inbox 共用实现）", () => {
  it("TC-03-035: listInbox 按 created 降序，字段齐全（id/created/tags/source/file/bodyFirstLine/status）", () => {
    const index = makeInboxIndex([
      { rel: "inbox/2026-11-18-old.md", content: INBOX_MD("INBOX-inbox-002", "2026-11-18", "支付回调失败") },
      { rel: "inbox/2026-11-19-idea.md", content: INBOX_MD("INBOX-inbox-001", "2026-11-19", "需要加 OAuth 登录") },
    ]);
    const result = listInbox(index);
    expect(result.count).toBe(2);
    expect(result.entries[0].id).toBe("INBOX-inbox-001"); // created 降序
    expect(result.entries[0].created >= result.entries[1].created).toBe(true);
    for (const e of result.entries) {
      expect(e.status).toBe("active");
      expect(e.file.startsWith("inbox/")).toBe(true);
      expect(e.tags).toEqual(["想法"]);
      expect(e.source).toBe("人工收集");
    }
    expect(result.entries[0].bodyFirstLine).toBe("需要加 OAuth 登录");
    expect(result.entries[1].bodyFirstLine).toBe("支付回调失败");
  });

  it("TC-03-036: listInbox 空 inbox（count=0）", () => {
    const index = makeInboxIndex([{ rel: "projects/proj/project.md", content: "---\ntype: project\nid: proj\nname: p\nstatus: active\nperiod: [\"2026-01-01\", \"2026-12-31\"]\ntags: []\n---\n" }]);
    const result = listInbox(index);
    expect(result.count).toBe(0);
    expect(result.entries).toEqual([]);
  });

  it("TC-03-038: archiveInboxEntry 移动到 inbox/archive/，archived=今天，正文保留，list 不再列出", () => {
    const index = makeInboxIndex([
      { rel: "inbox/2026-11-19-idea.md", content: INBOX_MD("INBOX-inbox-001", "2026-11-19", "需要加 OAuth 登录") },
    ]);
    const res = archiveInboxEntry(index, "INBOX-inbox-001");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { from, to, archivedDate } = res.value.archived;
    expect(archivedDate).toBe(today());
    expect(from.endsWith(path.join("inbox", "2026-11-19-idea.md"))).toBe(true);
    expect(to.endsWith(path.join("inbox", "archive", "2026-11-19-idea.md"))).toBe(true);
    // 原文件已移走，归档文件保留正文并标记归档
    expect(fs.existsSync(from)).toBe(false);
    const archived = fs.readFileSync(to, "utf8");
    expect(archived).toContain("archived");
    expect(archived).toContain(today());
    expect(archived).toContain("需要加 OAuth 登录");
    // 归档产物不入索引 → fresh index 上 list 为空
    const fresh = buildIndex(makeConfig(index.config.vaultPath));
    expect(listInbox(fresh).count).toBe(0);
  });

  it("TC-03-039: archiveInboxEntry 编号不存在 → E_NOT_FOUND", () => {
    const index = makeInboxIndex([
      { rel: "inbox/2026-11-19-idea.md", content: INBOX_MD("INBOX-inbox-001", "2026-11-19", "需要加 OAuth 登录") },
    ]);
    const res = archiveInboxEntry(index, "INBOX-inbox-999");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("E_NOT_FOUND");
  });

  it("TC-03-040: archiveInboxEntry 非法 id（\"bad-id\"）→ E_NOT_FOUND（按 id 查找）", () => {
    const index = makeInboxIndex([
      { rel: "inbox/2026-11-19-idea.md", content: INBOX_MD("INBOX-inbox-001", "2026-11-19", "需要加 OAuth 登录") },
    ]);
    const res = archiveInboxEntry(index, "bad-id");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("E_NOT_FOUND");
  });
});
