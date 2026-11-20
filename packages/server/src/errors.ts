import type { FastifyReply } from "fastify";
import type { AppError } from "@pm/core";

/**
 * 统一响应信封与错误映射（05-server §1.1 / §1.2 / §6.4 / §6.5）。
 * 成功：{ ok: true, data }；失败：{ ok: false, error: { code, message, file?, field?, issues? } }。
 */

/** 错误码 ↔ HTTP 状态（05-server §6.5 统一表；02-core §3.1 / 03-cli §1.3 同源） */
const HTTP_STATUS_BY_CODE: Record<string, number> = {
  E_CONFIG_INVALID: 500,
  E_USAGE: 400,
  E_NOT_FOUND: 404,
  E_VALIDATION: 422,
  E_INVALID_TRANSITION: 409,
  E_CONFLICT: 409,
  E_SEQ_EXHAUSTED: 409,
  E_IO: 500,
};

export function httpStatusFor(code: string): number {
  return HTTP_STATUS_BY_CODE[code] ?? 500;
}

/** writer 的写冲突错误在运行时携带 expectedMtimeMs/currentMtimeMs（02-core §2.7 WriteConflict） */
type ConflictFields = { expectedMtimeMs?: number; currentMtimeMs?: number };

/**
 * 是否为结构化 AppError（02-core §3.3 形状：{ code, message }）。
 * S5R1 BUG-2：增加 E_ 前缀约束——Fastify 原生错误（如 FST_ERR_CTP_INVALID_JSON_BODY）同样带
 * {code,message} 形状，形状过宽会被此处误判并按未知码回退 500，导致 §1.2/§6.5 的
 * 「statusCode 400/404/415 → E_USAGE」分支不可达；约束后原生错误落入 errorHandler 的
 * statusCode 分支，非法 JSON body 返回 400 E_USAGE 统一信封。
 */
export function isAppErrorLike(e: unknown): e is AppError {
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as { code?: unknown }).code === "string" &&
    (e as { code: string }).code.startsWith("E_") &&
    typeof (e as { message?: unknown }).message === "string"
  );
}

/** 成功信封（05-server §1.1） */
export function sendOk<T>(reply: FastifyReply, data: T, statusCode = 200): void {
  void reply.code(statusCode).send({ ok: true, data });
}

/** 错误信封（05-server §1.1 / §6.4：E_CONFLICT 附 expectedMtimeMs/currentMtimeMs） */
export function sendErr(reply: FastifyReply, error: AppError): void {
  const conflict = error as AppError & ConflictFields;
  const body: { ok: false; error: Record<string, unknown> } = {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      ...(error.file !== undefined ? { file: error.file } : {}),
      ...(error.field !== undefined ? { field: error.field } : {}),
      ...(error.issues !== undefined ? { issues: error.issues } : {}),
      ...(error.code === "E_CONFLICT" && conflict.expectedMtimeMs !== undefined
        ? { expectedMtimeMs: conflict.expectedMtimeMs }
        : {}),
      ...(error.code === "E_CONFLICT" && conflict.currentMtimeMs !== undefined
        ? { currentMtimeMs: conflict.currentMtimeMs }
        : {}),
    },
  };
  void reply.code(httpStatusFor(error.code)).send(body);
}
