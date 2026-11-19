import { z } from "zod";

/** ISO 日期 "YYYY-MM-DD"（01-数据规范 §5；日历合法性校验，如 2026-02-30 非法） */
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "需为 YYYY-MM-DD 形式的 ISO 日期")
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return (
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d
    );
  }, "不是合法日历日期（如 2026-02-30）");

/** 项目 slug：字母数字或中文，中间以单 "-" 连接，不允许连续/边缘 "-"（01-数据规范 §5） */
export const Slug = z
  .string()
  .regex(/^[A-Za-z0-9一-鿿]+(-[A-Za-z0-9一-鿿]+)*$/, "slug 非法（需为字母数字或中文，中间以单 \"-\" 连接）")
  .max(80);

export const ProjectStatus = z.enum(["active", "paused", "done", "archived"]);
export const ReqStatus = z.enum(["pool", "reviewing", "accepted", "rejected", "done"]);
export const TaskStatus = z.enum(["todo", "doing", "done", "cancelled"]);
export const Priority = z.enum(["P0", "P1", "P2", "P3"]);

export type ProjectStatus = z.infer<typeof ProjectStatus>;
export type ReqStatus = z.infer<typeof ReqStatus>;
export type TaskStatus = z.infer<typeof TaskStatus>;
export type Priority = z.infer<typeof Priority>;

export const ZProject = z.object({
  type: z.literal("project"),
  id: Slug,
  name: z.string().min(1).max(100).transform((s) => s.trim()).refine((s) => s.length > 0),
  status: ProjectStatus,
  period: z.tuple([IsoDate, IsoDate]).refine(([s, e]) => s <= e, "period[0] 必须 ≤ period[1]"),
  tags: z
    .array(z.string().min(1).transform((s) => s.trim()).refine((s) => s.length > 0))
    .refine((arr) => new Set(arr).size === arr.length, "tags 去重"),
});

export const ZRequirement = z.object({
  type: z.literal("requirement"),
  id: z.string().regex(/^REQ-[A-Za-z0-9一-鿿]+-\d{3}$/, "id 需形如 REQ-<slug>-NNN"),
  title: z.string().min(1).max(200),
  status: ReqStatus,
  priority: Priority,
  module: z.string().default(""),
  // source：非空（R-102；TC-01-009 要求 transform 后为空的空白串拒绝）
  source: z.string().min(1).transform((s) => s.trim()).refine((s) => s.length > 0, "source 非空"),
  created: IsoDate,
  updated: IsoDate,
}).superRefine((v, ctx) => {
  if (v.updated < v.created) ctx.addIssue({ code: "custom", path: ["updated"], message: "updated 不能早于 created" });
});

export const ZTask = z.object({
  type: z.literal("task"),
  id: z.string().regex(/^TASK-[A-Za-z0-9一-鿿]+-\d{3}$/, "id 需形如 TASK-<slug>-NNN"),
  title: z.string().min(1).max(200),
  status: TaskStatus,
  requirement: z
    .string()
    .regex(/^\[\[REQ-[A-Za-z0-9一-鿿]+-\d{3}\]\]$/, "requirement 需形如 [[REQ-<slug>-NNN]]"),
  priority: Priority,
  estimate: z.number().optional().refine((n) => n === undefined || n > 0, "estimate 为正数（人日）"),
  due: IsoDate,
  completed: z.union([IsoDate, z.null()]),
  created: IsoDate,
  updated: IsoDate,
}).superRefine((v, ctx) => {
  if (v.updated < v.created) ctx.addIssue({ code: "custom", path: ["updated"], message: "updated 不能早于 created" });
});

export const ZInboxEntry = z.object({
  type: z.literal("inbox"),
  id: z.string().regex(/^INBOX-[A-Za-z0-9一-鿿]+-\d{3}$/, "id 需形如 INBOX-<slug>-NNN"),
  slug: Slug.default("inbox"),
  created: IsoDate,
  tags: z.array(z.string().min(1).transform((s) => s.trim()).refine((s) => s.length > 0)).default([]),
  source: z.string().optional(),
  archived: z.union([IsoDate, z.null()]).default(null),
});

// 类型导出（供 02-core 等处使用，01-数据规范 §5）
export type Project = z.infer<typeof ZProject>;
export type Requirement = z.infer<typeof ZRequirement>;
export type Task = z.infer<typeof ZTask>;
export type InboxEntry = z.infer<typeof ZInboxEntry>;
