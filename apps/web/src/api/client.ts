/**
 * API client（06-web §1 约定 / 05-server §1.1）：
 * - fetch 封装，统一解包 `{ ok, data, error }` 信封；
 * - 失败（网络/HTTP/信封 error）抛 `ApiError`，并触发全局错误回调（供 ErrorToast 提示）；
 * - 调用方只需 `await api.listProjects()` 即可获得 `data` 载荷。
 */
import type {
  ApiErrorBody,
  CreateProjectData,
  Envelope,
  NewProjectBody,
  OverviewData,
  PatchStatusBody,
  PatchStatusData,
  ProjectsData,
  RequirementDetailData,
  RequirementsData,
  TaskDetailData,
  TasksData,
} from "./types";

/** 客户端补充的错误码（非服务端 02-core §3.1 错误码） */
export const E_NETWORK = "E_NETWORK";
export const E_INVALID_RESPONSE = "E_INVALID_RESPONSE";

/**
 * E_INVALID_RESPONSE 统一排查指引（S11 hotfix 问题 2）：
 * HTTP 200 但响应非 JSON/缺信封，典型根因是后端未启动，或 dev 代理（vite server.proxy）
 * 指向了错误端口——被占用的 3000 上跑着别的应用。文案附可行动的指引并在 ErrorToast 完整展示。
 */
const INVALID_RESPONSE_HINT = "后端未启动或 API 端口不符，请运行 pm serve 或设置 PM_API_TARGET";

export class ApiError extends Error {
  /** 服务端错误码（02-core §3.1）或客户端 E_NETWORK / E_INVALID_RESPONSE */
  readonly code: string;
  readonly status: number;
  readonly body?: ApiErrorBody;

  constructor(code: string, message: string, status: number, body?: ApiErrorBody) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

type ErrorHook = (err: ApiError) => void;
let onErrorHook: ErrorHook | null = null;

/** 注册全局错误钩子（App 挂载时接 ErrorToast；每个请求失败后调用一次） */
export function setApiErrorHandler(hook: ErrorHook | null): void {
  onErrorHook = hook;
}

/** 统一失败出口：先触发全局钩子再抛出 */
function fail(err: ApiError): never {
  onErrorHook?.(err);
  throw err;
}

/** 统一请求：返回信封 data；失败抛 ApiError（先触发全局钩子再抛出） */
export async function apiRequest<T>(path: string, init?: RequestInit, opts?: { silent?: boolean }): Promise<T> {
  /** `silent=true` 不触发全局 Toast（如拖拽流转，由 store 自行决定提示与回滚，06-web §3.1） */
  function fail(err: ApiError): never {
    if (!opts?.silent) onErrorHook?.(err);
    throw err;
  }

  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    fail(new ApiError(E_NETWORK, "网络不可用，请检查服务是否启动", 0));
  }

  let envelope: Envelope<T> | null = null;
  try {
    envelope = (await res.json()) as Envelope<T>;
  } catch {
    // S11：HTTP 200 但非 JSON（如代理打到别的应用返回 HTML）→ 明确文案 + 排查指引
    fail(
      new ApiError(
        E_INVALID_RESPONSE,
        `${INVALID_RESPONSE_HINT}（HTTP ${res.status}，响应非 JSON）`,
        res.status,
      ),
    );
  }

  if (!envelope || typeof envelope.ok !== "boolean") {
    fail(
      new ApiError(
        E_INVALID_RESPONSE,
        `${INVALID_RESPONSE_HINT}（HTTP ${res.status}，响应缺少统一信封）`,
        res.status,
      ),
    );
  }
  if (!envelope.ok) {
    const body = envelope.error ?? { code: E_INVALID_RESPONSE, message: "未知服务端错误" };
    fail(new ApiError(body.code, body.message, res.status, body));
  }
  return (envelope.data ?? {}) as T;
}

/** JSON 请求体 init（PATCH 状态流转等写操作） */
function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

/** 常用端点封装（05-server §2-§4） */
export const api = {
  /** 05-server §2.1 GET /api/projects */
  listProjects: () => apiRequest<ProjectsData>("/api/projects"),

  /** 05-server §2.2 POST /api/projects（S11 新建项目表单） */
  createProject: (body: NewProjectBody) =>
    apiRequest<CreateProjectData>("/api/projects", jsonInit("POST", body)),

  /** 05-server §2.3 GET /api/projects/:slug/overview（S8 进度总览数据源） */
  getOverview: (slug: string) =>
    apiRequest<OverviewData>(`/api/projects/${encodeURIComponent(slug)}/overview`),

  /** 05-server §2.4 GET /api/projects/:slug/requirements */
  listRequirements: (slug: string) =>
    apiRequest<RequirementsData>(`/api/projects/${encodeURIComponent(slug)}/requirements`),

  /** 05-server §2.6 GET /api/requirements/:id（详情 + relatedTasks 反链） */
  getRequirement: (id: string) =>
    apiRequest<RequirementDetailData>(`/api/requirements/${encodeURIComponent(id)}`),

  /** 05-server §2.7 PATCH /api/requirements/:id（拖拽/手动流转；silent → store 接管提示与回滚） */
  patchRequirement: (id: string, body: PatchStatusBody) =>
    apiRequest<PatchStatusData>(`/api/requirements/${encodeURIComponent(id)}`, jsonInit("PATCH", body), { silent: true }),

  /** 05-server §3.1 GET /api/projects/:slug/tasks */
  listTasks: (slug: string) => apiRequest<TasksData>(`/api/projects/${encodeURIComponent(slug)}/tasks`),

  /** 05-server §3.4 GET /api/tasks/:id（详情 + relatedRequirement 反向查询） */
  getTask: (id: string) => apiRequest<TaskDetailData>(`/api/tasks/${encodeURIComponent(id)}`),

  /** 05-server §3.3 PATCH /api/tasks/:id（同 §2.7 同构） */
  patchTask: (id: string, body: PatchStatusBody) =>
    apiRequest<PatchStatusData>(`/api/tasks/${encodeURIComponent(id)}`, jsonInit("PATCH", body), { silent: true }),
};
