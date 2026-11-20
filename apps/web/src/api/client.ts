/**
 * API client（06-web §1 约定 / 05-server §1.1）：
 * - fetch 封装，统一解包 `{ ok, data, error }` 信封；
 * - 失败（网络/HTTP/信封 error）抛 `ApiError`，并触发全局错误回调（供 ErrorToast 提示）；
 * - 调用方只需 `await api.listProjects()` 即可获得 `data` 载荷。
 */
import type { ApiErrorBody, Envelope, ProjectsData } from "./types";

/** 客户端补充的错误码（非服务端 02-core §3.1 错误码） */
export const E_NETWORK = "E_NETWORK";
export const E_INVALID_RESPONSE = "E_INVALID_RESPONSE";

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
export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
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
    fail(new ApiError(E_INVALID_RESPONSE, `响应不是合法 JSON（HTTP ${res.status}）`, res.status));
  }

  if (!envelope || typeof envelope.ok !== "boolean") {
    fail(new ApiError(E_INVALID_RESPONSE, `响应缺少统一信封（HTTP ${res.status}）`, res.status));
  }
  if (!envelope.ok) {
    const body = envelope.error ?? { code: E_INVALID_RESPONSE, message: "未知服务端错误" };
    fail(new ApiError(body.code, body.message, res.status, body));
  }
  return (envelope.data ?? {}) as T;
}

/** 常用端点封装（05-server §2-§4；本阶段仅消费项目列表） */
export const api = {
  /** 05-server §2.1 GET /api/projects */
  listProjects: () => apiRequest<ProjectsData>("/api/projects"),
};
