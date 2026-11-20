<script setup lang="ts">
// 任务看板（06-web §2.2/§6 TasksBoard，S7）：
// - 四栏 todo/doing/done/cancelled，跨列拖拽 → store.moveStatus（同需求看板内核，06-web §6）；
// - module（经关联需求解析）+ priority 筛选；逾期 due 标红（TC-06-011）；
// - 加载/错误/空/无匹配四态；任务/需求详情模态交叉跳转 + 冲突弹窗。
import { computed, onMounted, ref, watch } from "vue";
import type { TaskItem, TaskStatus } from "../../api/types";
import { groupTasks } from "../../utils/board";
import { useRequirementsStore } from "../../stores/requirements";
import { useTasksStore } from "../../stores/tasks";
import { useUiStore } from "../../stores/ui";
import ConflictDialog from "../ConflictDialog.vue";
import RequirementDetailModal from "../modals/RequirementDetailModal.vue";
import TaskDetailModal from "../modals/TaskDetailModal.vue";
import TaskColumn from "./TaskColumn.vue";
import type { TaskLane } from "./types";

const props = defineProps<{ slug: string }>();

const tasks = useTasksStore();
const requirements = useRequirementsStore(); // module 筛选经关联需求解析（任务无 module 字段）
const ui = useUiStore();

const COLUMN_DEFS: Array<{ key: string; title: string; lanes: Array<{ status: TaskStatus; label: string }> }> = [
  { key: "todo", title: "Todo", lanes: [{ status: "todo", label: "Todo" }] },
  { key: "doing", title: "Doing", lanes: [{ status: "doing", label: "Doing" }] },
  { key: "done", title: "Done", lanes: [{ status: "done", label: "Done" }] },
  { key: "cancelled", title: "Cancelled", lanes: [{ status: "cancelled", label: "Cancelled" }] },
];

const columns = computed(() => {
  const grouped = groupTasks(tasks.filtered);
  return COLUMN_DEFS.map((def) => ({
    key: def.key,
    title: def.title,
    lanes: def.lanes.map((l): TaskLane => ({ ...l, items: grouped[l.status] })),
  }));
});

const hasAny = computed(() => tasks.items.length > 0);
const hasMatch = computed(() => tasks.filtered.length > 0);

const openTaskId = ref<string | null>(null);
const openReqId = ref<string | null>(null);

function openCard(item: TaskItem): void {
  openTaskId.value = item.id;
}

function onMove(id: string, to: TaskStatus): void {
  void tasks.moveStatus(id, to);
}

function onConflictRetry(): void {
  const c = ui.conflict;
  if (!c) return;
  ui.clearConflict();
  void (async () => {
    await tasks.refresh();
    await tasks.moveStatus(c.id, c.to as TaskStatus);
  })();
}

onMounted(() => {
  void tasks.load(props.slug);
  void requirements.load(props.slug);
});
watch(
  () => props.slug,
  (s) => {
    void tasks.load(s);
    void requirements.load(s);
  },
);
</script>

<template>
  <section class="pm-board">
    <!-- 筛选工具栏（S7-6：module + priority） -->
    <div class="pm-board__toolbar">
      <label class="pm-board__filter">
        模块
        <select v-model="tasks.moduleFilter" aria-label="按模块筛选">
          <option value="">全部模块</option>
          <option v-for="m in tasks.moduleOptions" :key="m" :value="m">{{ m }}</option>
        </select>
      </label>
      <label class="pm-board__filter">
        优先级
        <select v-model="tasks.priorityFilter" aria-label="按优先级筛选">
          <option value="">全部优先级</option>
          <option v-for="p in ['P0', 'P1', 'P2', 'P3']" :key="p" :value="p">{{ p }}</option>
        </select>
      </label>
    </div>

    <p v-if="tasks.loading" class="pm-board__state">加载中…</p>
    <div v-else-if="tasks.error" class="pm-board__state pm-board__state--error">
      <p>{{ tasks.error }}</p>
      <button type="button" @click="tasks.load(props.slug)">重试</button>
    </div>
    <div v-else-if="!hasAny" class="pm-board__state pm-board__state--empty">
      <p>任务看板为空</p>
      <p class="pm-board__state-hint">运行 <code>pm new task --slug {{ props.slug }} --requirement "[[REQ-…]]" --title "…"</code> 创建第一条任务</p>
    </div>
    <div v-else-if="!hasMatch" class="pm-board__state pm-board__state--empty">
      <p>无匹配任务</p>
      <p class="pm-board__state-hint">当前筛选条件下没有任务，调整模块或优先级筛选</p>
    </div>

    <div v-else class="pm-board__grid">
      <TaskColumn
        v-for="col in columns"
        :key="col.key"
        :title="col.title"
        :lanes="col.lanes"
        :module-of="(t) => tasks.moduleOf(t)"
        :data-testid="`task-column-${col.key}`"
        @move="onMove"
        @open="openCard"
      />
    </div>

    <TaskDetailModal
      v-if="openTaskId"
      :task-id="openTaskId"
      @close="openTaskId = null"
      @open-requirement="(id) => ((openTaskId = null), (openReqId = id))"
    />
    <RequirementDetailModal
      v-if="openReqId"
      :requirement-id="openReqId"
      @close="openReqId = null"
      @open-task="(id) => ((openReqId = null), (openTaskId = id))"
    />

    <ConflictDialog @retry="onConflictRetry" />
  </section>
</template>
