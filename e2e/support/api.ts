/**
 * REST API 造数助手（S12）：测试进程直接调用 pm serve 的统一信封接口
 * （05-server §1.1 { ok, data, error }），用于在浏览器打开前准备项目/需求/任务数据。
 */
import { BASE_URL } from "./paths";

export interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export interface CreatedProject {
  created: { id: string; slug: string; path: string; mtimeMs: number };
}
export interface CreatedRequirement {
  id: string;
  path: string;
  mtimeMs: number;
}
export interface CreatedTask {
  created: { id: string; path: string; mtimeMs: number };
  task?: { id: string; status: string };
}
export interface DerivedTask {
  requirementId: string;
  task?: { id: string; status: string; title: string };
  created: { id: string; path: string };
}

async function api<T>(method: string, apiPath: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${apiPath}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const env = (await res.json()) as Envelope<T>;
  if (!res.ok || !env.ok) {
    throw new Error(`E2E API ${method} ${apiPath} 失败: HTTP ${res.status} ${env.error?.code ?? "?"} ${env.error?.message ?? ""}`);
  }
  return env.data as T;
}

export const e2eApi = {
  /** 05-server §2.2 新建项目（period 默认今天起止） */
  createProject(slug: string, name: string): Promise<CreatedProject> {
    return api<CreatedProject>("POST", "/api/projects", { slug, name, period: [localToday(), localToday()], tags: ["e2e"] });
  },

  /** 05-server §2.5 新建需求（默认 pool/P2） */
  createRequirement(
    slug: string,
    title: string,
    opts: { module?: string; priority?: "P0" | "P1" | "P2" | "P3"; status?: string; source?: string } = {},
  ): Promise<CreatedRequirement> {
    return api<CreatedRequirement>("POST", `/api/projects/${encodeURIComponent(slug)}/requirements`, {
      title,
      module: opts.module ?? "",
      source: opts.source ?? "e2e S12",
      priority: opts.priority ?? "P2",
      status: opts.status ?? "pool",
    });
  },

  /** 05-server §3.2 新建任务（wiki-link 关联需求） */
  createTask(
    slug: string,
    reqId: string,
    title: string,
    opts: { priority?: "P0" | "P1" | "P2" | "P3"; due?: string; status?: string; estimate?: number } = {},
  ): Promise<CreatedTask> {
    return api<CreatedTask>("POST", `/api/projects/${encodeURIComponent(slug)}/tasks`, {
      requirement: `[[${reqId}]]`,
      title,
      priority: opts.priority ?? "P2",
      due: opts.due ?? localToday(7),
      status: opts.status ?? "todo",
      ...(opts.estimate !== undefined ? { estimate: opts.estimate } : {}),
    });
  },

  /** 05-server §2.7 需求状态流转（无 expectedMtimeMs：服务端按索引 mtime 直写） */
  patchRequirement(id: string, status: string): Promise<{ id: string; from: string; to: string }> {
    return api("PATCH", `/api/requirements/${encodeURIComponent(id)}`, { status });
  },

  /** 05-server §3.3 任务状态流转 */
  patchTask(id: string, status: string): Promise<{ id: string; from: string; to: string }> {
    return api("PATCH", `/api/tasks/${encodeURIComponent(id)}`, { status });
  },

  /** 05-server §2.8 accepted 需求派生任务（默认 due = today+7，title = 需求标题） */
  deriveTask(reqId: string, opts: { title?: string } = {}): Promise<DerivedTask> {
    return api<DerivedTask>("POST", `/api/requirements/${encodeURIComponent(reqId)}/derive-task`, opts.title ? { title: opts.title } : {});
  },

  /** 05-server §2.4 需求列表（等待 SSE/索引收敛时轮询用） */
  listRequirements(slug: string): Promise<{ requirements: Array<{ id: string; status: string; title: string }> }> {
    return api("GET", `/api/projects/${encodeURIComponent(slug)}/requirements`);
  },
};

/** 本地时区 today（与 02-core today() / 06-web todayIso() 同算法，支持 ±n 天偏移） */
export function localToday(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
