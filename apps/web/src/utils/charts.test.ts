// 图表配置工厂纯函数测试（S8，TC-06-013 进度总览四图 / TC-06-024 空 vault 空态 / TC-06-023 主题色板）：
// 含空数据分支——空输入不抛错、series/轴为空数组。
import { describe, expect, it } from "vitest";
import {
  FUNNEL_STAGES,
  countTasksByModule,
  requirementFunnelOption,
  taskCompletionRate,
  taskCompletionRingOption,
  taskModuleBarOption,
  taskTrendOption,
  taskTrendSeries,
  trendDateAxis,
} from "./charts";
import { buildChartColors, getChartColors, type ChartColors } from "./echartsTheme";

/** 固定变量源（纯映射测试，不触 DOM） */
const VARS: Record<string, string> = {
  "--pm-text-primary": "#111111",
  "--pm-text-secondary": "#222222",
  "--pm-text-tertiary": "#333333",
  "--pm-border": "rgba(0,0,0,0.1)",
  "--pm-status-todo": "#todo",
  "--pm-status-doing": "#doing",
  "--pm-status-done": "#done",
  "--pm-status-cancelled": "#cancelled",
  "--pm-status-pool": "#pool",
  "--pm-status-reviewing": "#reviewing",
  "--pm-status-accepted": "#accepted",
  "--pm-status-rejected": "#rejected",
  "--pm-status-overdue": "#overdue",
  "--pm-accent": "#accent",
  "--pm-progress-done": "#progress-done",
  "--pm-progress-rest": "#progress-rest",
};

const colors: ChartColors = buildChartColors((name) => VARS[name] ?? "");

// ---------------------------------------------------------------------------
// TC-06-023 色板：CSS 变量 → ECharts 配色同源（06-web §9.1）
// ---------------------------------------------------------------------------

describe("buildChartColors", () => {
  it("TC-06-023: 色板取自 --pm-* CSS 变量（亮暗主题同源映射）", () => {
    expect(colors.textPrimary).toBe("#111111");
    expect(colors.done).toBe("#done"); // --pm-status-done
    expect(colors.pool).toBe("#pool"); // --pm-status-pool
    expect(colors.accent).toBe("#accent"); // --pm-accent
    expect(colors.progressDone).toBe("#progress-done"); // --pm-progress-done
  });

  it("TC-06-023: 变量缺失时回退亮色缺省值（空分支）", () => {
    const fallback = buildChartColors(() => "  ");
    expect(fallback.textPrimary).toBe("#1f2329"); // 06-web §9.1 :root 清单
    expect(fallback.doing).toBe("#3b82f6");
    expect(fallback.overdue).toBe("#ef4444");
  });

  it("TC-06-023: 非 DOM 环境回退缺省色板（document 未定义分支）", () => {
    // node 测试环境无 document → 不抛错
    expect(getChartColors().textPrimary).toBe("#1f2329");
  });
});

// ---------------------------------------------------------------------------
// TC-06-013 图 1：任务完成率环形图
// ---------------------------------------------------------------------------

