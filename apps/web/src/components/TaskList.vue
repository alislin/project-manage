<script setup lang="ts">
// 任务列表视图（06-web §2.2 TaskList / §11，TC-06-012，S7）：
// - 表格 + 状态多选/优先级多选/搜索筛选 + 表头点击排序（默认 优先级倒序>due 升序>updated 倒序）；
// - 逾期行/逾期 due 标红（02-core §2.4 口径）；状态徽标；行内快捷流转按钮（合法流转）；
// - 行点击开任务详情模态；需求列可跳需求详情；409 冲突弹窗（Q-05）。
import { computed, onMounted, ref, watch } from "vue";
import type { Priority, TaskItem, TaskStatus } from "../api/types";
import {
  MOVE_LABELS,
  defaultSortTasks,
  filterTasks,
  isTaskOverdue,
  legalTaskTargets,
  sortTaskItems,
  todayIso,
  wikiId,
  type TaskSortKey,
} from "../utils/board";
import { useRequirementsStore } from "../stores/requirements";
import { useTasksStore } from "../stores/tasks";
import { useUiStore } from "../stores/ui";
import ConflictDialog from "./ConflictDialog.vue";
import DateCell from "./DateCell.vue";
import PriorityDot from "./PriorityDot.vue";
import RequirementDetailModal from "./modals/RequirementDetailModal.vue";
import StatusBadge from "./StatusBadge.vue";
import TaskDetailModal from "./modals/TaskDetailModal.vue";

const props = defineProps<{ slug: string }>();

const tasks = useTasksStore();
const requirements = useRequirementsStore();
const ui = useUiStore();

const today = todayIso();

// --- 筛选（TC-06-012：状态多选 / 优先级多选 / 搜索） ---
const query = ref("");
const statusSel = ref<TaskStatus[]>([]);
const prioritySel = ref<Priority[]>([]);
const TASK_STATUSES: TaskStatus[] = ["todo", "doing", "done", "cancelled"];
const PRIORITIES: Priority[] = ["P0", "P1", "P2", "P3"];

// --- 排序（06-web §11） ---
const sortKey = ref<TaskSortKey | "">("");
const sortDir = ref<1 | -1>(1);

const visible = computed(() => {
  const arr = filterTasks(tasks.items, {
    statuses: statusSel.value,
    priorities: prioritySel.value,
    query: query.value,
  });
  return sortKey.value === "" ? defaultSortTasks(arr) : sortTaskItems(arr, sortKey.value, sortDir.value);
});

const hasMatch = computed(() => visible.value.length > 0);

function toggleStatus(s: TaskStatus): void {
  statusSel.value = statusSel.value.includes(s) ? statusSel.value.filter((x) => x !== s) : [...statusSel.value, s];
}

function togglePriority(p: Priority): void {
  prioritySel.value = prioritySel.value.includes(p) ? prioritySel.value.filter((x) => x !== p) : [...prioritySel.value, p];
}

function onSortHeader(key: TaskSortKey): void {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 1 ? -1 : 1;
  } else {
    sortKey.value = key;
    sortDir.value = 1;
  }
}

function sortIndicator(key: TaskSortKey): string {
  if (sortKey.value !== key) return "";
  return sortDir.value === 1 ? "▲" : "▼";
}

/** 行内快捷流转：合法目标（01-数据规范 §3.3）+ 文案 */
function targetsOf(t: TaskItem): TaskStatus[] {
  return [...legalTaskTargets(t.status)];
}

function move(t: TaskItem, to: TaskStatus): void {
  void tasks.moveStatus(t.id, to);
}

/** 任务关联需求 id（wiki-link；悬空时展示原文） */
function reqIdOf(t: TaskItem): string {
  return wikiId(t.requirement);
}

// --- 详情模态与冲突（同看板） ---
const openTaskId = ref<string | null>(null);
const openReqId = ref<string | null>(null);

