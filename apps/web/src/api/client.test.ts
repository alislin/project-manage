import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest, setApiErrorHandler } from "./client";

/** 构造统一信封 JSON 响应（05-server §1.1） */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("apiRequest：统一信封解包与错误处理", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterEach(() => {
    setApiErrorHandler(null);
  });

  it("ok:true → 返回 data 载荷", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, data: { projects: [] } }));
    const data = await apiRequest<{ projects: unknown[] }>("/api/projects");
    expect(data).toEqual({ projects: [] });
    expect(fetchMock).toHaveBeenCalledWith("/api/projects", undefined);
  });

  it("信封 ok:false → 抛 ApiError（code/status/body）并触发全局错误钩子", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          error: { code: "E_CONFLICT", message: "mtime 冲突", file: "/x.md", expectedMtimeMs: 1, currentMtimeMs: 2 },
        },
        409,
      ),
    );
    const seen: string[] = [];
    setApiErrorHandler((e) => seen.push(e.code));
    await expect(apiRequest("/api/requirements/REQ-x", { method: "PATCH" })).rejects.toMatchObject({
      name: "ApiError",
      code: "E_CONFLICT",
      status: 409,
      message: "mtime 冲突",
    });
    expect(seen).toEqual(["E_CONFLICT"]);
  });

  it("HTTP 404 + 错误信封 → ApiError E_NOT_FOUND（ApiError 实例）", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: false, error: { code: "E_NOT_FOUND", message: "不存在" } }, 404),
    );
    await expect(apiRequest("/api/tasks/nope")).rejects.toBeInstanceOf(ApiError);
  });

  it("fetch 网络异常 → ApiError E_NETWORK（status 0）", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(apiRequest("/api/projects")).rejects.toMatchObject({ code: "E_NETWORK", status: 0 });
  });

  it("响应非 JSON（如代理 500 页面）→ ApiError E_INVALID_RESPONSE", async () => {
    fetchMock.mockResolvedValue(new Response("<html>Internal Error</html>", { status: 500 }));
    await expect(apiRequest("/api/projects")).rejects.toMatchObject({ code: "E_INVALID_RESPONSE" });
  });
});
