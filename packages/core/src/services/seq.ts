import { allocateSeq } from "../id";
import { ok, type AppResult, type VaultIndex } from "../types";

/**
 * 编号分配（design §4.7, 01-数据规范 §1.5/§2.6）：
 * 扫同前缀+slug 最大序号+1（001 起）；序号 > 999 → E_SEQ_EXHAUSTED（不静默改格式）。
 * "project" 前缀无序号（projects.id = slug，01-数据规范 §1.5）。
 */
export function allocateId(index: VaultIndex, prefix: "REQ" | "TASK" | "INBOX" | "project", slug: string): AppResult<string> {
  if (prefix === "project") return ok(slug);
  const existing =
    prefix === "REQ"
      ? index.requirements.map((r) => r.id)
      : prefix === "TASK"
        ? index.tasks.map((t) => t.id)
        : index.inboxEntries.map((e) => e.id);
  return allocateSeq(existing, prefix, slug);
}
