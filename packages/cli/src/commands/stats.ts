import { buildIndex, deriveStats, isPast, loadConfig } from "@pm/core";
import { failWith } from "./helpers.js";

export interface StatsArgs {
  json?: boolean;
  root?: string;
}

/**
 * `pm stats`（03-cli §5）：聚合统计，`--json` 输出 ≡ 02-core §2.4 Stats
 * （projects[].progress 含 onTrack；totals.tasks.onTrack，03-cli §5.2）。
 * 退出码：0 成功；1 E_IO；2 E_CONFIG_INVALID（03-cli §5.4）。
 */
export async function runStats(args: StatsArgs): Promise<number> {
  const json = !!args.json;
  const cfg = loadConfig(args.root);
  if (!cfg.ok) return failWith(cfg.error, json);
  const index = buildIndex(cfg.value);
  const stats = deriveStats(index);

  if (json) {
    console.log(JSON.stringify(stats));
    return 0;
  }
  for (const p of stats.projects) {
    console.log(`📊 ${p.slug} (${p.status})`);
    const rate = p.progress.totalTasks === 0 ? 0 : (p.progress.doneTasks / p.progress.totalTasks) * 100;
    console.log(`   任务进度: ${p.progress.doneTasks}/${p.progress.totalTasks} 完成 (${rate.toFixed(1)}%)`);
    const overdueIds = index.tasks
      .filter((t) => isPast(t.due) && (t.status === "todo" || t.status === "doing"))
      .map((t) => t.id);
    console.log(`   过期: ${overdueIds.length} 任务${overdueIds.length > 0 ? ` (${overdueIds.join(", ")})` : ""}`);
  }
  return 0;
}
