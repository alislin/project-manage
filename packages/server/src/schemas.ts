import { z } from "zod";
import {
  E_USAGE,
  E_VALIDATION,
  IsoDate,
  Priority,
  ProjectStatus,
  ReqStatus,
  Slug,
  TaskStatus,
  type AppError,
  type AppResult,
  err,
  ok,
} from "@pm/core";

/**
 * 请求体/查询参数校验（05-server §2/§3/§4 的 Zod 定义，对应 01-数据规范 §1/§5）。
 * 缺必填字段 → E_USAGE(400)；字段存在但值非法 → E_VALIDATION(422, field 精确到字段路径)。
 */

/** 05-server §2.2 ZNewProject */
export const ZNewProject = z
  .object({
    slug: Slug,
    name: z.string().min(1).max(100),
    period: z.tuple([IsoDate, IsoDate]),
    tags: z.array(z.string().min(1)).default([]),
    status: ProjectStatus.default("active"),
  })
  .refine((v) => v.period[0] <= v.period[1], { message: "period[0] 必须 ≤ period[1]", path: ["period"] });

/** 05-server §2.5 ZNewRequirement */
export const ZNewRequirement = z
  .object({
    title: z.string().min(1).max(200),
    module: z.string().default(""),
    source: z.string().min(1),
    priority: Priority.default("P2"),
    status: ReqStatus.default("pool"),
    created: IsoDate.optional(),
    updated: IsoDate.optional(),
  })
  .refine((v) => v.updated === undefined || v.created === undefined || v.updated >= v.created, {
    message: "updated 不能早于 created",
    path: ["updated"],
  });

/** 05-server §2.7 ZPatchRequirement */
export const ZPatchRequirement = z.object({
  status: ReqStatus,
  expectedMtimeMs: z.number().optional(),
});

/** 05-server §2.8 ZDeriveTask */
export const ZDeriveTask = z.object({
  title: z.string().min(1).max(200).optional(),
  due: IsoDate.optional(),
});

/** 05-server §3.2 ZNewTask */
export const ZNewTask = z.object({
  title: z.string().min(1).max(200),
  requirement: z.string().regex(/^\[\[REQ-[A-Za-z0-9一-鿿]+-\d{3}\]\]$/, "requirement 需形如 [[REQ-<slug>-NNN]]"),
  priority: Priority.default("P2"),
  due: IsoDate,
  status: TaskStatus.default("todo"),
  estimate: z.number().optional().refine((n) => n === undefined || n > 0, "estimate 为正数（人日）"),
});

/** 05-server §3.3 ZPatchTask */
export const ZPatchTask = z.object({
  status: TaskStatus,
  expectedMtimeMs: z.number().optional(),
});

const BODY_FILE_PLACEHOLDER = "(request-body)";

/**
 * 请求体解析（05-server §1.2 / §6.5）：
 * - 全部 issue 都是「缺字段」（invalid_type received undefined）→ E_USAGE(400)；
 * - 其余（值非法/格式不符/refine 失败）→ E_VALIDATION(422)，field 取首个 issue 的字段路径。
 */
export function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown): AppResult<z.output<S>> {
  const parsed = schema.safeParse(body ?? {});
  if (parsed.success) return ok(parsed.data);
  const issues = parsed.error.issues.map((i) => ({
    file: BODY_FILE_PLACEHOLDER,
    field: i.path.join("."),
    code: i.code,
    message: i.message,
  }));
  const allMissing = parsed.error.issues.every((i) => i.code === "invalid_type" && (i as { received?: string }).received === "undefined");
  if (allMissing) {
    return err({
      code: E_USAGE,
      message: `缺少必填字段: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ") || "(body)"}`,
      issues,
    });
  }
  return err({
    code: E_VALIDATION,
    message: "请求体校验失败（01-数据规范）",
    field: issues[0]?.field,
    issues,
  } satisfies Partial<AppError> as AppError);
}

/** 检索参数（05-server §4.1）：q 必填非空；type 可选枚举；limit 可选 1–50 默认 10 */
export interface SearchQuery {
  q: string;
  type?: "project" | "requirement" | "task" | "inbox";
  limit: number;
}

const SEARCH_TYPES = ["project", "requirement", "task", "inbox"] as const;

export function parseSearchQuery(query: Record<string, unknown>): AppResult<SearchQuery> {
  const qRaw = query.q;
  if (typeof qRaw !== "string" || qRaw.trim().length === 0) {
    return err({ code: E_USAGE, message: "q 必填且非空（05-server §4.1）", field: "q" });
  }
  const typeRaw = query.type;
  if (typeRaw !== undefined && !(SEARCH_TYPES as readonly string[]).includes(String(typeRaw))) {
    return err({ code: E_VALIDATION, message: `type 非法，应为 ${SEARCH_TYPES.join("/")}`, field: "type" });
  }
  let limit = 10;
  if (query.limit !== undefined) {
    const n = Number(query.limit);
    if (!Number.isInteger(n) || n < 1 || n > 50) {
      return err({ code: E_VALIDATION, message: "limit 需为 1–50 的整数（05-server §4.1）", field: "limit" });
    }
    limit = n;
  }
  return ok({ q: qRaw, type: typeRaw === undefined ? undefined : (String(typeRaw) as SearchQuery["type"]), limit });
}
