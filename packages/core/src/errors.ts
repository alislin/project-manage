import type { AppError } from "./types";

/** 02-core §3.1 错误码（decisions.md 统一错误码体系表） */
export type ErrorCode =
  | "E_CONFIG_INVALID"
  | "E_USAGE"
  | "E_NOT_FOUND"
  | "E_VALIDATION"
  | "E_INVALID_TRANSITION"
  | "E_CONFLICT"
  | "E_SEQ_EXHAUSTED"
  | "E_DANGLING_WIKI"
  | "E_IO"
  | "E_UNKNOWN_TYPE";

/** 错误码全量（02-core §3.1） */
export const ERROR_CODES: readonly ErrorCode[] = [
  "E_CONFIG_INVALID",
  "E_USAGE",
  "E_NOT_FOUND",
  "E_VALIDATION",
  "E_INVALID_TRANSITION",
  "E_CONFLICT",
  "E_SEQ_EXHAUSTED",
  "E_DANGLING_WIKI",
  "E_IO",
  "E_UNKNOWN_TYPE",
];

/** 错误码常量（02-core §3.1；02-core §3.1 错误码全量 + PmError 类） */
export const E_CONFIG_INVALID: ErrorCode = "E_CONFIG_INVALID";
export const E_USAGE: ErrorCode = "E_USAGE";
export const E_NOT_FOUND: ErrorCode = "E_NOT_FOUND";
export const E_VALIDATION: ErrorCode = "E_VALIDATION";
export const E_INVALID_TRANSITION: ErrorCode = "E_INVALID_TRANSITION";
export const E_CONFLICT: ErrorCode = "E_CONFLICT";
export const E_SEQ_EXHAUSTED: ErrorCode = "E_SEQ_EXHAUSTED";
export const E_DANGLING_WIKI: ErrorCode = "E_DANGLING_WIKI";
export const E_IO: ErrorCode = "E_IO";
export const E_UNKNOWN_TYPE: ErrorCode = "E_UNKNOWN_TYPE";

export interface PmErrorInit {
  code: ErrorCode;
  message: string;
  /** 可选：HTTP 状态码映射建议（02-core §3.4） */
  httpStatus?: number;
  /** 可选：文件与字段精确位置（§3.4） */
  file?: string;
  field?: string;
  /** 可选：详细 issues（E_VALIDATION / E_INVALID_TRANSITION） */
  issues?: Array<{ file: string; field: string; code: string; message: string }>;
}

/** 统一错误形状（02-core §3.3，实现为 Error 子类） */
export class PmError extends Error implements AppError {
  readonly code: ErrorCode;
  readonly httpStatus?: number;
  readonly file?: string;
  readonly field?: string;
  readonly issues?: Array<{ file: string; field: string; code: string; message: string }>;

  constructor(init: PmErrorInit) {
    super(init.message);
    this.name = "PmError";
    this.code = init.code;
    this.httpStatus = init.httpStatus;
    this.file = init.file;
    this.field = init.field;
    this.issues = init.issues;
  }
}

export function isPmError(e: unknown): e is PmError {
  return e instanceof PmError;
}