describe("taskCompletionRingOption", () => {
  it("TC-06-013: 环形图按任务状态分四扇区，中心文字为完成率", () => {
    const opt = taskCompletionRingOption(colors, {
      total: 4,
      byStatus: { todo: 1, doing: 1, done: 2, cancelled: 0 },
    });
    const series = (opt.series as Array<{ type: string; radius: string[]; data: Array<{ name: string; value: number; itemStyle: { color: string } }> }>)[0];
    expect(series.type).toBe("pie");
    expect(series.radius).toEqual(["58%", "82%"]); // 环形（06-web §7）
    expect(series.data.map((d) => d.name)).toEqual(["已完成", "进行中", "待办", "已取消"]);
    expect(series.data.find((d) => d.name === "已完成")?.value).toBe(2);
    expect(series.data.find((d) => d.name === "已完成")?.itemStyle.color).toBe(colors.done);
    expect((opt.title as { text: string }).text).toBe("50%");
  });

  it("TC-06-013: 完成率口径与 02-core §2.4 同源（done/total，0 任务为 0）", () => {
    expect(taskCompletionRate({ total: 3, byStatus: { done: 1 } })).toBe(1 / 3);
    expect(taskCompletionRate({ total: 0, byStatus: {} })).toBe(0);
  });

  it("TC-06-024: 空项目（total=0）不抛错，扇区值全 0、完成率 0%", () => {
    const opt = taskCompletionRingOption(colors, { total: 0, byStatus: {} });
    const series = (opt.series as Array<{ data: Array<{ value: number }> }>)[0];
    expect(series.data.every((d) => d.value === 0)).toBe(true);
    expect((opt.title as { text: string }).text).toBe("0%");
  });
});

// ---------------------------------------------------------------------------
// TC-06-013 图 2：需求交付漏斗（pool→reviewing→accepted→done，rejected 不入漏斗）
// ---------------------------------------------------------------------------

