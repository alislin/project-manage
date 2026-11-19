import { isPast, type Progress, type Stats, type TaskStats, type VaultIndex } from "../types";
import type { ReqStatus, Task, TaskStatus } from "../schema";
import { parseWikiLinks } from "../indexer";

/** aggregate：todo/doing 且 due ≥ today 计入 onTrack（design §2.4 / 02-core §8 isPast/overdue） */
function aggregate(tasks: Task[]): TaskStats {
  const byStatus: Record<TaskStatus, number> = { todo: 0, doing: 0, done: 0, cancelled: 0 };
  let overdue = 0;
  let onTrack = 0;
  for (const t of tasks) {
    byStatus[t.status]++;
    if (t.status === "todo" || t.status === "doing") {
      if (isPast(t.due)) overdue++;
      else onTrack++; // due ≥ today（02-core §8 isPast/overdue：overdue = due < today）
    }
  }
  return { total: tasks.length, byStatus, overdue, onTrack };
}

/**
 * 聚合统计（design §2.4，plan §4.3 第 2 条：一切从 VaultIndex 计算，进度为派生值）。
 * - totals.tasks.overdue：todo/doing && due < today（02-core §8）
 * - totals.tasks.onTrack：todo/doing && due ≥ today（02-core §8；done 不计入，TC-02-011/026）
 */
export function deriveStats(index: VaultIndex): Stats {
  const tasks = index.tasks;
  const totals = aggregate(tasks);

  const progressTo = (t: TaskStats): Progress => ({
    completedRate: t.total === 0 ? 0 : t.byStatus.done / t.total, // design §2.4：0 个任务为 0
    overdueCount: t.overdue,
    totalTasks: t.total,
    doneTasks: t.byStatus.done,
    cancelledTasks: t.byStatus.cancelled,
    onTrack: t.onTrack,
  });

  const projects = index.projects.map((p) => {
    // 项目自身 progress：属于该项目（需求归属项目）的任务聚合（design §2.4）
    const reqIds = new Set((index.requirementsByProject.get(p.id) ?? []).map((r) => r.id));
    const projectTasks = index.tasks.filter((t) => {
      const target = parseWikiLinks(t.requirement)[0];
      return target !== undefined && reqIds.has(target);
    });
    return { slug: p.id, name: p.name, status: p.status, progress: progressTo(aggregate(projectTasks)) };
  });

  const byStatusReq: Record<ReqStatus, number> = { pool: 0, reviewing: 0, accepted: 0, rejected: 0, done: 0 };
  for (const r of index.requirements) byStatusReq[r.status]++;

  return {
    projects,
    totals: {
      requirements: { total: index.requirements.length, byStatus: byStatusReq },
      tasks: { total: totals.total, byStatus: totals.byStatus, overdue: totals.overdue, onTrack: totals.onTrack },
    },
  };
}
