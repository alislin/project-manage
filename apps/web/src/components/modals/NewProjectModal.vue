<script setup lang="ts">
// 新建项目模态表单（S11 hotfix 问题 3，替换 Navbar 占位 toast；05-server §2.2 POST /api/projects）：
// - 字段：name 必填；slug 可选（留空按 name 自动生成，规则同源 01-数据规范 §5）；
//   period 起止默认今天；tags 可选（逗号分隔，去重）；
// - 成功 → emit("created", slug)：父级（Navbar）刷新项目列表并跳转项目工作台 /p/:slug；
// - 失败 → 信封错误映射字段级错误（05-server §1.1：E_VALIDATION field/issues、
//   E_USAGE 缺 name、E_CONFLICT 恒为 slug 已存在；无字段信息则表单级整体展示）。
import { computed, reactive, ref } from "vue";
import { api, ApiError } from "../../api/client";
import { todayIso } from "../../utils/board";

const emit = defineEmits<{ close: []; created: [slug: string] }>();

/** slug 规则（01-数据规范 §5，与 core schema Slug 正则同源：字母数字或中文，单 "-" 连接） */
const SLUG_PATTERN = /^[A-Za-z0-9一-鿿]+(-[A-Za-z0-9一-鿿]+)*$/;

const form = reactive({
  name: "",
  slug: "",
  periodStart: todayIso(),
  periodEnd: todayIso(),
  tags: "",
});

/** 字段级错误（key：name/slug/periodStart/periodEnd/tags） */
const fieldErrors = reactive<Record<string, string>>({});
/** 表单级错误（服务端错误无字段信息时） */
const formError = ref<string | null>(null);
const submitting = ref(false);

/** slug 自动生成：小写拉丁、空白/下划线转 "-"、剔除非法字符、折叠连 "-"、去首尾 "-" */
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9一-鿿-]+/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** 最终提交的 slug：用户填写优先，否则按 name 自动生成 */
const effectiveSlug = computed(() => form.slug.trim() || slugify(form.name));

/** tags 解析：中/英文逗号分隔，trim 去空，去重（01-数据规范 §1.1 tags 去重） */
const tagList = computed(() => {
  const seen = new Set<string>();
  for (const raw of form.tags.split(/[，,]/)) {
    const t = raw.trim();
    if (t !== "") seen.add(t);
  }
  return [...seen];
});

function clearErrors(): void {
  for (const k of Object.keys(fieldErrors)) delete fieldErrors[k];
  formError.value = null;
}

/** 前端校验（06-web §11：表单校验联动；服务端 05-server §2.2 再校验） */
function validate(): boolean {
  clearErrors();
  if (form.name.trim() === "") fieldErrors.name = "name 必填";
  const slug = form.slug.trim();
  if (slug !== "" && !SLUG_PATTERN.test(slug)) {
    fieldErrors.slug = "slug 需为字母数字或中文，中间以单 \"-\" 连接";
  } else if (slug === "" && effectiveSlug.value === "") {
    fieldErrors.slug = "无法按 name 自动生成 slug，请手动填写";
  }
  if (form.periodStart === "") fieldErrors.periodStart = "起始日期必填";
  if (form.periodEnd === "") fieldErrors.periodEnd = "结束日期必填";
  if (form.periodStart !== "" && form.periodEnd !== "" && form.periodStart > form.periodEnd) {
    fieldErrors.periodEnd = "结束日期不能早于起始日期";
  }
  return Object.keys(fieldErrors).length === 0;
}

/** 服务端字段路径 → 表单字段（period tuple 元素映射到起止框；name/slug/tags 同名） */
function normalizeField(field: string | undefined): string | null {
  if (!field) return null;
  if (field === "period") return "periodEnd"; // period[0] ≤ period[1] 的 refine，修正点在结束日期
  if (field === "period.0") return "periodStart";
  if (field === "period.1") return "periodEnd";
  return field;
}

/** 信封错误 → 字段级错误（05-server §1.1 error.field / error.issues） */
function applyServerError(e: ApiError): void {
  const map: Record<string, string> = {};
  for (const issue of e.body?.issues ?? []) {
    const key = normalizeField(issue.field);
    if (key && map[key] === undefined) map[key] = issue.message;
  }
  if (Object.keys(map).length === 0 && e.body?.field) {
    const key = normalizeField(e.body.field);
    if (key) map[key] = e.message;
  }
  if (Object.keys(map).length === 0 && e.code === "E_CONFLICT") {
    map.slug = e.message; // POST /api/projects 的 E_CONFLICT 恒为 slug 已存在（05-server §2.2）
  }
  const keys = Object.keys(map);
  if (keys.length === 0) {
    formError.value = e.message;
  } else {
    for (const k of keys) fieldErrors[k] = map[k];
  }
}

