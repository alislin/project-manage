# 06 · Web UI 详设

> 依据：`docs/00-plan-final.md`（唯一事实来源，§6：亮暗主题、看板、ECharts 漏斗等；§7：Vite + Vue 3 Composition API + `<script setup>` + Pinia + SCSS 7-1 + BEM；§2：拖拽 vuedraggable 或同类）
> 契约参考：`docs/design/01-数据规范.md`、`02-core.md`、`03-cli.md`、`05-server.md`（API/SSE/409 流程）

---

## 1. 路由表（plan §6）

| 路由 | 页面 | 描述 |
|---|---|---|
| `/` | 多项目总览卡片墙（`Pages/HomePage.vue`） | 项目卡片：状态徽标 + 进度环（ECharts 或 CSS Ring，见 §7.3）+ 逾期数 + 整体完成率；支持新建项目、进入项目 |
| `/p/:slug` | 项目工作台（`Pages/ProjectPage.vue`） | Tab 切换：`需求池` / `任务看板` / `任务列表` / `进度总览` |
| `/p/:slug/detail`（可选） | 详情页（`Pages/DetailPage.vue`） | 需求/任务详情查看与编辑（§3.4） |

- 约定：API 请求在前端统一经 `01-数据规范` 中的 HTTP 约定（`05-server §1`），响应外壳 `{ ok, data, error }`。
- 用户身份：单用户模式（plan §9 非目标），无需登录/路由守卫。

> **理由**：路由与 plan §6 一致；`/detail` 在 v1 可选，不可否认地属于看板的体验补充（见 open-questions，§12.5）。

---

## 2. 组件树（组件名 / 职责 / Props / 事件）

### 2.1 总体

```
App.vue                              # 主入口：SSE 订阅 + 主题初始化 + Pinia 初始化
  ├── Navbar.vue                     # 顶部导航（返回首页、当前项目切换、全局搜索框、新建项目按钮）
  ├── ErrorToast.vue                 # 统一错误提示（收到 5xx/4xx → toast）
  └── RouterView
      ├── HomePage.vue
      │   └── ProjectCard.vue        # 项目卡片（props: slug/name/status/progress/overdueCount；event: click→/p/:slug）
      └── ProjectPage.vue            # 项目工作台：Tabs 与对应子组件
```

### 2.2 项目工作台 `ProjectPage.vue`

```
ProjectPage.vue
├── ProjectHeader.vue                # 页头：项目名 + status 徽标 + 进度环（ECharts，§7.3）
│   └── 事件: (none)
├── <Tabs>                           # 需求池 / 任务看板 / 任务列表 / 进度总览
│   ├── RequirementsBoard.vue        # 需求池：4 列看板
│   │   ├── RequirementColumn.vue    # 一列（props: status, items[], projectSlug, boardService）
│   │   │   └── RequirementCard.vue  # 需求卡（props: id/title/status/priority/updated, mtimeMs；events: dragStart/dragEnd, click→详情）
│   │   └── RequirementDetailModal.vue # 需求详情（关联任务/进度/编辑）
│   ├── TasksBoard.vue               # 任务看板：todo/doing/done/cancelled 四列 + 逾期标红
│   │   ├── TaskColumn.vue
│   │   │   └── TaskCard.vue         # 任务卡（props: id/title/status/priority/due/estimate/overdue, mtimeMs）
│   │   └── TaskDetailModal.vue      # 任务详情（关联需求/进度/编辑）
│   ├── TaskList.vue                 # 任务列表（表格/虚拟列表形式：状态筛选+优先级筛选+搜索+排序）
│   └── OverviewPage.vue             # 进度总览（ECharts 三图 + 汇总卡片）
└── (公共组件)
    ├── StatusBadge.vue              # 状态徽标（需求: pool/reviewing/accepted/rejected/done；任务: todo/doing/cancelled）
    ├── PriorityDot.vue              # P0–P3 圆点
    └── DateCell.vue                 # 日期显示（今天/逾期标红/自然转绝对）
```

