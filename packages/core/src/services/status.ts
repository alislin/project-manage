import fs from "node:fs";
import matter from "gray-matter";
import { E_CONFLICT, E_INVALID_TRANSITION, E_NOT_FOUND } from "../errors";
import { reindexFile } from "../indexer";
import { atomicWriteFile } from "../writer";
import { ok, err, today, type AppResult, type FileEntry, type MoveOutcome, type VaultIndex } from "../types";
import type { Project, Requirement, Task } from "../schema";

/**
 * 流转前置表（design §4.7 + 01-数据规范 §3.1–3.3）。
 * design §4.7 调用 isValidTransition(from, to, index)；此处用合法行合并集，
 * 覆盖三类实体（project/requirement/task）的全部合法流转，且同状态非法。
 */
const LEGAL_TRANSITIONS: ReadonlySet<string> = new Set([
  // project（01-数据规范 §3.1）
  "active->paused", "paused->active", "active->done", "active->archived", "done->archived",
  // requirement（01-数据规范 §3.2）
  "pool->reviewing", "pool->rejected", "reviewing->accepted", "reviewing->rejected", "accepted->done", "rejected->pool",
  // task（01-数据规范 §3.3）
  "todo->doing", "todo->done", "todo->cancelled", "doing->done", "doing->cancelled", "cancelled->todo",
]);

/** design §4.7.1：moveLocks：Map<FileEntry.relPath, Promise<void>>（同步实现内天然串行） */
export const moveLocks = new Map<string, Promise<void>>();

/** 校验流转合法性（design §4.7, 01-数据规范 §3.1–3.3 表） */
export function isValidTransition(from: string, to: string, index: VaultIndex): boolean {
  return LEGAL_TRANSITIONS.has(`${from}->${to}`);
}

interface MoveTarget {
  file: FileEntry;
  record: Project | Requirement | Task;
}

/** 查记录（byPath，design §4.7 步骤 1；byPath key = FileEntry.absPath，design §5.2.10） */
function findMoveTarget(index: VaultIndex, id: string): MoveTarget | undefined {
  for (const [absPath, rec] of index.byPath) {
    if ("id" in rec && rec.id === id && "status" in rec) {
      const file = index.scan.entries.find((e) => e.absPath === absPath);
      if (file) return { file, record: rec as Project | Requirement | Task };
    }
  }
  return undefined;
}

/**
 * 状态流转核心（design §4.7，`pm move` 共用实现）：
 * 1. 查记录（byPath）不存在 → E_NOT_FOUND
 * 2. isValidTransition 检查 → E_INVALID_TRANSITION（message 含拒绝原因）
 * 3. 更新 frontmatter（status + 副作用 updated=today，completed=today 条件，design §4.7 + 01-数据规范 §3.3）
 * 4. atomicWriteFile（expectedMtimeMs 复查，冲突返回 E_CONFLICT）；成功则 reindex（design §5.4）
 * 5. 返回 MoveOutcome（新状态、是否置 completed）
 * 步骤 1–4 在按路径 move 锁（design §4.7.1）内串行。
 */
export function moveStatus(index: VaultIndex, id: string, next: string): AppResult<MoveOutcome> {
  const target = findMoveTarget(index, id);
  if (!target) return err({ code: E_NOT_FOUND, message: `记录 ${id} 不存在（02-core §4.7）` });
  const relPath = target.file.relPath;
  if (moveLocks.has(relPath)) {
    return err({ code: E_CONFLICT, message: `路径 ${relPath} 正在处理并发流转，请刷新重试`, file: target.file.absPath, httpStatus: 409 });
  }
  moveLocks.set(relPath, Promise.resolve());
  try {
    const from = target.record.status;
    if (!isValidTransition(from, next, index)) {
      return err({ code: E_INVALID_TRANSITION, message: `非法状态流转: ${from} -> ${next}（01-数据规范 §3.4）`, file: target.file.absPath, field: "status" });
    }

    // 3. 更新 frontmatter（status + 副作用）
    const matterFile = matter(fs.readFileSync(target.file.absPath, "utf8"));
    const newData: Record<string, unknown> = { ...matterFile.data, status: next, updated: today() };
    let completedSet = false;
    if (target.record.type === "task" && next === "done") {
      newData.completed = today(); // design §3.3：todo→done / doing→done 设置 completed
      completedSet = true;
    }
    const content = matter.stringify(matterFile, newData);

    // 4. atomicWriteFile（expectedMtimeMs 复查，冲突返回 E_CONFLICT）；成功则 reindex（design §5.4）
    const res = atomicWriteFile(target.file.absPath, content, { expectedMtimeMs: target.file.mtimeMs, pmRoot: index.config.pmRoot });
    if (!res.ok) return res;
    // 同步 scan entry 的 mtimeMs（写后本次移动已反映到文件，保持后续 expectedMtimeMs 与实际一致）
    const scanEntry = index.scan.entries.find((e) => e.absPath === target.file.absPath);
    if (scanEntry) scanEntry.mtimeMs = res.written.mtimeMs;
    reindexFile(index, target.file.absPath);

    // 5. 返回 MoveOutcome
    return ok({
      ok: true,
      moved: true,
      from,
      to: next,
      updated: true,
      completedSet,
      file: res.written,
      newStatuses: [{ id, status: next }],
    });
  } finally {
    moveLocks.delete(relPath);
  }
}