describe("requirementFunnelOption", () => {
  it("TC-06-013: 漏斗四阶段按交付链固定顺序，rejected 不入漏斗", () => {
    const opt = requirementFunnelOption(colors, {
      total: 11,
      byStatus: { pool: 3, reviewing: 2, accepted: 1, done: 1, rejected: 4 },
    });
    const series = (opt.series as Array<{ type: string; sort: string; data: Array<{ name: string; value: number }> }>)[0];
    expect(series.type).toBe("funnel");
    expect(series.sort).toBe("none"); // 固定顺序（06-web §7）
    expect(series.data.map((d) => d.name)).toEqual(FUNNEL_STAGES.map((s) => s.label));
    expect(series.data.map((d) => d.value)).toEqual([3, 2, 1, 1]); // rejected=4 被排除
    expect((series.data[0] as { itemStyle: { color: string } }).itemStyle.color).toBe(colors.pool);
  });

  it("TC-06-024: 空项目（byStatus 空）不抛错，四阶段值全 0 且顺序保持", () => {
    const opt = requirementFunnelOption(colors, { total: 0, byStatus: {} });
    const series = (opt.series as Array<{ data: Array<{ name: string; value: number }> }>)[0];
    expect(series.data.map((d) => d.name)).toEqual(["需求池", "评审中", "已接受", "已交付"]);
    expect(series.data.every((d) => d.value === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TC-06-013 图 3：任务累计完成趋势（基于 created 与 completed 日期，近 14 天）
// ---------------------------------------------------------------------------

describe("trendDateAxis / taskTrendSeries", () => {
  it("TC-06-013: 天轴为截至 today 往回 windowDays 天的升序 YYYY-MM-DD", () => {
    expect(trendDateAxis("2026-01-03", 3)).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
    // 跨月/跨年边界（UTC 步进无时区漂移）
    expect(trendDateAxis("2026-03-01", 2)).toEqual(["2026-02-28", "2026-03-01"]);
    expect(trendDateAxis("2026-01-01", 2)).toEqual(["2025-12-31", "2026-01-01"]);
    expect(trendDateAxis("2026-11-20", 14)).toHaveLength(14); // 缺省窗口（06-web §7 近 14 天）
  });

  it("TC-06-013: 累计曲线基于 created 与 completed 日期，窗口前基线计入", () => {
    const tasks = [
      { created: "2025-12-31", completed: null }, // 窗口前创建、未完成
      { created: "2026-01-01", completed: "2026-01-02" },
      { created: "2026-01-03", completed: "2026-01-03" },
    ];
    const s = taskTrendSeries(tasks, "2026-01-03", 3);
    expect(s.dates).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
    // 累计创建：day1=2（含 2025-12-31 基线），day3=3
    expect(s.createdCumulative).toEqual([2, 2, 3]);
    // 累计完成：day1=0，day2=1，day3=2
    expect(s.completedCumulative).toEqual([0, 1, 2]);
  });

  it("TC-06-013: 累计曲线单调不减", () => {
    const tasks = [
      { created: "2026-01-01", completed: "2026-01-05" },
      { created: "2026-01-02", completed: "2026-01-06" },
      { created: "2026-01-03", completed: "2026-01-07" },
    ];
    const s = taskTrendSeries(tasks, "2026-01-07", 7);
    const nonDecreasing = (arr: number[]): boolean => arr.every((v, i) => i === 0 || v >= arr[i - 1]);
    expect(nonDecreasing(s.createdCumulative)).toBe(true);
    expect(nonDecreasing(s.completedCumulative)).toBe(true);
    expect(s.completedCumulative.at(-1)).toBe(3);
  });

  it("TC-06-024: 空任务列表不抛错，两条曲线全 0 且与天轴等长", () => {
    const s = taskTrendSeries([], "2026-01-03", 3);
    expect(s.createdCumulative).toEqual([0, 0, 0]);
    expect(s.completedCumulative).toEqual([0, 0, 0]);
    expect(s.dates).toHaveLength(3);
  });
});

describe("taskTrendOption", () => {
  it("TC-06-013: 折线图双系列（累计创建/累计完成），色板取 CSS 变量", () => {
    const s = taskTrendSeries([{ created: "2026-01-01", completed: "2026-01-02" }], "2026-01-03", 3);
    const opt = taskTrendOption(colors, s);
    const series = opt.series as Array<{ name: string; type: string; data: number[]; itemStyle: { color: string } }>;
    expect(series.map((x) => x.name)).toEqual(["累计创建", "累计完成"]);
    expect(series.every((x) => x.type === "line")).toBe(true);
    expect(series[0].itemStyle.color).toBe(colors.accent); // --pm-accent
    expect(series[1].itemStyle.color).toBe(colors.progressDone); // --pm-progress-done
    expect((opt.xAxis as { data: string[] }).data).toEqual(s.dates);
  });

  it("TC-06-024: 空数据 option 不抛错，轴与系列数据为空/全 0", () => {
    const opt = taskTrendOption(colors, taskTrendSeries([], "2026-01-03", 3));
    const series = opt.series as Array<{ data: number[] }>;
    expect(series.every((x) => x.data.every((v) => v === 0))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TC-06-013 图 4：按模块任务分布条形图
// ---------------------------------------------------------------------------

describe("countTasksByModule / taskModuleBarOption", () => {
  it("TC-06-013: 按模块聚合且 count 降序，空模块归入未关联", () => {
    const counts = countTasksByModule(["模块A", "模块A", "模块B", ""], (m) => m);
    expect(counts).toEqual([
      { module: "模块A", count: 2 },
      { module: "模块B", count: 1 },
      { module: "未关联", count: 1 },
    ]);
  });

  it("TC-06-013: 条形图为横向 category 轴，颜色取 --pm-accent", () => {
    const opt = taskModuleBarOption(colors, [
      { module: "cli", count: 3 },
      { module: "core", count: 2 },
    ]);
    const series = (opt.series as Array<{ type: string; data: number[]; itemStyle: { color: string } }>)[0];
    expect(series.type).toBe("bar");
    expect(series.data).toEqual([3, 2]);
    expect(series.itemStyle.color).toBe(colors.accent);
    expect((opt.yAxis as { data: string[] }).data).toEqual(["cli", "core"]);
  });

  it("TC-06-024: 空任务列表不抛错，聚合为空数组、轴为空", () => {
    expect(countTasksByModule([], () => "x")).toEqual([]);
    const opt = taskModuleBarOption(colors, []);
    expect((opt.series as Array<{ data: number[] }>)[0].data).toEqual([]);
    expect((opt.yAxis as { data: string[] }).data).toEqual([]);
  });
});