> **理由**：组件拆分按"看板/列表/详情/公共原子"原则，props/事件让各组件可单独用（§3.4 打开路由/模态的交互细节见 `06-web §3`）。

### 2.3 新建/编辑对话框

```
RequirementForm.vue                  # 新建需求（title/module/source/priority/status）
TaskForm.vue                         # 新建任务（title/requirement/priority/due/estimate/status）
```

---

## 3. 页面交互设计

### 3.1 拖拽流转（`00-plan-final §6` "拖拽流转"）

1. 用户跨列拖动卡片（`vuedraggable` 或 `@vueuse/browser` 的 `useDraggable` + `useArrayFindIndex`）；
2. **乐观更新**：立即移动卡片 + 更新本地 store；
3. 发起 `PATCH /api/requirements/:id`（需求）或 `PATCH /api/tasks/:id`（任务），body = `{ status: 新列, expectedMtimeMs: 卡片 mtimeMs }`；
4. 成功 → 确认；失败 → **回滚**（本地状态恢复原列，`05-server §6.4` 冲突 body）+ 提示（冲突提示弹框 §3.2）；
5. 顺序由后端 `05-server §6` 流程串行保证。

### 3.2 冲突提示（`05-server §6.4`）

- 收到 `409`（`E_CONFLICT`）→ 弹出模态提示：`文件已被外部修改（mtime 冲突），是否刷新并重试？`（按钮：刷新并重试/取消）；
- 刷新：`GET` 重新拉取对应资源，本地重新分组（§3.1）；重试时重新发送 `expectedMtimeMs`。

### 3.3 详情页

- 读取：`GET /api/requirements/:id` → `{ requirement, relatedTasks }`（`05-server §2.6`）、`GET /api/tasks/:id` → `{ task, relatedRequirement }`（`05-server §3.4`）。
- 编辑：status 流转 → `PATCH`（`05-server §2.7`/§3.3，带 `expectedMtimeMs`，失败回滚）；priority/title/due/estimate 等字段编辑：暂无后端端点（`05-server §2-3` 只提供创建与流转），属待补项。
- 交叉引用展示：需求→任务反链（`relatedTasks`）；任务→需求链接跳转。

### 3.4 新建/编辑表单

- 表单项：text（title/module/source/name/slug）、enum（status/priority/project status）、date picker（`due`/`period`）、tags 输入框、number（estimate）、textarea（requirement 的 source 说明，必填非空，见 `01-数据规范 §1.2`）。
- 提交：`POST /api/projects/:slug/requirements` 等（带 `expectedMtimeMs`？POST 为新建无冲突检测）；错误 422/409 见 `05-server §6`。
- 操作前确认：`cancel`、`delete`（取消状态触发 `cancelled` 流转，`01-数据规范 §3.3`）。

---

## 4. Pinia Stores（划分与职责，plan §6）

| Store | 路径 | 职责 |
|---|---|---|
| `ThemeStore` | `stores/theme.ts` | 亮暗主题切换（§7.6），启动时读 `localStorage` 并套用 `data-theme` 属性 |
| `ConfigStore` | `stores/config.ts` | 全局配置快照（无需网络：默认配置即可），路由基础上下文 |
| `ProjectStore` | `stores/project.ts` | 项目列表（`/api/projects`）、active project、overview（`/api/projects/:slug/overview`）、进度环数据（`02-core §2.4 Progress`） |
| `RequirementsStore` | `stores/requirements.ts` | 当前项目的需求池：`items[]`（列-内的看板分组由 computed），按 status 聚合（反链由后端/`requirementTasks` 辅助）；方法：`load(slug)`、`moveStatus(id, status)`（写冲突带回滚）、`refresh(slug)`（`/api/projects/:slug/requirements` + broken） |
| `TasksStore` | `stores/tasks.ts` | 任务看板/列表数据：`items[]`，按 status 聚合；`overdue` computed（`02-core §2.4`）；`moveStatus(id, status)`（写冲突回滚）、`refresh(slug)` |
| `StatsStore` | `stores/stats.ts` | 聚合统计（`pm stats`）：触发计时刷新、`refresh()`（`/api/projects` 重新聚合） |
| `EventsStore` | `stores/events.ts` | SSE 订阅（`/api/events`）+ 重连逻辑；事件缓存 `{ lastRevision }`；非全局刷新端（stores 的 `onVaultUpdated` 回调） |

