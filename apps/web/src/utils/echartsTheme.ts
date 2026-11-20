/**
 * ECharts 主题色板（06-web §9.1/§9.2 "ECharts 变量注入"）：
 * - 图表配色全部取自 CSS 变量（--pm-status-* / --pm-progress-* / 文本/边框色），亮暗主题同源（TC-06-023）；
 * - `getChartColors()` 运行时从 `document` 读取当前主题下的变量值；
 * - `buildChartColors(getVar)` 为纯映射（不触 DOM），vitest 直接断言；
 * - 页面层 watch 主题（ui.isDark）重算 option → PmChart setOption(notMerge) 即时换色。
 */

/** 图表色板键（亮暗主题共用同一套键，值随 data-theme 切换） */
export interface ChartColors {
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  /** 任务状态（06-web §10：灰/蓝/绿/深灰） */
  todo: string;
  doing: string;
  done: string;
  cancelled: string;
  /** 需求状态（06-web §10：琥珀/橙/蓝/琥珀/绿） */
  pool: string;
  reviewing: string;
  accepted: string;
  rejected: string;
  /** 逾期红 / 强调蓝 / 进度条（06-web §9.1） */
  overdue: string;
  accent: string;
  progressDone: string;
  progressRest: string;
}

/** 色板键 → CSS 变量名（06-web §9.1 变量清单） */
const VAR_MAP: Readonly<Record<keyof ChartColors, string>> = {
  textPrimary: "--pm-text-primary",
  textSecondary: "--pm-text-secondary",
  textTertiary: "--pm-text-tertiary",
  border: "--pm-border",
  todo: "--pm-status-todo",
  doing: "--pm-status-doing",
  done: "--pm-status-done",
  cancelled: "--pm-status-cancelled",
  pool: "--pm-status-pool",
  reviewing: "--pm-status-reviewing",
  accepted: "--pm-status-accepted",
  rejected: "--pm-status-rejected",
  overdue: "--pm-status-overdue",
  accent: "--pm-accent",
  progressDone: "--pm-progress-done",
  progressRest: "--pm-progress-rest",
};

/** 缺省回退（亮色值；仅 CSS 未加载/非 DOM 环境时兜底，06-web §9.1 :root 清单） */
const FALLBACKS: Readonly<ChartColors> = {
  textPrimary: "#1f2329",
  textSecondary: "#646a73",
  textTertiary: "#8691a2",
  border: "rgba(0, 0, 0, 0.08)",
  todo: "#94a3b8",
  doing: "#3b82f6",
  done: "#16a34a",
  cancelled: "#64748b",
  pool: "#f59e0b",
  reviewing: "#f97316",
  accepted: "#3b82f6",
  rejected: "#a16207",
  overdue: "#ef4444",
  accent: "#3b82f6",
  progressDone: "#16a34a",
  progressRest: "#e5e7eb",
};

/** 纯映射：getVar(CSS 变量名) → 色板；变量缺失/空白时回退亮色值（vitest 空分支可断言） */
export function buildChartColors(getVar: (name: string) => string): ChartColors {
  const pick = (key: keyof ChartColors): string => {
    const v = getVar(VAR_MAP[key]).trim();
    return v !== "" ? v : FALLBACKS[key];
  };
  const out = {} as Record<keyof ChartColors, string>;
  for (const key of Object.keys(VAR_MAP) as Array<keyof ChartColors>) {
    out[key] = pick(key);
  }
  return out;
}

/** 运行时读取当前主题（data-theme）下的 CSS 变量值；非 DOM 环境回退缺省色板 */
export function getChartColors(): ChartColors {
  if (typeof document === "undefined") return buildChartColors(() => "");
  const style = getComputedStyle(document.documentElement);
  return buildChartColors((name) => style.getPropertyValue(name) ?? "");
}
