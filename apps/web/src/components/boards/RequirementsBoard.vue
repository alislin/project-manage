<script setup lang="ts">
// 需求池看板（06-web §2.2/§6.1 RequirementsBoard，S7）：
// - 四栏：Pool / Reviewing / Accepted / Done+Rejected（第 4 列双泳道折叠，§12 要点 6.1）；
// - 跨列拖拽 → store.moveStatus（乐观更新 → PATCH → 失败回滚 / 409 自动重试一次，Q-05）；
// - module + priority 筛选；加载/错误/空/无匹配四态；详情模态 + 冲突弹窗。
import { computed, onMounted, ref, watch } from "vue";
import type { ReqStatus, RequirementItem } from "../../api/types";
import { groupRequirements } from "../../utils/board";
import { useRequirementsStore } from "../../stores/requirements";
import { useUiStore } from "../../stores/ui";
import ConflictDialog from "../ConflictDialog.vue";
import RequirementDetailModal from "../modals/RequirementDetailModal.vue";
import TaskDetailModal from "../modals/TaskDetailModal.vue";
import RequirementColumn from "./RequirementColumn.vue";
import type { RequirementLane } from "./types";

const props = defineProps<{ slug: string }>();

const store = useRequirementsStore();
const ui = useUiStore();

/** 四栏定义（06-web §6.1）：第 4 列 Done + Rejected 折叠合并，左侧标签区分 */
const COLUMN_DEFS: Array<{ key: string; title: string; lanes: Array<{ status: ReqStatus; label: string }> }> = [
  { key: "pool", title: "Pool", lanes: [{ status: "pool", label: "Pool" }] },
  { key: "reviewing", title: "Reviewing", lanes: [{ status: "reviewing", label: "Reviewing" }] },
  { key: "accepted", title: "Accepted", lanes: [{ status: "accepted", label: "Accepted" }] },
  {
    key: "done",
    title: "Done + Rejected",
    lanes: [
      { status: "done", label: "Done" },
      { status: "rejected", label: "Rejected" },
    ],
  },
];

const columns = computed(() => {
  const grouped = groupRequirements(store.filtered);
  return COLUMN_DEFS.map((def) => ({
    key: def.key,
    title: def.title,
    lanes: def.lanes.map((l): RequirementLane => ({ ...l, items: grouped[l.status] })),
  }));
});

const hasAny = computed(() => store.items.length > 0);
const hasMatch = computed(() => store.filtered.length > 0);

// 详情模态：需求 ⇄ 任务交叉跳转（06-web §3.3）
const openReqId = ref<string | null>(null);
const openTaskId = ref<string | null>(null);

function openCard(item: RequirementItem): void {
  openReqId.value = item.id;
}

function onMove(id: string, to: ReqStatus): void {
  void store.moveStatus(id, to);
}

/** 冲突弹窗"刷新并重试"（Q-05）：重新拉取后再次流转 */
function onConflictRetry(): void {
  const c = ui.conflict;
  if (!c) return;
  ui.clearConflict();
  void (async () => {
    await store.refresh();
    await store.moveStatus(c.id, c.to as ReqStatus);
  })();
}

onMounted(() => void store.load(props.slug));
watch(
  () => props.slug,
  (s) => void store.load(s),
);
</script>

<template>
  <section class="pm-board">
    <!-- 筛选工具栏（S7-6：module + priority） -->
    <div class="pm-board__toolbar">
      <label class="pm-board__filter">
        模块
        <select v-model="store.moduleFilter" aria-label="按模块筛选">
          <option value="">全部模块</option>
          <option v-for="m in store.moduleOptions" :key="m" :value="m">{{ m }}</option>
        </select>
      </label>
      <label class="pm-board__filter">
        优先级
        <select v-model="store.priorityFilter" aria-label="按优先级筛选">
          <option value="">全部优先级</option>
          <option v-for="p in ['P0', 'P1', 'P2', 'P3']" :key="p" :value="p">{{ p }}</option>
        </select>
      </label>
    </div>

    <!-- 三态：加载 / 错误 / 空 / 无匹配 -->
    <p v-if="store.loading" class="pm-board__state">加载中…</p>
    <div v-else-if="store.error" class="pm-board__state pm-board__state--error">
      <p>{{ store.error }}</p>
      <button type="button" @click="store.load(props.slug)">重试</button>
    </div>
    <div v-else-if="!hasAny" class="pm-board__state pm-board__state--empty">
      <p>需求池为空</p>
      <p class="pm-board__state-hint">运行 <code>pm new requirement --slug {{ props.slug }} --title "…"</code> 创建第一条需求</p>
    </div>
    <div v-else-if="!hasMatch" class="pm-board__state pm-board__state--empty">
      <p>无匹配需求</p>
      <p class="pm-board__state-hint">当前筛选条件下没有需求，调整模块或优先级筛选</p>
    </div>

    <!-- 四栏看板 -->
    <div v-else class="pm-board__grid">
      <RequirementColumn
        v-for="col in columns"
        :key="col.key"
        :title="col.title"
        :lanes="col.lanes"
        @move="onMove"
        @open="openCard"
      />
    </div>

    <!-- 详情模态（需求 ⇄ 任务交叉跳转，06-web §3.3） -->
    <RequirementDetailModal
      v-if="openReqId"
      :requirement-id="openReqId"
      @close="openReqId = null"
      @open-task="(id) => ((openReqId = null), (openTaskId = id))"
    />
    <TaskDetailModal
      v-if="openTaskId"
      :task-id="openTaskId"
      @close="openTaskId = null"
      @open-requirement="(id) => ((openTaskId = null), (openReqId = id))"
    />

    <!-- 409 冲突弹窗（Q-05：刷新并重试/取消） -->
    <ConflictDialog @retry="onConflictRetry" />
  </section>
</template>
