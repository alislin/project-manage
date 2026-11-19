# 修复应答（第 1 轮审核）

> 依据：`docs/design/review-issues.md`（审核意见：R-101~R-122，共 22 条）。
> 说明：每条记录包含修复说明（做了什么）与改动位置（文件#节）。对应的 open-questions 裁决结果见 `docs/design/open-questions.md`。

| R-ID | 修复说明 | 改动位置（文件#节） |
|---|---|---|
| R-101 | inbox 默认 slug 统一为合法值 `inbox`，使编号正则、Zod、文档示例三处表达一致（`INBOX-inbox-001`，正则 `^INBOX-[A-Za-z0-9一-鿿]+-\d{3}$` 与 `ZInboxEntry.slug` default `"inbox"` 互补） | `01-数据规范.md` §1.4、§1.5、§7.6；`03-cli.md` §7.2、§7.3、§7.5、§9.2；`07-workflow.md` §1 |
| R-102 | `pm new requirement --source` 默认改为非空值 `human`，与 `01-数据规范 §1.2 source` 必填非空语义一致；Web 表单标注 source 必填非空 | `03-cli.md` §3.2；`06-web.md` §3.4 |
| R-103 | `moveStatus` 在 core 层对 查找+校验+写入 加按路径串行锁（`moveLocks`，§4.7.1），锁内 `atomicWriteFile` 携带 `expectedMtimeMs` 复查冲突；Web 外部写锁（05-server §6.2）改为引用该内部锁 | `02-core.md` §4.7、§4.7.1；`05-server.md` §6.2 |
| R-104 | 补写 `TaskStats.onTrack` 语义（在时间线上未超期的任务数：todo/doing 且 due ≥ today），`Progress` 增加 `onTrack`；`pm stats --json`、`/api/projects`、overview 均输出 `onTrack` | `02-core.md` §2.4；`03-cli.md` §5.2；`05-server.md` §2.1、§2.3 |
| R-105 | 06-web §3.3 的"编辑"承诺收敛为只承诺 status 流转 PATCH（server 无字段编辑端点）；确认 §3.3 读取引用（05-server §3.4 `GET /api/tasks/:id`）无断链 | `06-web.md` §3.3 |
| R-106 | 编号正则统一为 `\d{3}`（三位序号语义与 `E_SEQ_EXHAUSTED` >999 耗尽一致），覆盖 01 §1.2/§1.3/§1.4、01 §5 Zod、05-server §3.2 | `01-数据规范.md` §1.2、§1.3、§1.4、§5；`05-server.md` §3.2 |
| R-107 | `pm new project --period` 默认改为 `[今天, 今天]`，与 `ZProject.period` 必填元组语义一致 | `03-cli.md` §3.1 |
| R-108 | 03-cli §2.3 示例改为 `validate` 可见的合法错误（`due: "2026-13-01"`）；明确悬空引用由 `pm check` 报告（`E_DANGLING_WIKI`），`validate` 不校验悬空 | `03-cli.md` §2.3 |
| R-109 | `validateAll` 纳入 `unnumbered` 文件校验（reason: unknown-type），报精确到 file+field | `02-core.md` §4.7 |
| R-110 | `POST /api/projects` 响应 `created` 补 `id`（= slug，`00-plan-final §4.2`） | `05-server.md` §2.2 |
| R-111 | 07-workflow §2.4 巡检 SOP 异常处理补 `E_CONFLICT`（刷新重试，Web §6.3；CLI 重跑 `pm move`）/ `E_IO`（重跑）路径 | `07-workflow.md` §2.4 |
| R-112 | 01 §1.2 status 行澄清：frontmatter 必填；创建端点/CLI/Web 默认 pool（05-server §2.5、03-cli §3.2、06-web §3.4） | `01-数据规范.md` §1.2 |
| R-113 | 02-core §4.4/§5.2 显式注明 `inbox/archive/` 排除规则（归档产物不进索引、不算 unnumbered） | `02-core.md` §4.4、§5.2 |
| R-114 | MCP `pm_create` 补 `status` 输入（project 默认 active；requirement 默认 pool；task 默认 todo），与 CLI `--status` 三端语义同源 | `04-mcp.md` §2.2 |
| R-115 | 02-core §3.2 Web 错误响应信封统一为 `{ ok: false, error: { code, message, file?, field?, issues? } }`（05-server §1.1/§6.4 约定） | `02-core.md` §3.2 |
| R-116 | 核对 07-workflow §3.3 交叉引用：当前落库文档中未出现指向 `02-core §3.4` 的引用（02-core 无 §3.4 节，最近的错误示例形状引用是 01-数据规范 §3.4）；§3.3 各引用（02-core §3.1、05-server §2.7/§3.3 等）均指向存在的节，与审核建议（03-cli §6.2/02-core §3.1）一致，无需改动 | `07-workflow.md` §3.3 |
| R-117 | 02-core §8 `today()` 备注引用修正为 `06-web §7`（任务趋势折线） | `02-core.md` §8 |
| R-118 | 05-server §3.1 看板分组引用修正为 `06-web §2.2`（任务看板列）；05-server §6.3 乐观更新策略引用补正为 `06-web §3.1`（拖拽流转乐观更新） | `05-server.md` §3.1、§6.3 |
| R-119 | 05-server §2.3 periods 漏斗引用修正为 `06-web §7`（进度总览：需求交付漏斗 ECharts funnel） | `05-server.md` §2.3 |
| R-120 | 02-core §2.4 overdue 备注引用修正为 `07-workflow.md` §1 日期约定 | `02-core.md` §2.4 |
| R-121 | 02-core §2.4 `TaskStats.onTrack` 补写语义（与 R-104 同节）：在时间线上未超期的任务数（todo/doing 且 due ≥ today，02-core §8 isPast/overdue） | `02-core.md` §2.4 |
| R-122 | 05-server §3.2 `ZNewTask.estimate` 加 `.refine(n > 0)`，与 01 §5 ZTask.estimate 一致 | `05-server.md` §3.2 |

---

# 修复应答（第 2 轮：R-201~R-203）

> 依据：`docs/design/review-issues.md`（新发现清单 R-201~R-203）。
> 说明：第 1 轮定案文档 `docs/design/decisions.md` 已含三接口契约总表、状态机流转表、错误码体系表；本轮修复为闭环其中"进度字段三端同语义"（R-201/R-202）与"分类规则引用正确性"（R-203）。

| ID | 修复说明 | 改动位置（文件#节） |
|---|---|---|
| R-201 | 03-cli §5.2 progress 字段列表补 `onTrack`（= 02-core §2.4 Progress.onTrack：todo/doing 且 due ≥ today），闭环 R-104 "pm stats --json 输出 onTrack" 的表达 | `03-cli.md` §5.2 |
| R-202 | 04-mcp §2.4 `progress`（properties + required）与 `totals.tasks`（properties + required）补 `onTrack`（与 02-core §2.4 Progress/TaskStats.onTrack 同语义），三端（CLI/MCP/REST）同语义统一 | `04-mcp.md` §2.4 |
| R-203 | 02-core §3.1 `E_UNKNOWN_TYPE` 引用从 `02-core §5.4`（实为 `reindexFile`）修正为 `02-core §4.4`（分类规则在 §4.4） | `02-core.md` §3.1 |