async function submit(): Promise<void> {
  if (!validate()) return;
  submitting.value = true;
  try {
    const data = await api.createProject({
      slug: effectiveSlug.value,
      name: form.name.trim(),
      period: [form.periodStart, form.periodEnd],
      tags: tagList.value,
    });
    emit("created", data.created.slug);
  } catch (e) {
    if (e instanceof ApiError) applyServerError(e);
    else formError.value = "创建失败，请重试";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="pm-modal" @click.self="emit('close')">
    <div class="pm-modal__dialog pm-npform" role="dialog" aria-modal="true" aria-label="新建项目" data-testid="new-project-dialog">
      <header class="pm-modal__head">
        <h3 class="pm-modal__title">新建项目</h3>
        <button class="pm-modal__close" type="button" aria-label="关闭" @click="emit('close')">✕</button>
      </header>

      <form class="pm-form" novalidate @submit.prevent="submit">
        <div class="pm-form__field">
          <label class="pm-form__label" for="np-name">名称 name<span class="pm-form__req">必填</span></label>
          <input
            id="np-name"
            v-model="form.name"
            class="pm-form__input"
            :class="{ 'pm-form__input--invalid': fieldErrors.name }"
            type="text"
            placeholder="如：我的应用 v2"
          />
          <p v-if="fieldErrors.name" class="pm-form__error">{{ fieldErrors.name }}</p>
        </div>

        <div class="pm-form__field">
          <label class="pm-form__label" for="np-slug">slug<span class="pm-form__opt">可选，留空自动生成</span></label>
          <input
            id="np-slug"
            v-model="form.slug"
            class="pm-form__input"
            :class="{ 'pm-form__input--invalid': fieldErrors.slug }"
            type="text"
            placeholder="留空按名称生成"
          />
          <p v-if="fieldErrors.slug" class="pm-form__error">{{ fieldErrors.slug }}</p>
          <p v-else-if="effectiveSlug" class="pm-form__hint">将使用：{{ effectiveSlug }}</p>
        </div>

        <div class="pm-form__row">
          <div class="pm-form__field">
            <label class="pm-form__label" for="np-period-start">起始日期</label>
            <input
              id="np-period-start"
              v-model="form.periodStart"
              class="pm-form__input"
              :class="{ 'pm-form__input--invalid': fieldErrors.periodStart }"
              type="date"
            />
            <p v-if="fieldErrors.periodStart" class="pm-form__error">{{ fieldErrors.periodStart }}</p>
          </div>
          <div class="pm-form__field">
            <label class="pm-form__label" for="np-period-end">结束日期</label>
            <input
              id="np-period-end"
              v-model="form.periodEnd"
              class="pm-form__input"
              :class="{ 'pm-form__input--invalid': fieldErrors.periodEnd }"
              type="date"
            />
            <p v-if="fieldErrors.periodEnd" class="pm-form__error">{{ fieldErrors.periodEnd }}</p>
          </div>
        </div>

        <div class="pm-form__field">
          <label class="pm-form__label" for="np-tags">tags<span class="pm-form__opt">可选，逗号分隔</span></label>
          <input
            id="np-tags"
            v-model="form.tags"
            class="pm-form__input"
            :class="{ 'pm-form__input--invalid': fieldErrors.tags }"
            type="text"
            placeholder="如：前端, 高优"
          />
          <p v-if="fieldErrors.tags" class="pm-form__error">{{ fieldErrors.tags }}</p>
        </div>

        <p v-if="formError" class="pm-form__error pm-form__error--form" role="alert">{{ formError }}</p>

        <div class="pm-form__actions">
          <button type="button" class="pm-form__btn pm-form__btn--ghost" :disabled="submitting" @click="emit('close')">
            取消
          </button>
          <button type="submit" class="pm-form__btn pm-form__btn--primary" data-testid="np-submit" :disabled="submitting">
            {{ submitting ? "创建中…" : "创建" }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
