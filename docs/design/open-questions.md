# open-questions · 待确认问题清单

> 格式：`| Q-ID | 问题描述 | 影响范围 | 你的建议方案 | 裁决结果 |`
> 定义：plan `docs/00-plan-final.md` §1 声明——plan 已定案的内容（技术栈、字段、流转表等）不会出现在此处，只列 plan 未定或交给详设取舍的点。
> 每行均有可执行的建议方案（更改方式指向详设对应节）。

| Q-ID | 问题描述 | 影响范围 | 你的建议方案 | 裁决结果 |
|---|---|---|---|---|---|
| Q-01 | `requirement.status = accepted` 的触发者：代理自动接受 vs 人工接受 | 状态机流转谁可以触发、UI 显示、`01-数据规范 §3.2` 的合法性语义 | 当前：代理或人均可 `pm move` 触发（`01-数据规范 §3.2` 表中 accepting 行触发方为"agent 或人"）；若产品上更倾向仅人确认，可把触发方改为"仅人"并更新详设 | 已裁决：保持现状——`01-数据规范 §3.2` 触发方已定案为"agent 或人"，无需追加设计变更。 |
| Q-02 | `task.due` 的必填性：必填 vs 可选 | `01-数据规范 §1.3` 字段定义、`pm new task` scaffold 默认值、Web 表单必填性 | 当前：必填（scaffold 给 `today`，前端必填，`05-server §3.2` 在请求体校验）；若需要可选，改为 `due: date | null` 且更新后续编码方式 | 已裁决：保持必填（定案）；要可选需改 01/02-core/05-server 三处同步。 |
| Q-03 | inbox 条目编号前缀与 slug 来源 | `01-数据规范 §1.4`、`§1.5`、`pm inbox list/archive` 的输出 | 当前：`INBOX-<slug>-NNN`，slug 取 frontmatter `slug` 字段，默认 `_inbox`（因 inbox 条目与 project 无强关联，统一前缀更易混淆，理由见 `01-数据规范 §1.5`）；若产品更倾向全局编号（如 `INBOX--0001`），可改 | 已裁决：保持定案 `INBOX-<slug>-NNN`（slug 取 frontmatter），默认 slug 统一为 `inbox`（R-101 详设收敛，使 01 §1.4/§1.5/Zod 与编号正则一致）；若更倾向全局编号（如 `INBOX--0001`），可再改。 |
| Q-04 | 状态流转副作用 `updated` 的操作者/日志记录 | `01-数据规范 §3.1-3.3`、`02-core §3 services/status.ts` | 当前：仅维护 `updated=today`（`pm move` 默认操作者 = `Config.defaultAuthor`，非状态字段）；未来需记录"谁操作"（如 `updated_by`）可在 `01-数据规范 §1` 追加可选字段（非单写原则范围内，理由见 `01-数据规范 §4` 单写原则后） | 已裁决：暂不加可选字段（如 `updated_by`）。 |
| Q-05 | 409 冲突后前端行为 | `06-web §3.2` | 当前：提示"文件已被外部修改，是否刷新并重试？"（刷新+重试/取消，自动一次重试后提示）；若想要"保留本地、用乐观锁合并"，需 `05-server §6` 重写 | 已裁决：保持"刷新+重试一次"（06-web §3.2 已定案）。 |
| Q-06 | 需求/任务详情页面形式 | `06-web §2.4` 路由表、`§3.3` | 当前：为模态详情面板（`RequirementDetailModal`/`TaskDetailModal`，通过卡片点击打开）；若产品更喜欢独立 URL 路由（`/p/:slug/detail`），需调整 `06-web §2.1` 路由与导航 | 已裁决：保持模态（`RequirementDetailModal`/`TaskDetailModal`）。 |
| Q-07 | `derive-task` 的默认 due 日期 | `05-server §2.8`、`03-cli §3.3`、`04-mcp §2.2`（`requirement` 文档） | 当前：`due = today + 7 天`；若项目习惯更短/更长周期，可改为可配置（加入 `Config`）或接受 frontmatter `defaultDueDelta` | 已裁决：保持 today+7 天。 |
| Q-08 | SSE 心跳间隔 | `05-server §5.2` | 当前：`vault:ping` 每 15s 一次（连接保活）；阈值与真实需求（Vue 3 EventSource 实现）不同可单独调整 | 已裁决：保持 15s。 |
| Q-09 | 需求池折叠列"Done + Rejected"的展示 | `06-web §6.1` 四栏 | 当前：四列 = Pool / Reviewing / Accepted / Done+Rejected（第 4 列合并 Done 与 Rejected，Badge 区分）；若产品偏好单独的 Rejected 列（五列），可改为：`done` 单独列 + `rejected` 独立小列 | 已裁决：保持四列 Pool / Reviewing / Accepted / Done+Rejected。 |
| Q-10 | `pm check` 的自动修复能力 | `03-cli §6`、`07-workflow §2.4` | 当前：`pm check` 只读，`issues` 输出；所有 `dangling-wiki`/`id-conflict`/`date-inverted` 需人工处置（`03-cli §6.4-6.5`）；未来可加 `pm check --fix`（仅重复出现清晰的 dangling 等，需逐条确认） | 已裁决：保持只读。 |

> 补充说明：`01-数据规范 §4.2` 已留有两处"延后扩展"：`task.due`（当前必填）与 `requirement` 可空（若 plan 变为任务可以不关联需求，请改为 `[[REQ-...]] | null`），未列为 Q-02/Q-03 因已有设计取舍，若有异议请直接修改对应详设节。
