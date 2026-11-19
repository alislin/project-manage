import { buildIndex, loadConfig, moveStatus } from "@pm/core";
import { exitCodeFor, failWith, usageError } from "./helpers.js";

export interface MoveArgs {
  id?: string;
  status?: string;
  json?: boolean;
  root?: string;
}

/**
 * `pm move`（03-cli §4）：状态流转，调用 core moveStatus（02-core §4.7）。
 * 退出码：0 成功；1 E_NOT_FOUND；2 E_USAGE（缺 id/status）；3 E_CONFLICT；4 E_INVALID_TRANSITION（03-cli §1.3）。
 */
export async function runMove(args: MoveArgs): Promise<number> {
  const json = !!args.json;
  const id = (args.id ?? "").trim();
  const status = (args.status ?? "").trim();
  if (!id) return usageError("--id 必填（03-cli §4.1）", json);
  if (!status) return usageError("--status 必填（03-cli §4.1, TC-03-022）", json);

  const cfg = loadConfig(args.root);
  if (!cfg.ok) return failWith(cfg.error, json);
  const index = buildIndex(cfg.value);
  const res = moveStatus(index, id, status);
  if (!res.ok) {
    if (json) return failWith(res.error, json);
    console.error(`[${res.error.code}] ${res.error.message}`);
    return exitCodeFor(res.error.code);
  }
  const out = res.value;
  if (!out.ok) return failWith(out.error, json);

  const updatedField = out.completedSet ? "updated+completed" : "updated";
  const mid = out.newStatuses[0]?.id ?? id;
  if (json) {
    console.log(
      JSON.stringify({ ok: true, file: out.file.absPath, from: out.from, to: out.to, updatedField, id: mid }),
    );
  } else {
    const desc = updatedField === "updated+completed" ? "updated, completed 维护" : "updated 维护";
    console.log(`✅ ${mid}: ${out.from} → ${out.to} (${desc})`);
  }
  return 0;
}
