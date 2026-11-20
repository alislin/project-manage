<script setup lang="ts">
// 需求详情模态（06-web §2.2/§3.3 RequirementDetailModal，TC-06-008）：
// - GET /api/requirements/:id → requirement + relatedTasks（05-server §2.6 反链聚合）；
// - 展示 frontmatter 全字段 + 正文区（v1 数据模型 frontmatter-only，说明文本承载于 source 字段）
//   + 关联任务链接（可点击跳任务详情）+ 合法状态流转 PATCH 按钮（带 expectedMtimeMs）。
import { computed, onMounted, ref, watch } from "vue";
import { api, ApiError } from "../../api/client";
import type { ReqStatus, RequirementDetailData } from "../../api/types";
import { MOVE_LABELS, legalReqTargets } from "../../utils/board";
import { useRequirementsStore } from "../../stores/requirements";
import { useUiStore } from "../../stores/ui";
import PriorityDot from "../PriorityDot.vue";
import StatusBadge from "../StatusBadge.vue";

const props = defineProps<{ requirementId: string }>();
const emit = defineEmits<{ close: []; openTask: [id: string]; moved: [to: ReqStatus] }>();

const store = useRequirementsStore();
const ui = useUiStore();

const loading = ref(false);
const error = ref<string | null>(null);
const detail = ref<RequirementDetailData | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    detail.value = await api.getRequirement(props.requirementId);
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : "加载需求详情失败";
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());
watch(() => props.requirementId, () => void load());

/** 合法流转目标（01-数据规范 §3.2；done 终态无按钮） */
const targets = computed(() => (detail.value ? legalReqTargets(detail.value.requirement.status) : []));

const paragraphs = computed(() => (detail.value ? detail.value.requirement.source.split(/\n+/).filter((p) => p !== "") : []));

/** 流转：复用 store.moveStatus（乐观更新/回滚/Q-05 冲突重试同源），成功后重拉详情刷新 updated/mtimeMs */
async function move(to: ReqStatus): Promise<void> {
  const res = await store.moveStatus(props.requirementId, to);
  if (res.ok && res.reason !== "same") {
    emit("moved", to);
    await load();
  }
}

/** mtimeMs 数据版本展示（05-server §1.1，冲突检测基准） */
function fmtMtime(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}
</script>

<template>
  <div class="pm-modal" @click.self="emit('close')">
    <div class="pm-modal__dialog" role="dialog" aria-modal="true" aria-label="需求详情">
      <header class="pm-modal__head">
        <h3 class="pm-modal__title">{{ detail?.requirement.title ?? props.requirementId }}</h3>
        <button class="pm-modal__close" type="button" aria-label="关闭" @click="emit('close')">✕</button>
      </header>

      <p v-if="loading" class="pm-modal__state">加载中…</p>
      <div v-else-if="error" class="pm-modal__state pm-modal__state--error">
        <p>{{ error }}</p>
        <button type="button" @click="load">重试</button>
      </div>

      <template v-else-if="detail">
        <!-- frontmatter 全字段（01-数据规范 §1.2） -->
        <dl class="pm-modal__fields" data-testid="req-fields">
          <dt>id</dt>
          <dd>{{ detail.requirement.id }}</dd>
          <dt>type</dt>
          <dd>{{ detail.requirement.type }}</dd>
          <dt>title</dt>
          <dd>{{ detail.requirement.title }}</dd>
          <dt>status</dt>
          <dd><StatusBadge :status="detail.requirement.status" /></dd>
          <dt>priority</dt>
          <dd><PriorityDot :priority="detail.requirement.priority" /> {{ detail.requirement.priority }}</dd>
          <dt>module</dt>
          <dd>{{ detail.requirement.module || "（无）" }}</dd>
          <dt>created</dt>
          <dd>{{ detail.requirement.created }}</dd>
          <dt>updated</dt>
          <dd>{{ detail.requirement.updated }}</dd>
          <dt>mtimeMs</dt>
          <dd>{{ fmtMtime(detail.requirement.mtimeMs) }}</dd>
        </dl>

        <!-- 正文/来源说明（source 必填非空，R-102） -->
        <section class="pm-modal__section">
          <h4 class="pm-modal__section-title">正文（source）</h4>
          <div class="pm-modal__source">
            <p v-for="(p, i) in paragraphs" :key="i">{{ p }}</p>
          </div>
        </section>

        <!-- 状态流转 PATCH（TC-06-008；无字段编辑类端点，R-105） -->
        <section class="pm-modal__section">
          <h4 class="pm-modal__section-title">状态流转</h4>
          <div class="pm-modal__flow">
            <button
              v-for="t in targets"
              :key="t"
              type="button"
              class="pm-modal__flow-btn"
              :disabled="store.isPending(detail.requirement.id)"
              @click="move(t)"
            >
              {{ MOVE_LABELS[t] }} → {{ t }}
            </button>
            <span v-if="targets.length === 0" class="pm-modal__flow-none">终态，无可用流转</span>
          </div>
        </section>

        <!-- 关联任务反链（01-数据规范 §6.3 / 05-server §2.6） -->
        <section class="pm-modal__section">
          <h4 class="pm-modal__section-title">关联任务（{{ detail.relatedTasks.length }}）</h4>
          <ul class="pm-modal__links">
            <li v-for="t in detail.relatedTasks" :key="t.id" class="pm-modal__link">
              <button type="button" class="pm-modal__link-btn" @click="emit('openTask', t.id)">{{ t.id }}</button>
              <span class="pm-modal__link-title">{{ t.title }}</span>
              <StatusBadge :status="t.status" />
            </li>
            <li v-if="detail.relatedTasks.length === 0" class="pm-modal__link pm-modal__link--empty">暂无关联任务</li>
          </ul>
        </section>
      </template>
    </div>
  </div>
</template>