> **理由**：每个 store 单一职责对应一个 API 资源（`05-server §2-3` + `§5`）；`EventsStore` 负责网络，不直接操控业务 store——业务 stores 由 `onVaultUpdated(revision)` 驱动局部刷新（§5）。

---

## 5. SSE 订阅与局部刷新（`05-server §5`, `06-web §4`）

1. **连接**：`App.vue` 启动 `EventsStore.connect()`：`new EventSource("/api/events")`；
2. **状态**：`readyState` 监听，`open`/`error`/`close` 都处理（Native EventSource 自动重连）；
3. **事件处理**：
   - `connected` → 记录 `lastRevision`，随即触发"全量刷新"（`GET /api/projects` + `ProjectStore.refresh()`）；
   - `vault:updated` → 更新 `lastRevision`，把 `changes` 按 path 写入各 store 的"变更队列"：若已有同路径记录则合并；再触发受影响 store 的 `refresh()`（§4 各 store 的 `refresh` 已包含完整拉取，`05-server §5.3` 已注明服务端合并，前端只关心 refresh）；
   - `vault:ping` → 忽略（保活）。
4. **乐观更新跟锁**：`RequirementsStore.moveStatus` 先更新本地 `items[]`（乐观）→ 发 PATCH → 成功时无动作（已一致）→ 失败（E_CONFLICT/E_INVALID_TRANSITION/E_VALIDATION）时回滚 + 提示（`03-cli §6.4`）；SSE 收到的 refresh 会覆盖任何未提交的本地分组（理由：后端是唯一真值，前端任何本地状态变更都应通过 refresh 收敛）。
5. **离线/断线**：`EventSource` 自动重连（≈3s）；若 `/api/events` 连不上，`onError` 设置一次提示"SSE 不可用，将每 15s 全量刷新一次"（备用轮询策略：每 15s 执行一次 `GET /api/projects` 全局刷新——实现于 `EventsStore.fallbackPolling()`，前提是事件失败超过 3 次连接）。

---

## 6. 看板拖拽实现要点（`00-plan-final §6` "拖拽流转"）

> 相同的拖拽内核应用于 `RequirementsBoard` 与 `TasksBoard`：

```
1. 跨列拖出 → 目标列 showDropZone（高亮）；
2. drop → 排序 = 目标列底部（或拖到特定卡的前/后）；
3. 乐观更新（§3.1）；
4. PATCH → 成功：保留；失败：回滚（§3.1）；
5. 顺序与并发：`05-server §6` 写锁串行，前端也用 `canvasWriteLock` 防止错换列（多次 PATCH 快速操作）。
```

### 6.1 需求池四栏（`00-plan-final §6`）

- 列：`pool`、`reviewing`、`accepted`、`done + rejected`（四列折叠合并 done 与 rejected 列——具体按 plan "四栏（pool/reviewing/accepted/done+rejected）"：
  - 四列 = [Pool, Reviewing, Accepted, Done]，其中最后一列为"Done + Rejected"折叠合并？不——清楚起见：定义为 **四列：Pool / Reviewing / Accepted / Done+Rejected**，其中第 4 列显示 done 与 rejected，左侧 Badges 区分）
