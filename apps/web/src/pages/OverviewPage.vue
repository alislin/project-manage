<script setup lang="ts">
// 进度总览 Tab（06-web §7 / 05-server §2.3，S8 / TC-06-013）：
// - 四图：任务完成率环形、需求交付漏斗（pool→reviewing→accepted→done）、
//   任务累计完成趋势（created+completed 日期，近 14 天）、按模块任务分布条形；
// - 数据源：overview store（GET /api/projects/:slug/overview）+ tasks/requirements stores
//   （模块解析复用 tasksStore.moduleOf，S7 同源）；
// - SSE vault:updated 由 App.vue 全局驱动四 store 静默刷新，computed 即时重算图表（TC-06-026）；
// - 主题：色板运行时读 CSS 变量（utils/echartsTheme.ts），watch isDark 重算 → 图表即时换色（TC-06-023）；
// - 空项目：四图空态文案（TC-06-024）。
import { computed, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import PmChart from "../components/charts/PmChart.vue";
import { todayIso } from "../utils/board";
import {
  countTasksByModule,
  requirementFunnelOption,
  taskCompletionRingOption,
  taskModuleBarOption,
  taskTrendOption,
  taskTrendSeries,
} from "../utils/charts";
import { getChartColors } from "../utils/echartsTheme";
import { useOverviewStore } from "../stores/overview";
import { useRequirementsStore } from "../stores/requirements";
import { useTasksStore } from "../stores/tasks";
import { useUiStore } from "../stores/ui";

const route = useRoute();
const slug = computed(() => route.params.slug as string);
const overview = useOverviewStore();
const tasks = useTasksStore();
const requirements = useRequirementsStore();
const ui = useUiStore();

function loadAll(s: string): void {
  if (overview.activeSlug !== s) void overview.load(s);
  if (tasks.activeSlug !== s) void tasks.load(s);
  if (requirements.activeSlug !== s) void requirements.load(s);
}

// 直接进入子路由/刷新时兜底拉取（SSE 也会驱动静默 refresh，App.vue）
onMounted(() => loadAll(slug.value));
watch(slug, (s) => {
  if (s) loadAll(s);
});

// 主题 → 色板：读取 ui.isDark 作为响应式依赖，切换后重取 CSS 变量值（TC-06-023）
const colors = computed(() => {
  void ui.isDark.value;
  return getChartColors();
});

const data = computed(() => overview.data);

// --- 汇总卡片（06-web §2.2 OverviewPage"汇总卡片"） ---
function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}
const progress = computed(() => data.value?.progress ?? null);
const totals = computed(() => data.value?.totals ?? null);
const deliveryRate = computed(() => data.value?.periods.rate ?? 0);

// --- 图 1：任务完成率环形 ---
const ringOption = computed(() =>
  taskCompletionRingOption(colors.value, totals.value?.tasks ?? { total: 0, byStatus: {} }),
);
const ringEmpty = computed(() => (totals.value?.tasks.total ?? 0) === 0);

// --- 图 2：需求交付漏斗 ---
const funnelOption = computed(() =>
  requirementFunnelOption(colors.value, totals.value?.requirements ?? { total: 0, byStatus: {} }),
);
const funnelEmpty = computed(() => (totals.value?.requirements.total ?? 0) === 0);

// --- 图 3：任务累计完成趋势（created + completed，近 14 天） ---
const trendSeries = computed(() =>
  taskTrendSeries(
    tasks.items.map((t) => ({ created: t.created, completed: t.completed })),
    todayIso(),
  ),
);
const trendOption = computed(() => taskTrendOption(colors.value, trendSeries.value));
const trendEmpty = computed(() => tasks.items.length === 0);

// --- 图 4：按模块任务分布（module 经关联需求解析，S7 同源） ---
const moduleCounts = computed(() => countTasksByModule(tasks.items, (t) => tasks.moduleOf(t)));
const moduleOption = computed(() => taskModuleBarOption(colors.value, moduleCounts.value));
const moduleEmpty = computed(() => tasks.items.length === 0);
</script>

<template>
  <section class="pm-overview">
    <p v-if="overview.loading && !overview.loaded" class="pm-overview__hint">加载中…</p>
    <p v-else-if="overview.error && !data" class="pm-overview__hint pm-overview__hint--error">{{ overview.error }}</p>

    <template v-else-if="data">
      <!-- 汇总卡片（06-web §2.2） -->
      <div class="pm-overview__stats">
        <div class="pm-overview__stat">
          <span class="pm-overview__stat-label">任务完成率</span>
          <span class="pm-overview__stat-value">{{ pct(progress?.completedRate ?? 0) }}</span>
        </div>
        <div class="pm-overview__stat">
          <span class="pm-overview__stat-label">任务总数</span>
          <span class="pm-overview__stat-value">{{ totals?.tasks.total ?? 0 }}</span>
        </div>
        <div class="pm-overview__stat">
          <span class="pm-overview__stat-label">逾期任务</span>
          <span
            class="pm-overview__stat-value"
            :class="{ 'pm-overview__stat-value--danger': (totals?.tasks.overdue ?? 0) > 0 }"
          >
            {{ totals?.tasks.overdue ?? 0 }}
          </span>
        </div>
        <div class="pm-overview__stat">
          <span class="pm-overview__stat-label">需求交付率</span>
          <span class="pm-overview__stat-value">{{ pct(deliveryRate) }}</span>
        </div>
      </div>

      <!-- 四图（06-web §7；空项目时各图空态文案，TC-06-024） -->
      <div class="pm-overview__grid">
        <div class="pm-overview__cell" data-testid="overview-cell-ring">
          <h3 class="pm-overview__cell-title">任务完成率</h3>
          <PmChart
            :option="ringOption"
            :empty="ringEmpty"
            empty-text="暂无任务，完成率图表将在此展示"
            height="300px"
          />
        </div>
        <div class="pm-overview__cell" data-testid="overview-cell-funnel">
          <h3 class="pm-overview__cell-title">需求交付漏斗</h3>
          <PmChart
            :option="funnelOption"
            :empty="funnelEmpty"
            empty-text="暂无需求，交付漏斗将在此展示"
            height="300px"
          />
        </div>
        <div class="pm-overview__cell" data-testid="overview-cell-trend">
          <h3 class="pm-overview__cell-title">任务累计完成趋势（近 14 天）</h3>
          <PmChart
            :option="trendOption"
            :empty="trendEmpty"
            empty-text="暂无任务，趋势图表将在此展示"
            height="300px"
          />
        </div>
        <div class="pm-overview__cell" data-testid="overview-cell-module">
          <h3 class="pm-overview__cell-title">按模块任务分布</h3>
          <PmChart
            :option="moduleOption"
            :empty="moduleEmpty"
            empty-text="暂无任务，模块分布将在此展示"
            height="300px"
          />
        </div>
      </div>

      <p v-if="data.lastSync" class="pm-overview__sync">索引时间：{{ data.lastSync }}</p>
    </template>
  </section>
</template>
