<script setup lang="ts">
// 任务详情模态（06-web §2.2/§3.3 TaskDetailModal，TC-06-016）：
// - GET /api/tasks/:id → task + relatedRequirement（05-server §3.4 反向查询）；
// - frontmatter 全字段 + 正文区（completed 时间线说明）+ 需求链接可点击跳转 + 状态流转 PATCH 按钮。
import { computed, onMounted, ref, watch } from "vue";
import { api, ApiError } from "../../api/client";
import type { TaskDetailData, TaskStatus } from "../../api/types";
import { MOVE_LABELS, legalTaskTargets, todayIso } from "../../utils/board";
import { useTasksStore } from "../../stores/tasks";
import { useUiStore } from "../../stores/ui";
import DateCell from "../DateCell.vue";
import PriorityDot from "../PriorityDot.vue";
import StatusBadge from "../StatusBadge.vue";

const props = defineProps<{ taskId: string }>();
const emit = defineEmits<{ close: []; openRequirement: [id: string]; moved: [to: TaskStatus] }>();

const store = useTasksStore();
const ui = useUiStore();

const loading = ref(false);
const error = ref<string | null>(null);
const detail = ref<TaskDetailData | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    detail.value = await api.getTask(props.taskId);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "加载任务详情失败";
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());
watch(() => props.taskId, () => void load());

const targets = computed(() => (detail.value ? legalTaskTargets(detail.value.task.status) : []));

const today = computed(() => todayIso());
const related = computed(() => detail.value?.relatedRequirement);

const paragraphs = computed(() => {
  if (!detail.value) return [];
  const t = detail.value.task;
  const lines = [t.title];
  if (t.completed) lines.push(`完成于 ${t.completed}`);
  return lines;
});

async function move(to: TaskStatus): Promise<void> {
  const res = await store.moveStatus(props.taskId, to);
  if (res.ok && res.reason !== "same") {
    emit("moved", to);
    await load();
  }
}

function fmtMtime(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}
</script>

<template>
  <div class="pm-modal" @click.self="emit('close')">
    <div class="pm-modal__dialog" role="dialog" aria-modal="true" aria-label="任务详情">
      <header class="pm-modal__head">
        <h3 class="pm-modal__title">{{ detail?.task.title ?? props.taskId }}</h3>
        <button class="pm-modal__close" type="button" aria-label="关闭" @click="emit('close')">✕</button>
      </header>

      <p v-if="loading" class="pm-modal__state">加载中…</p>
      <div v-else-if="error" class="pm-modal__state pm-modal__state--error">
        <p>{{ error }}</p>
        <button type="button" @click="load">重试</button>
      </div>

      <template v-else-if="detail">
        <!-- frontmatter 全字段（01-数据规范 §1.3） -->
        <dl class="pm-modal__fields" data-testid="task-fields">
          <dt>id</dt>
          <dd>{{ detail.task.id }}</dd>
          <dt>type</dt>
          <dd>{{ detail.task.type }}</dd>
          <dt>title</dt>
          <dd>{{ detail.task.title }}</dd>
          <dt>status</dt>
          <dd><StatusBadge :status="detail.task.status" /></dd>
          <!-- 需求链接（S7-5：任务详情显示需求链接可点击跳转；05-server §3.4 relatedRequirement） -->
          <dt>requirement</dt>
          <dd>
            <button
              v-if="related"
              type="button"
              class="pm-modal__link-btn"
              @click="emit('openRequirement', related.id)"
            >
              {{ related.id }}
            </button>
            <span v-else>{{ detail.task.requirement }}（悬空链接）</span>
          </dd>
          <dt>priority</dt>
          <dd><PriorityDot :priority="detail.task.priority" /> {{ detail.task.priority }}</dd>
          <dt>due</dt>
          <dd><DateCell :value="detail.task.due" :today="detail.task.due === today" /></dd>
          <dt>estimate</dt>
          <dd>{{ detail.task.estimate !== undefined ? `${detail.task.estimate} 人日` : "（未估）" }}</dd>
          <dt>completed</dt>
          <dd>{{ detail.task.completed ?? "（未完成）" }}</dd>
          <dt>created</dt>
          <dd>{{ detail.task.created }}</dd>
          <dt>updated</dt>
          <dd>{{ detail.task.updated }}</dd>
          <dt>mtimeMs</dt>
          <dd>{{ fmtMtime(detail.task.mtimeMs) }}</dd>
        </dl>

        <!-- 正文区（v1 frontmatter-only；标题 + completed 时间线） -->
        <section class="pm-modal__section">
          <h4 class="pm-modal__section-title">正文</h4>
          <div class="pm-modal__source">
            <p v-for="(p, i) in paragraphs" :key="i">{{ p }}</p>
          </div>
        </section>

        <!-- 状态流转 PATCH（TC-06-016） -->
        <section class="pm-modal__section">
          <h4 class="pm-modal__section-title">状态流转</h4>
          <div class="pm-modal__flow">
            <button
              v-for="t in targets"
              :key="t"
              type="button"
              class="pm-modal__flow-btn"
              :disabled="store.isPending(detail.task.id)"
              @click="move(t)"
            >
              {{ MOVE_LABELS[t] }} → {{ t }}
            </button>
            <span v-if="targets.length === 0" class="pm-modal__flow-none">终态，无可用流转</span>
          </div>
        </section>

        <!-- 关联需求（05-server §3.4） -->
        <section v-if="related" class="pm-modal__section">
          <h4 class="pm-modal__section-title">关联需求</h4>
          <ul class="pm-modal__links">
            <li class="pm-modal__link">
              <button type="button" class="pm-modal__link-btn" @click="emit('openRequirement', related.id)">
                {{ related.id }}
              </button>
              <span class="pm-modal__link-title">{{ related.title }}</span>
              <StatusBadge :status="related.status" />
            </li>
          </ul>
        </section>
      </template>
    </div>
  </div>
</template>