- 行卡片：`RequirementCard`（`priority` 圆点、`source` 悬浮显示、`estimate` 时间线？需求没有 estimate 字段——跳过）。
- 状态流转表详见 `01-数据规范 §3.2`（`pm move` 用，Web 同源 `02-core §3`）。

> **理由**：需求的 `status` 流转只设置 `updated`（无 `completed`，见 §2.2），因此拖拽需求不需要 `completed` 逻辑。

---

## 7. ECharts 图表清单（`00-plan-final §6` "ECharts 漏斗等"）

| 图表 | 类型 | 数据来源 | 备注 |
|---|---|---|---|
| `ProjectCard` 项目进度环形 | Pie（radial），100px | `ProjectStore.projects[].progress.completedRate`（`02-core §2.4`） | 中心文字显示完成率百分比 |
| 进度总览：需求交付漏斗 | Funnel | `OverviewPage` 自组合：`byStatus`（pool→reviewing→accepted→done，`rejected` 计入通知区）；`05-server §2.3 overview.totals.requirements.byStatus` | 理由：plan 漏斗 = 需求交付链，各需求状态即漏斗阶段 |
| 项目进度总览：任务趋势折线 | Line | 按"天"聚合 done 任务数（近 14 天）；来源 `TasksStore`（SSE 更新） | 小类 "趋势"（plan §6 进度总览含趋势） |
| 项目进度总览：任务状态分布 | Pie（饼） | `TasksStore.items` 按 status 统计 | 无强制要求，作为补充 |
| 逾期分布（可选） | Bar | `Stats.tasks.overdue` 按天（今日逾期/近 3 天） | 可选，保持轻量 |

- 版本：`e8e`（v4.4+ 当前），**按需引入**（plan §2）。
- 主题：ECharts 实例注册主题函数 `applyTheme()`（§7.6）。
- 理由：全部图表数据来自 `02-core deriveStats`（§2.4）与 stores 中的 `mtimeMs`/SSE；纯前端组合计算，无额外后端接口。

---

## 8. SCSS 7-1 架构（`00-plan-final §6`, `00-plan-final §7`）

```
apps/web/src/styles/
├── abstracts/      # _variables.scss, _mixins.scss, _functions.scss（CSS 变量清单见 §7.6）
├── base/           # _reset.scss, _typography.scss, _global.scss, _animations.scss（fade/slide/board 拖拽动画）
├── components/     # _badge.scss, _card.scss, _column.scss, _modal.scss, _toast.scss, _search.scss, _form.scss, _echarts.scss
├── layout/         # _header.scss, _sidebar.scss, _main.scss, _footer.scss
├── pages/          # _home.scss, _project.scss, _detail.scss
└── themes/         # _light.scss, _dark.scss（:root 正向 / [data-theme=dark] 变体变量）
```

- BEM 命名：块名以 `pm-` 前缀（如 `pm-project-card`），元素用 `__`（`pm-project-card__name`），修饰符用 `--`（`pm-project-card--archived`）。
- SCSS 风格：嵌套但分解清晰（Nesting 开启 `--parent` 默认），不黑箱（避免 `>` 与深层嵌套 > 4 层）；组件文件同名 SCSS。
- 运动：拖拽卡片有 `--dragging` 缩放/阴影，放置时卡片落位 0.2s 过渡（`base/_animations.scss`）。

---

## 9. 亮暗主题实现（plan §6）

### 9.1 CSS 变量清单（`:root` 定义 + `[data-theme=dark]` 覆盖）

