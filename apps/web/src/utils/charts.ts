/**
 * 进度总览图表配置工厂（S8，06-web §7 / 05-server §2.3 / TC-06-013）：
 * - 纯函数：入参 = 数据 + 色板（utils/echartsTheme.ts，CSS 变量同源），出参 = EChartsCoreOption，不触 DOM；
 * - 空数据分支：不抛错、series/轴置空（页面层依据 totals 决定空态文案，TC-06-024）；
 * - 四图：任务完成率环形 / 需求交付漏斗 / 任务累计完成趋势（created+completed）/ 按模块任务分布条形。
 */
import type { EChartsCoreOption } from "echarts/core";
import type { ReqStatus, TaskStatus } from "../api/types";
import type { ChartColors } from "./echartsTheme";

// ---------------------------------------------------------------------------
// 1. 任务完成率环形图（06-web §7 环形 Pie：中心文字 = done/total 完成率，02-core §2.4 口径）
// ---------------------------------------------------------------------------

export interface TaskStatusCounts {
  total: number;
  byStatus: Partial<Record<TaskStatus, number>>;
}

/** 完成率口径与 02-core §2.4 同源：done / total（0 个任务为 0） */
export function taskCompletionRate(counts: Pick<TaskStatusCounts, "total" | "byStatus">): number {
  const done = counts.byStatus.done ?? 0;
  return counts.total === 0 ? 0 : done / counts.total;
}

