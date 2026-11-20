import type { AppError } from "@pm/core";

/**
 * MCP 工具输出信封（04-mcp §1.1）：
 * - 成功 → isError=false，结构化 JSON 文本内容（含 ok 信封，03-cli 同名命令 --json 结构）；
 * - 失败 → isError=true，content[0] = "[<code>] <message>"（模型可读），
 *   content[1] = 结构化 JSON 信封（ok=false + 错误码），details 供脚本/CI 机器解析。
 * `code` 与 02-core §3.1 错误模型同源（CLI 退出码 / HTTP 状态 / MCP 三端一致）。
 */

/** 工具输出文本内容块（CallToolResult.content 全部为 text，便于代理消费） */
export interface TextContent {
  type: "text";
  text: string;
}

/** 错误详情（04-mcp §1.1 details：code 与 02-core §3.1 同源，file/field 精确定位） */
export interface ToolErrorDetails {
  code: string;
  message: string;
  file?: string;
  field?: string;
  /** 降级/流转详情（E_VALIDATION / E_INVALID_TRANSITION 等） */
  issues?: Array<{ file: string; field: string; code: string; message: string }>;
}

/** CallToolResult 形状（SDK CallToolResultSchema 兼容；details 为 04-mcp §1.1 附加字段） */
export interface ToolCallResult {
  content: TextContent[];
  isError: boolean;
  structuredContent?: Record<string, unknown>;
  details?: ToolErrorDetails;
}

/** issues 条目统一 field 为 string（04-mcp §1.1 类型） */
function normalizeIssues(error: AppError): ToolErrorDetails["issues"] {
  return error.issues?.map((i) => ({ file: i.file, field: i.field ?? "", code: i.code, message: i.message }));
}

/** 组装 JSON 信封：语义含 ok 的输出（pm_validate/pm_check/pm_move，03-cli 同源）原样透出；其余补 ok:true */
function envelopeOf(payload: Record<string, unknown>): Record<string, unknown> {
  return typeof payload.ok === "boolean" ? payload : { ok: true, ...payload };
}

/** 成功结果：isError=false，text = 结构化 JSON（含 ok 信封） */
export function okResult(payload: Record<string, unknown>): ToolCallResult {
  const envelope = envelopeOf(payload);
  return {
    content: [{ type: "text", text: JSON.stringify(envelope) }],
    isError: false,
    structuredContent: envelope,
  };
}

/**
 * 失败结果（04-mcp §1.1）：
 * - content[0] = "[<code>] <message>"（TC-04-002）；
 * - content[1] = JSON 信封 { ok:false, code, message, file?, field?, issues?, ...extra }；
 * - details = { code, message, file?, field?, issues? }（机器解析）。
 * `extra` 携带工具语义输出（如 pm_validate 的 checkedFiles/errors），仅进 JSON 信封不进 details。
 */
export function errResult(error: AppError, extra: Record<string, unknown> = {}): ToolCallResult {
  const issues = normalizeIssues(error);
  const details: ToolErrorDetails = {
    code: error.code,
    message: error.message,
    ...(error.file !== undefined ? { file: error.file } : {}),
    ...(error.field !== undefined ? { field: error.field } : {}),
    ...(issues !== undefined ? { issues } : {}),
  };
  const envelope: Record<string, unknown> = { ok: false, code: error.code, message: error.message, ...extra };
  if (error.file !== undefined) envelope.file = error.file;
  if (error.field !== undefined) envelope.field = error.field;
  if (issues !== undefined) envelope.issues = issues;
  return {
    content: [
      { type: "text", text: `[${error.code}] ${error.message}` },
      { type: "text", text: JSON.stringify(envelope) },
    ],
    isError: true,
    structuredContent: envelope,
    details,
  };
}