```scss
:root {
  /* 01-数据规范（02-core §9 相关）？否——组件层变量 */
  --pm-bg-primary: #FFFFFF;          // 页面背景（HomePage/ProjectPage）
  --pm-bg-secondary: #F7F8FA;        // 卡片/面板背景（ProjectHeader、StatusBadge 背景）
  --pm-bg-tertiary: #EEF1F6;         // 输入框背景、分栏内背景
  --pm-text-primary: #1F2329;        // 正文文本（主文本）
  --pm-text-secondary: #646A73;      // 描述文本、注释、次级按钮文本
  --pm-text-tertiary: #8691A2;       // placeholder、禁用文本
  --pm-border: rgba(0, 0, 0, 0.08);  // 边框、分割线
  --pm-shadow: 0 1px 3px rgba(0, 0, 0, 0.08), 0 2px 6px rgba(0, 0, 0, 0.04);
  --pm-shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.12);

  // 状态色语义（§10）
  --pm-status-active: #3B82F6;       // 项目 active 徽标（蓝）
  --pm-status-paused: #A16207;       // paused（琥珀）
  --pm-status-done: #16A34A;         // done（绿）
  --pm-status-archived: #6B7280;     // archived（灰）
  --pm-status-pool: #F59E0B;         // 需求 pool（琥珀）
  --pm-status-reviewing: #F97316;    // reviewing（橙）
  --pm-status-accepted: #3B82F6;     // accepted（蓝）
  --pm-status-rejected: #A16207;     // rejected（琥珀）
  --pm-status-todo: #94A3B8;         // 任务 todo（灰）
  --pm-status-doing: #3B82F6;        // doing（蓝）
  --pm-status-cancelled: #64748B;    // cancelled（深灰）
  --pm-status-overdue: #EF4444;      // 逾期红
  --pm-progress-done: #16A34A;       // 进度条完成色
  --pm-progress-rest: #E5E7EB;       // 进度条剩余色

  --pm-accent: #3B82F6;              // 选中、高亮、页头色
  --pm-radius-sm: 4px;
  --pm-radius: 8px;
  --pm-radius-lg: 16px;
  --pm-duration: 0.18s;
  --pm-easing: cubic-bezier(0.4, 0, 0.2, 1);
}

[data-theme="dark"] {
  --pm-bg-primary: #0D1117;
  --pm-bg-secondary: #161B22;
  --pm-bg-tertiary: #21262D;
  --pm-text-primary: #E6EDF3;
  --pm-text-secondary: #9BA3AF;
  --pm-text-tertiary: #6E7682;
  --pm-border: rgba(255, 255, 255, 0.12);
  --pm-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  --pm-shadow-lg: 0 10px 32px rgba(0, 0, 0, 0.5);
  // 状态色（稍亮适配深色，见下）
  --pm-status-active: #58A6FF;       // GitHub-style light blue on dark
  --pm-status-paused: #D29922;
  --pm-status-done: #3FB950;
  --pm-status-archived: #8B949E;
  --pm-status-pool: #E3B341;
  --pm-status-reviewing: #FF8C3E;
  --pm-status-accepted: #58A6FF;
  --pm-status-rejected: #D29922;
  --pm-status-todo: #8B949E;
  --pm-status-doing: #58A6FF;
  --pm-status-cancelled: #A9B1BD;
  --pm-status-overdue: #F85149;
  --pm-progress-done: #3FB950;
  --pm-progress-rest: #30363D;
}
```

- **启动初始化**：`document.documentElement.setAttribute("data-theme", localStorage.getItem("pm-theme") ?? "light")`，允许 `prefers-color-scheme` 默认（`auto` 时 = 按系统日程切换；详见 plan "亮暗主题"）。
- **ECharts 变量注入**：`applyTheme()`（`apps/web/src/utils/echartsTheme.ts`）— 组件初始化前注册一次；`ThemeStore.watch()` 调用。

### 9.2 状态/优先级语义色由 CSS 变量管理（plan §6）

- `StatusBadge.vue`：`background: var(--pm-status-X); color: var(--pm-text-tertiary)`（见上表）；
- `PriorityDot.vue`：`--pm-priority-P0..P3`（P0:#EF4444, P1:#F97316, P2:#F59E0B, P3:#A16207）；
- 逾期：文本/徽标使用 `--pm-status-overdue`；进度环 `done` 用 `--pm-progress-done`。

---