export function taskCompletionRingOption(colors: ChartColors, counts: TaskStatusCounts): EChartsCoreOption {
  const by = counts.byStatus;
  const data = [
    { name: "已完成", value: by.done ?? 0, itemStyle: { color: colors.done } },
    { name: "进行中", value: by.doing ?? 0, itemStyle: { color: colors.doing } },
    { name: "待办", value: by.todo ?? 0, itemStyle: { color: colors.todo } },
    { name: "已取消", value: by.cancelled ?? 0, itemStyle: { color: colors.cancelled } },
  ];
  const rate = taskCompletionRate(counts);
  return {
    tooltip: { trigger: "item" },
    legend: { bottom: 0, icon: "circle", textStyle: { color: colors.textSecondary } },
    title: {
      text: `${Math.round(rate * 100)}%`,
      subtext: "完成率",
      left: "center",
      top: "32%",
      itemGap: 2,
      textStyle: { color: colors.textPrimary, fontSize: 24, fontWeight: 700 },
      subtextStyle: { color: colors.textSecondary, fontSize: 12 },
    },
    series: [
      {
        type: "pie",
        radius: ["58%", "82%"],
        center: ["50%", "44%"],
        avoidLabelOverlap: true,
        label: { show: false },
        emphasis: { scale: false },
        data,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 2. 需求交付漏斗（06-web §7：pool→reviewing→accepted→done 四阶段；rejected 不入漏斗）
// ---------------------------------------------------------------------------

export interface ReqStatusCounts {
  total: number;
  byStatus: Partial<Record<ReqStatus, number>>;
}

/** 漏斗阶段（固定顺序 = 交付链；rejected 计入通知区不入漏斗，06-web §7） */
export const FUNNEL_STAGES: ReadonlyArray<{ status: ReqStatus; label: string }> = [
  { status: "pool", label: "需求池" },
  { status: "reviewing", label: "评审中" },
  { status: "accepted", label: "已接受" },
  { status: "done", label: "已交付" },
];

export function requirementFunnelOption(colors: ChartColors, counts: ReqStatusCounts): EChartsCoreOption {
  const by = counts.byStatus;
  const data = FUNNEL_STAGES.map((stage) => ({
    name: stage.label,
    value: by[stage.status] ?? 0,
    itemStyle: { color: colors[stage.status === "done" ? "done" : stage.status] },
  }));
  return {
    tooltip: { trigger: "item", formatter: "{b}: {c}" },
    series: [
      {
        type: "funnel",
        left: "12%",
        width: "76%",
        top: 12,
        bottom: 12,
        sort: "none", // 固定阶段顺序 pool→reviewing→accepted→done（06-web §7）
        gap: 2,
        minSize: "4%",
        label: { show: true, position: "inside", formatter: "{b} {c}", color: "#ffffff", fontSize: 12 },
        labelLine: { show: false },
        data,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 3. 任务累计完成趋势折线（06-web §7"任务趋势折线"；近 14 天，基于 created 与 completed 日期）
// ---------------------------------------------------------------------------

export interface TrendTask {
  /** YYYY-MM-DD */
  created: string;
  /** YYYY-MM-DD | null（未完成） */
  completed: string | null;
}

export interface TrendSeries {
  dates: string[];
  createdCumulative: number[];
  completedCumulative: number[];
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 天轴：截至 today（含）往回 windowDays 天（YYYY-MM-DD 升序；UTC 步进避免时区漂移） */
export function trendDateAxis(today: string, windowDays: number): string[] {
  const [y, m, d] = today.split("-").map(Number);
  const end = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  const days: string[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const dt = new Date(end - i * 86_400_000);
    days.push(`${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`);
  }
  return days;
}

/** 累计曲线：dates 内每一天 = created ≤ 该天的任务数 / completed ≤ 该天的任务数（窗口前基线自然计入） */
export function taskTrendSeries(tasks: TrendTask[], today: string, windowDays = 14): TrendSeries {
  const dates = trendDateAxis(today, windowDays);
  const createdCumulative: number[] = [];
  const completedCumulative: number[] = [];
  for (const day of dates) {
    createdCumulative.push(tasks.reduce((acc, t) => (t.created !== "" && t.created <= day ? acc + 1 : acc), 0));
    completedCumulative.push(tasks.reduce((acc, t) => (t.completed != null && t.completed <= day ? acc + 1 : acc), 0));
  }
  return { dates, createdCumulative, completedCumulative };
}

export function taskTrendOption(colors: ChartColors, series: TrendSeries): EChartsCoreOption {
  return {
    tooltip: { trigger: "axis" },
    legend: { top: 0, icon: "roundRect", itemWidth: 12, itemHeight: 4, textStyle: { color: colors.textSecondary } },
    grid: { left: 40, right: 16, top: 32, bottom: 28 },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: series.dates,
      axisLabel: { color: colors.textSecondary, fontSize: 11 },
      axisLine: { lineStyle: { color: colors.border } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      axisLabel: { color: colors.textSecondary },
      splitLine: { lineStyle: { color: colors.border } },
    },
    series: [
      {
        name: "累计创建",
        type: "line",
        smooth: true,
        showSymbol: false,
        data: series.createdCumulative,
        itemStyle: { color: colors.accent },
      },
      {
        name: "累计完成",
        type: "line",
        smooth: true,
        showSymbol: false,
        data: series.completedCumulative,
        itemStyle: { color: colors.progressDone },
        areaStyle: { opacity: 0.1, color: colors.progressDone },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 4. 按模块任务分布条形图（S8 补充；module 经关联需求解析，空/悬空 → "未关联"）
// ---------------------------------------------------------------------------

export interface ModuleCount {
  module: string;
  count: number;
}

/** 按模块聚合任务数：count 降序、同数按模块字典序；空模块名归入"未关联" */
export function countTasksByModule<T>(tasks: T[], moduleOf: (t: T) => string): ModuleCount[] {
  const counts = new Map<string, number>();
  for (const t of tasks) {
    const m = moduleOf(t) || "未关联";
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([module, count]) => ({ module, count }))
    .sort((a, b) => b.count - a.count || a.module.localeCompare(b.module));
}

export function taskModuleBarOption(colors: ChartColors, counts: ModuleCount[]): EChartsCoreOption {
  return {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    grid: { left: 90, right: 32, top: 16, bottom: 28 },
    xAxis: {
      type: "value",
      minInterval: 1,
      axisLabel: { color: colors.textSecondary },
      splitLine: { lineStyle: { color: colors.border } },
    },
    yAxis: {
      type: "category",
      data: counts.map((c) => c.module),
      inverse: true,
      axisLabel: { color: colors.textPrimary },
      axisLine: { lineStyle: { color: colors.border } },
      axisTick: { show: false },
    },
    series: [
      {
        name: "任务数",
        type: "bar",
        barMaxWidth: 18,
        data: counts.map((c) => c.count),
        itemStyle: { color: colors.accent, borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: "right", color: colors.textSecondary },
      },
    ],
  };
}
