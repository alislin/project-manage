import { E_USAGE, type AppError } from "@pm/core";

/**
 * MCP 工具清单（04-mcp §2 全量对齐 + pm_inbox 相关工具，03-cli §7 同源）：
 * - inputSchema 为 JSON Schema（与 04-mcp §2 各节逐字对齐）；
 * - description 语义 = 对应 CLI 命令（04-mcp §3 CLI 映射表）；
 * - 入参校验器按 inputSchema 执行，违规 → E_USAGE（02-core §3.1，TC-04-006/012/013）。
 */

// ---------------------------------------------------------------------------
// JSON Schema 子集（04-mcp §2 用到的关键字）
// ---------------------------------------------------------------------------

export interface JsonSchemaProperty {
  type?: "string" | "integer" | "boolean" | "array";
  items?: { type: "string" };
  enum?: string[];
  minLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  default?: unknown;
  description?: string;
}

export interface ToolInputSchema {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties: false;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
}

/** 状态全量取值（04-mcp §2.2/§2.3 enum，01-数据规范 §3；各类型合法取值由 create/move 按实体校验） */
const STATUS_ENUM = [
  "active", "paused", "done", "archived",
  "pool", "reviewing", "accepted", "rejected",
  "todo", "doing", "cancelled",
] as const;

// ---------------------------------------------------------------------------
// 工具清单（04-mcp §2.1–§2.6 + 03-cli §7 inbox 三件套）
// ---------------------------------------------------------------------------

