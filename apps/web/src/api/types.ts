/**
 * API 响应类型（05-server §1.1/§2，06-web §1 约定）。
 * 所有响应统一外壳 `{ ok, data, error }`，前端经 `api/client.ts` 解包。
 */

/** 02-core §2.4 Progress（GET /api/projects 载荷内嵌） */
export interface Progress {
  completedRate: number;
  overdueCount: number;
  totalTasks: number;
  doneTasks: number;
  cancelledTasks: number;
  onTrack: number;
}

export type ProjectStatus = "active" | "paused" | "done" | "archived";

/** 05-server §2.1 GET /api/projects 的项目条目 */
export interface ProjectSummary {
  slug: string;
  name: string;
  status: ProjectStatus;
  period: [string, string];
  tags: string[];
  progress: Progress;
  mtimeMs: number;
}

export interface ProjectsData {
  projects: ProjectSummary[];
}

/** 05-server §1.1 统一错误体 */
export interface ApiErrorBody {
  code: string;
  message: string;
  file?: string;
  field?: string;
  expectedMtimeMs?: number;
  currentMtimeMs?: number;
  issues?: Array<{ file: string; field: string; code: string; message: string }>;
}

/** 05-server §1.1 统一响应外壳 */
export interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: ApiErrorBody;
}

/** 05-server §5.2 SSE 事件载荷 */
export interface VaultUpdatedPayload {
  changes: Array<{ op: "add" | "change" | "unlink"; path: string }>;
  revision: number;
}

// ---------------------------------------------------------------------------
// S7 看板/详情（05-server §2.4-§3.4，实体同源 02-core §2.3 / 01-数据规范 §1.2/§1.3）
// ---------------------------------------------------------------------------

export type ReqStatus = "pool" | "reviewing" | "accepted" | "rejected" | "done";
export type TaskStatus = "todo" | "doing" | "done" | "cancelled";
export type Priority = "P0" | "P1" | "P2" | "P3";

/** 01-数据规范 §1.2 需求 frontmatter（ZRequirement 同源） */
export interface Requirement {
  type: "requirement";
  id: string;
  title: string;
  status: ReqStatus;
  priority: Priority;
  module: string;
  source: string;
  created: string;
  updated: string;
}

/** GET 载荷条目：实体 + mtimeMs（05-server §2.4，拖拽流转冲突检测基准） */
export type RequirementItem = Requirement & { mtimeMs: number };

/** 01-数据规范 §1.3 任务 frontmatter（ZTask 同源；requirement = "[[REQ-…]]" 单写原则） */
export interface Task {
  type: "task";
  id: string;
  title: string;
  status: TaskStatus;
  requirement: string;
  priority: Priority;
  estimate?: number;
  due: string;
  completed: string | null;
  created: string;
  updated: string;
}

/** GET 载荷条目：实体 + mtimeMs（05-server §3.1） */
export type TaskItem = Task & { mtimeMs: number };

/** 05-server §2.4 降级可见的待修复文件（02-core §3.2） */
export interface BrokenFile {
  file: string;
  field?: string;
  code: string;
  message: string;
}

/** 05-server §2.4 GET /api/projects/:slug/requirements */
export interface RequirementsData {
  requirements: RequirementItem[];
  brokenFiles?: BrokenFile[];
}

/** 05-server §3.1 GET /api/projects/:slug/tasks */
export interface TasksData {
  tasks: TaskItem[];
}

/** 05-server §2.6 GET /api/requirements/:id（relatedTasks = 反链聚合） */
export interface RequirementDetailData {
  requirement: RequirementItem;
  relatedTasks: Task[];
}

/** 05-server §3.4 GET /api/tasks/:id（relatedRequirement = 反向查询） */
export interface TaskDetailData {
  task: TaskItem;
  relatedRequirement?: RequirementItem;
}

/** 05-server §2.7/§3.3 PATCH body（状态流转 + 冲突检测基准，06-web §3.1） */
export interface PatchStatusBody {
  status: string;
  expectedMtimeMs?: number;
}

/** 05-server §2.7/§3.3 PATCH 响应 */
export interface PatchStatusData {
  id: string;
  from: string;
  to: string;
  updatedField: "updated" | "updated+completed";
  mtimeMs: number;
}

// ---------------------------------------------------------------------------
// S8 进度总览（05-server §2.3 GET /api/projects/:slug/overview）
// ---------------------------------------------------------------------------

/** 05-server §2.3 overview 内嵌项目（02-core Project 索引条目 + mtimeMs；id = slug） */
export interface OverviewProject {
  id: string;
  name: string;
  status: ProjectStatus;
  mtimeMs: number;
}

/** 05-server §2.3 totals：需求/任务总数与状态分布（漏斗/环形图数据源） */
export interface OverviewTotals {
  requirements: { total: number; byStatus: Partial<Record<ReqStatus, number>> };
  tasks: { total: number; overdue: number; byStatus: Partial<Record<TaskStatus, number>>; onTrack: number };
}

/** 05-server §2.3 GET /api/projects/:slug/overview 载荷 */
export interface OverviewData {
  project: OverviewProject;
  progress: Progress;
  totals: OverviewTotals;
  /** 需求交付漏斗汇总（06-web §7：done/total/rate） */
  periods: { done: number; total: number; rate: number };
  /** 索引构建时间（02-core §2.3 builtAt，可选） */
  lastSync?: string;
}
