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