## 10. 状态/优先级视觉映射（§9.2）

| 枚举 | 状态色 | 优先级色（待 §9.1 添加） |
|---|---|---|
| 项目：active/paused/done/archived | `--pm-status-active`(蓝) / `--pm-status-paused`(琥珀) / `--pm-status-done`(绿) / `--pm-status-archived`(灰) | — |
| 需求：pool/reviewing/accepted/rejected/done | 琥珀/橙/蓝/琥珀/绿 | — |
| 任务：todo/doing/done/cancelled | 灰/蓝/绿/深灰 | P0(红) P1(橙) P2(琥珀) P3(琥珀-深) |

> **理由**：`StatusBadge.vue`/`PriorityDot.vue` 是唯一调用变量点（`06-web §8`）；枚举→变量映射表集中放在 `06-web §10`。

---

## 11. Web-专属交互细节（跨文档交叉）

| 项 | 约定 | 参考 |
|---|---|---|
| 拖拽冲突时的"继续" | 失败 rollback + 冲突提示弹 + 手动刷新 | `06-web §3.1–§3.2` |
| 拖拽后文件（Obsidian 已改）推送 | SSE → store.refresh（覆盖本地，后端为真值） | `05-server §5.3`, `06-web §5` |
| 任务列表筛选 | 状态（多选）/ 优先级（多选）/ 项目 / 搜索文本 / 排序（状态-排序：优先级倒序>deadline 升序>updated 倒序） | `06-web §2.2` |
| 任务列表排序（默认） | 优先级倒序 + 截止日期升序（未定：根据 statuses 顺序再按 created 倒序） | — |
| 离线降级 | EventSource 实时时；断线后 3× 重连，失败 → 全局轮询 15s | `06-web §5` |
| 点击徽标/卡片 | 打开详情模态/详情页路由（`/p/:slug` 的 `RequirementDetailModal`/`TaskDetailModal`） | `06-web §3.3` |
| 新建/编辑表单 | 表单校验联动到需求前端（格式、非空）+ 与用户交互；服务端再校验（`05-server §2-3`） | `06-web §3.4` |
| "待修复清单"展示 | 项目首页/overview 顶部 Alert（黄）：文件 + 字段 + 解决建议（跳转 `pm validate` 详情页——CLI 不开，改为展示问题详情） | `01-数据规范 §4`, `02-core §3.2` |

> **理由**：这些约定让前端行为确定，避免实现者自由发挥；重点保证"前端只改已授权权限范围，后端为唯一真值"。

---

## 12. 实施注 | 近期变更记录 | 风险与对策（open-questions.md 可更新）

| 项 | 说明 |
|---|---|
| 要点 6.1 | 需求池四栏 = Pool / Reviewing / Accepted / Done+Rejected（第 4 列合并 Done 与 Rejected）——把"Done+Rejected"拆为 Done+Rejected 列组合 |
| 要点 7.1 | ECharts 图表列表 + 数据来源（derived from stores/API），纯前端组合 |
| 要点 6.3 | 任务详情面板（`GET /api/tasks/:id`）——待 open-questions 决议（§12.4） |
| 要点 2.4 | `/p/:slug/detail` 路由（§12.5） |
| 要点 3.4 | 任务列表默认排序规则（§12.6） |

### 风险与对策

| 风险 | 对策 |
|---|---|
| 看板拖拽长时间挂起网络 → 状态被 Obsidian 端改动后覆盖前端本地状态 | 依赖 SSE 收敛（`05-server §5.3`）+ refresh 模型；UI 不对拖拽状态做"去乐观化" |
| 409 冲突循环（两人同时拖同一任务） | `05-server §6.2` 写锁 + 提示"刷新重试"（前端自动+手动重试上限 2 次后提示刷新） |
| 状态聚合缓存（Vue 新鲜数据流） | 使用 `ref/computed` + stores 的 `refresh()` 拉取；不用动态 require |