function openTask(t: TaskItem): void {
  openTaskId.value = t.id;
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

onMounted(() => void tasks.load(props.slug));
watch(
  () => props.slug,
  (s) => void tasks.load(s),
);
</script>

<template>
  <section class="pm-tasklist">
    <!-- 筛选工具栏（TC-06-012：状态多选 / 优先级多选 / 搜索） -->
    <div class="pm-tasklist__toolbar">
      <input
        v-model="query"
        type="search"
        class="pm-tasklist__search"
        placeholder="搜索 ID / 标题"
        aria-label="搜索任务"
      />
      <div class="pm-tasklist__group" role="group" aria-label="按状态筛选">
        <span class="pm-tasklist__group-label">状态</span>
        <label v-for="s in TASK_STATUSES" :key="s" class="pm-tasklist__check">
          <input type="checkbox" :checked="statusSel.includes(s)" @change="toggleStatus(s)" />
          {{ s }}
        </label>
      </div>
      <div class="pm-tasklist__group" role="group" aria-label="按优先级筛选">
        <span class="pm-tasklist__group-label">优先级</span>
        <label v-for="p in PRIORITIES" :key="p" class="pm-tasklist__check">
          <input type="checkbox" :checked="prioritySel.includes(p)" @change="togglePriority(p)" />
          {{ p }}
        </label>
      </div>
      <button
        v-if="statusSel.length > 0 || prioritySel.length > 0 || query !== ''"
        class="pm-tasklist__reset"
        type="button"
        @click="((statusSel = []), (prioritySel = []), (query = ''))"
      >
        重置筛选
      </button>
    </div>

    <!-- 三态：加载 / 错误 / 空 / 无匹配 -->
    <p v-if="tasks.loading" class="pm-board__state">加载中…</p>
    <div v-else-if="tasks.error" class="pm-board__state pm-board__state--error">
      <p>{{ tasks.error }}</p>
      <button type="button" @click="tasks.load(props.slug)">重试</button>
    </div>
    <div v-else-if="tasks.items.length === 0" class="pm-board__state pm-board__state--empty">
      <p>暂无任务</p>
      <p class="pm-board__state-hint">
        运行 <code>pm new task --slug {{ props.slug }} --requirement "[[REQ-…]]" --title "…"</code> 创建第一条任务
      </p>
    </div>
    <div v-else-if="!hasMatch" class="pm-board__state pm-board__state--empty">
      <p>无匹配任务</p>
      <p class="pm-board__state-hint">调整筛选条件后重试</p>
    </div>

    <!-- 任务表格：排序 + 逾期标红 + 状态徽标 + 行内快捷流转 -->
    <div v-else class="pm-tasklist__tablewrap">
      <table class="pm-tasklist__table">
        <thead>
          <tr>
            <th>ID</th>
            <th><button type="button" class="pm-tasklist__sort" @click="onSortHeader('title')">标题<span class="pm-tasklist__sort-ind">{{ sortIndicator("title") }}</span></button></th>
            <th><button type="button" class="pm-tasklist__sort" @click="onSortHeader('status')">状态<span class="pm-tasklist__sort-ind">{{ sortIndicator("status") }}</span></button></th>
            <th><button type="button" class="pm-tasklist__sort" @click="onSortHeader('priority')">优先级<span class="pm-tasklist__sort-ind">{{ sortIndicator("priority") }}</span></button></th>
            <th>需求</th>
            <th><button type="button" class="pm-tasklist__sort" @click="onSortHeader('due')">截止<span class="pm-tasklist__sort-ind">{{ sortIndicator("due") }}</span></button></th>
            <th><button type="button" class="pm-tasklist__sort" @click="onSortHeader('updated')">更新<span class="pm-tasklist__sort-ind">{{ sortIndicator("updated") }}</span></button></th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="t in visible"
            :key="t.id"
            class="pm-tasklist__row"
            :class="{ 'pm-tasklist__row--overdue': isTaskOverdue(t, today) }"
            @click="openTask(t)"
          >
            <td class="pm-tasklist__cell-id">{{ t.id }}</td>
            <td class="pm-tasklist__cell-title">
              <span class="pm-tasklist__title" :title="t.title">{{ t.title }}</span>
            </td>
            <td><StatusBadge :status="t.status" /></td>
            <td><PriorityDot :priority="t.priority" /> {{ t.priority }}</td>
            <td>
              <button v-if="reqIdOf(t) !== ''" type="button" class="pm-tasklist__link" @click.stop="openReqId = reqIdOf(t)">
                {{ reqIdOf(t) }}
              </button>
              <span v-else class="pm-tasklist__dangling">{{ t.requirement }}</span>
            </td>
            <td><DateCell :value="t.due" :overdue="isTaskOverdue(t, today)" :today="t.due === today" /></td>
            <td>{{ t.updated }}</td>
            <td @click.stop>
              <div class="pm-tasklist__ops">
                <button
                  v-for="to in targetsOf(t)"
                  :key="to"
                  type="button"
                  class="pm-tasklist__op"
                  :disabled="tasks.isPending(t.id)"
                  :title="`${MOVE_LABELS[to]} → ${to}`"
                  @click="move(t, to)"
                >
                  {{ MOVE_LABELS[to] }}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
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
