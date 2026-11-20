/**
 * 看板纯逻辑（S7，06-web §3.1/§6/§11）：状态流转表、逾期判定、筛选、排序、分组。
 * 不依赖 Vue/Pinia——便于组件级 vitest 直接断言（TC-06-004/011/012 对应逻辑层）。
 */
import type {
  Priority,
  RequirementItem,
  TaskItem,
  TaskStatus,
} from "../api/types";

// ---------------------------------------------------------------------------
// 状态流转表（与 02-core isValidTransition 同源，01-数据规范 §3.2/§3.3）
// ---------------------------------------------------------------------------

/** 01-数据规范 §3.2 requirement 合法流转（done 终态；rejected → pool 退回重塑） */
export const REQ_TRANSITIONS: Readonly<Record<ReqStatus, readonly ReqStatus[]>> = {
  pool: ["reviewing", "rejected"],
  reviewing: ["accepted", "rejected"],
  accepted: ["done"],
  rejected: ["pool"],
  done: [],
};

/** 01-数据规范 §3.3 task 合法流转（doing → todo 回退不允许；done 终态；cancelled → todo 重开） */
export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  todo: ["doing", "done", "cancelled"],
  doing: ["done", "cancelled"],
  done: [],
  cancelled: ["todo"],
};

export function legalReqTargets(status: ReqStatus): readonly ReqStatus[] {
  return REQ_TRANSITIONS[status];
}

export function legalTaskTargets(status: TaskStatus): readonly TaskStatus[] {
  return TASK_TRANSITIONS[status];
}

/** 流转按钮文案（列表行内快捷流转 + 详情模态流转按钮） */
export const MOVE_LABELS: Readonly<Record<string, string>> = {
  pool: "退回重塑",
  reviewing: "送审",
  accepted: "接受",
  rejected: "拒绝",
  done: "完成",
  todo: "重开",
  doing: "开始",
  cancelled: "取消",
};

// ---------------------------------------------------------------------------
// 日期与逾期（02-core §2.4 overdue 口径：status ∈ {todo, doing} && due < today）
// ---------------------------------------------------------------------------

/** 本地时区 today（YYYY-MM-DD；02-core §8 `today()` 前端口径） */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isTaskOverdue(task: Pick<TaskItem, "status" | "due">, today: string = todayIso()): boolean {
  return (task.status === "todo" || task.status === "doing") && task.due < today;
}

// ---------------------------------------------------------------------------
// Wiki-link（01-数据规范 §6.1：任务侧单写 "[[REQ-<slug>-NNN]]"）
// ---------------------------------------------------------------------------

/** "[[REQ-demo-001]]" → "REQ-demo-001"（非 wiki 形式原样返回空串） */
export function wikiId(requirement: string): string {
  const m = /^\[\[(.+)\]\]$/.exec(requirement.trim());
  return m?.[1] ?? "";
}

// ---------------------------------------------------------------------------
// 筛选（S7-6：需求池/任务看板按 module 与 priority；TC-06-012：任务列表状态/优先级多选+搜索）
// ---------------------------------------------------------------------------

export interface RequirementFilters {
  /** "" = 全部模块 */
  module: string;
  /** "" = 全部优先级 */
  priority: "" | Priority;
}

export function filterRequirements(items: RequirementItem[], f: RequirementFilters): RequirementItem[] {
  return items.filter(
    (it) => (f.module === "" || it.module === f.module) && (f.priority === "" || it.priority === f.priority),
  );
}

/** 模块下拉选项：非空模块去重 + 字典序（空 module 项仅在"全部"时可见） */
export function requirementModuleOptions(items: Array<Pick<RequirementItem, "module">>): string[] {
  return [...new Set(items.map((i) => i.module).filter((m) => m !== ""))].sort((a, b) => a.localeCompare(b));
}

export interface TaskFilters {
  /** 多选；空数组 = 全部 */
  statuses: TaskStatus[];
  /** 多选；空数组 = 全部 */
  priorities: Priority[];
  /** ID/标题子串（不区分大小写） */
  query: string;
}

export function filterTasks(items: TaskItem[], f: TaskFilters): TaskItem[] {
  const q = f.query.trim().toLowerCase();
  return items.filter((it) => {
    if (f.statuses.length > 0 && !f.statuses.includes(it.status)) return false;
    if (f.priorities.length > 0 && !f.priorities.includes(it.priority)) return false;
    if (q !== "" && !`${it.id} ${it.title}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// 排序（06-web §11：默认 优先级倒序 > 截止日期升序 > updated 倒序）
// ---------------------------------------------------------------------------

const PRIORITY_RANK: Readonly<Record<Priority, number>> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const TASK_STATUS_ORDER: readonly TaskStatus[] = ["todo", "doing", "done", "cancelled"];

export type TaskSortKey = "title" | "status" | "priority" | "due" | "updated";

function byPriorityDesc(a: TaskItem, b: TaskItem): number {
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
}

/** 06-web §11 默认排序：优先级倒序（P0 前）> due 升序 > updated 倒序 */
export function defaultSortTasks(items: TaskItem[]): TaskItem[] {
  return [...items].sort((a, b) => {
    const p = byPriorityDesc(a, b);
    if (p !== 0) return p;
    if (a.due !== b.due) return a.due < b.due ? -1 : 1;
    if (a.updated !== b.updated) return a.updated > b.updated ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** 显式排序（列表表头点击）：dir=1 升序 / -1 降序 */
export function sortTaskItems(items: TaskItem[], key: TaskSortKey, dir: 1 | -1): TaskItem[] {
  const rank = (t: TaskItem): number => {
    switch (key) {
      case "status":
        return TASK_STATUS_ORDER.indexOf(t.status);
      case "priority":
        return PRIORITY_RANK[t.priority];
      default:
        return 0;
    }
  };
  return [...items].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r * dir;
    const av = a[key];
    const bv = b[key];
    if (av === bv) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    return (av < bv ? -1 : 1) * dir;
  });
}

// ---------------------------------------------------------------------------
// 看板分组（06-web §2.2：列内卡片按 store items 顺序，SSE refresh 收敛）
// ---------------------------------------------------------------------------

export function groupRequirements(items: RequirementItem[]): Record<ReqStatus, RequirementItem[]> {
  const grouped: Record<ReqStatus, RequirementItem[]> = { pool: [], reviewing: [], accepted: [], rejected: [], done: [] };
  for (const it of items) grouped[it.status].push(it);
  return grouped;
}

export function groupTasks(items: TaskItem[]): Record<TaskStatus, TaskItem[]> {
  const grouped: Record<TaskStatus, TaskItem[]> = { todo: [], doing: [], done: [], cancelled: [] };
  for (const it of items) grouped[it.status].push(it);
  return grouped;
}