export const TOOLS: ToolDefinition[] = [
  {
    name: "pm_validate",
    // 04-mcp §2.1（对应 pm validate，03-cli §2）
    description:
      "校验一个或多个文件，报告 Zod/降级问题，错误精确到 file+field（对应 pm validate，输出 = 03-cli §2.2 结构）",
    inputSchema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          items: { type: "string" },
          description: "可选。目录或 md 文件绝对/相对路径；缺省 = 全部",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "pm_create",
    // 04-mcp §2.2（对应 pm new，03-cli §3；R-114：status 输入三类型默认值 active/pool/todo）
    description:
      "创建 project/requirement/task，自动分配编号、生成合规 frontmatter 模板（对应 pm new；status 默认 project=active、requirement=pool、task=todo）",
    inputSchema: {
      type: "object",
      properties: {
        type: { enum: ["project", "requirement", "task"], description: "创建类型（分发入口）" },
        projectSlug: { type: "string", description: "type != project 时为目标项目 slug（03-cli §3.2/§3.3）" },
        slug: { type: "string", description: "type == project 时的 slug" },
        name: { type: "string", description: "project 必填" },
        period: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 2,
          description: "project：[start, end] ISO date",
        },
        tags: { type: "array", items: { type: "string" }, description: "project：tags" },
        status: {
          enum: [...STATUS_ENUM],
          description:
            "project：默认 active；requirement：默认 pool；task：默认 todo（03-cli §3.1/§3.2/§3.3），取值语义见 01-数据规范 §3",
        },
        title: { type: "string", description: "requirement/task 必填" },
        module: { type: "string", description: "requirement" },
        source: { type: "string", description: "requirement 需非空" },
        priority: { enum: ["P0", "P1", "P2", "P3"], description: "优先级（默认 P2）" },
        requirement: { type: "string", description: "task 必填：[[REQ-...]] wiki-link（目标必须存在）" },
        due: { type: "string", description: "task 必填：ISO date" },
      },
      required: ["type"],
      additionalProperties: false,
    },
  },
  {
    name: "pm_move",
    // 04-mcp §2.3（对应 pm move，03-cli §4；非法流转 → E_INVALID_TRANSITION）
    description:
      "执行状态流转；非法流转返回 details.code=E_INVALID_TRANSITION；副作用（updated/completed）自动维护（对应 pm move）",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "REQ-/TASK- 前缀的 id；project 即 slug（projects/<slug>/project.md）",
        },
        status: { enum: [...STATUS_ENUM], description: "目标状态（01-数据规范 §3 流转表）" },
      },
      required: ["id", "status"],
      additionalProperties: false,
    },
  },
  {
    name: "pm_stats",
    // 04-mcp §2.4（对应 pm stats，输出 = 02-core §2.4 Stats，含 R-202 onTrack）
    description: "聚合统计（进度、逾期、各状态数量）；输出 = 02-core §2.4 Stats（projects[].progress.onTrack 与 totals.tasks.onTrack）",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "pm_check",
    // 04-mcp §2.5（对应 pm check，输入 schema 同 pm_validate）
    description:
      "一致性检查：悬空 wiki-link、孤儿任务（invalid-link-target）、编号冲突、日期倒挂、非法 frontmatter（对应 pm check，输出 = 03-cli §6.3）",
    inputSchema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          items: { type: "string" },
          description: "可选。目录或 md 文件绝对/相对路径；缺省 = 全部（同 pm_validate）",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "pm_search",
    // 04-mcp §2.6（输出 = 02-core §2.6 SearchResult）
    description: "从 index 内存索引检索（title/relPath 子串匹配；输出 = 02-core §2.6 SearchResult）",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", minLength: 1, description: "检索词（必填，非空）" },
        type: { enum: ["project", "requirement", "task", "inbox"], description: "可选。按类型过滤" },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 10, description: "返回条数上限（1-50，默认 10）" },
      },
      required: ["q"],
      additionalProperties: false,
    },
  },
  {
    name: "pm_inbox_list",
    // 03-cli §7.2（01-数据规范 §7.3 步骤 2：按 created 降序）
    description: "列出未归档 inbox 条目（按 created 降序；输出 = 03-cli §7.2 结构）",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "pm_inbox_process",
    // 03-cli §7.3（默认前 20 条；只读预览，语义上 --dry-run 等价）
    description: "预览待处理 inbox 条目摘要（默认前 20 条；all=true 不限条数；只读不写入）（对应 pm inbox process，03-cli §7.3）",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, default: 20, description: "条数上限（正整数，默认 20）" },
        all: { type: "boolean", default: false, description: "不限条数" },
        dryRun: { type: "boolean", default: false, description: "只预览不写入（process 本身只读，语义等价）" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "pm_inbox_archive",
    // 03-cli §7.4（归档到 inbox/archive/，archived=今天，正文保留）
    description: "归档 inbox 条目到 PM/inbox/archive/（archived=今天，正文保留）（对应 pm inbox archive，输出 = 03-cli §7.4）",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "INBOX 条目 id（如 INBOX-inbox-001；必填）" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// 入参校验（E_USAGE，02-core §3.1；违规信息精确到字段名）
// ---------------------------------------------------------------------------

function usageError(message: string, field?: string): AppError {
  return { code: E_USAGE, message, ...(field !== undefined ? { field } : {}) };
}

function describeType(spec: JsonSchemaProperty): string {
  if (spec.enum) return spec.enum.join("/");
  switch (spec.type) {
    case "string":
      return "string";
    case "integer":
      return "integer";
    case "boolean":
      return "boolean";
    case "array":
      return `array<string>`;
    default:
      return "any";
  }
}

/** 单属性校验（type/enum/minLength/minimum/maximum/minItems/maxItems/items.type）→ E_USAGE */
function checkValue(key: string, spec: JsonSchemaProperty, value: unknown): AppError | undefined {
  if (spec.enum !== undefined) {
    if (typeof value !== "string" || !spec.enum.includes(value)) {
      return usageError(`参数 "${key}" 取值非法（应为 ${spec.enum.join("/")}，04-mcp §2 inputSchema）`, key);
    }
    return undefined;
  }
  switch (spec.type) {
    case "string": {
      if (typeof value !== "string") {
        return usageError(`参数 "${key}" 需为 ${describeType(spec)}（04-mcp §2 inputSchema）`, key);
      }
      if (spec.minLength !== undefined && value.length < spec.minLength) {
        return usageError(`参数 "${key}" 长度需 ≥ ${spec.minLength}（04-mcp §2 inputSchema）`, key);
      }
      return undefined;
    }
    case "integer": {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return usageError(`参数 "${key}" 需为 integer（04-mcp §2 inputSchema）`, key);
      }
      if (spec.minimum !== undefined && value < spec.minimum) {
        return usageError(`参数 "${key}" 需 ≥ ${spec.minimum}（04-mcp §2 inputSchema）`, key);
      }
      if (spec.maximum !== undefined && value > spec.maximum) {
        return usageError(`参数 "${key}" 需 ≤ ${spec.maximum}（04-mcp §2 inputSchema）`, key);
      }
      return undefined;
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        return usageError(`参数 "${key}" 需为 boolean（04-mcp §2 inputSchema）`, key);
      }
      return undefined;
    }
    case "array": {
      if (!Array.isArray(value)) {
        return usageError(`参数 "${key}" 需为 array（04-mcp §2 inputSchema）`, key);
      }
      if (spec.minItems !== undefined && value.length < spec.minItems) {
        return usageError(`参数 "${key}" 需提供 ${spec.minItems} 个元素（04-mcp §2 inputSchema）`, key);
      }
      if (spec.maxItems !== undefined && value.length > spec.maxItems) {
        return usageError(`参数 "${key}" 最多 ${spec.maxItems} 个元素（04-mcp §2 inputSchema）`, key);
      }
      if (spec.items?.type === "string") {
        for (let i = 0; i < value.length; i++) {
          if (typeof value[i] !== "string") {
            return usageError(`参数 "${key}[${i}]" 需为 string（04-mcp §2 inputSchema）`, `${key}[${i}]`);
          }
        }
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

/**
 * 按 inputSchema 校验入参（04-mcp §2 additionalProperties:false / required / 各关键字）。
 * 返回 undefined 表示通过；否则为 E_USAGE 结构化错误（TC-04-006/012/013）。
 */
export function validateToolArgs(def: ToolDefinition, args: unknown): AppError | undefined {
  if (args === undefined || args === null) return undefined;
  if (typeof args !== "object" || Array.isArray(args)) {
    return usageError("参数需为 object（04-mcp §2 inputSchema）");
  }
  const obj = args as Record<string, unknown>;
  const schema = def.inputSchema;
  for (const key of Object.keys(obj)) {
    if (!(key in schema.properties)) {
      return usageError(`未知参数 "${key}"（04-mcp §2 ${def.name} inputSchema additionalProperties:false）`, key);
    }
  }
  for (const req of schema.required ?? []) {
    const v = obj[req];
    if (v === undefined || v === null) {
      return usageError(`缺少必填参数 "${req}"（04-mcp §2 ${def.name} inputSchema）`, req);
    }
  }
  for (const [key, spec] of Object.entries(schema.properties)) {
    const v = obj[key];
    if (v === undefined) continue;
    const e = checkValue(key, spec, v);
    if (e) return e;
  }
  return undefined;
}
