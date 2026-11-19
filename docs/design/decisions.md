# 功能定案记录（定案版本）

> 本文件与 `docs/00-plan-final.md`（顶层事实来源）及 `docs/design/01-数据规范.md` ~ `docs/design/07-workflow.md`（7 份设计文档）共同构成定案版本。
> 第 1 轮设计代理按 `docs/design/fix-responses.md`（第 1 轮）修复 R-101~R-122，第 2 轮复核（审核意见 R-101~R-122，全部 resolved，blocking=0）通过；
> 本定案记录为定案依据，供测试设计代理作为最高优先级依据，详设文档为主要补充支撑。
> 新发现 R-201/R-202/R-203（第 2 轮新发现清单）已闭环并记录于本文件末尾的关键定案清单。

---

## 一、关键定案清单（编号 / 决策内容 / 来源：00-plan定案或讨论定案 / 状态：双方确认）

| 编号 | 决策内容（定案结论） | 来源 | 状态 |
|---|---|---|---|
| R-101 | inbox 默认 slug 统一为合法值 `inbox`（`ZInboxEntry.slug` default `"inbox"`，id 正则 `^INBOX-[A-Za-z0-9一-鿿]+-\d{3}$` 与 `Slug` 正则互补；01-数据规范 §1.4/§1.5/Zod 三处表达一致） | 讨论定案 | 双方确认 |
| R-102 | `pm new requirement --source` 默认改为非空 `human`，与 `01-数据规范 §1.2 source` 必填非空语义一致（03-cli §3.2 明确默认非空） | 讨论定案 | 双方确认 |
| R-103 | `moveStatus`（02-core §4.7）在 core 层对查找+校验+写入加按路径串行锁（`moveLocks`，02-core §4.7.1），锁内 `atomicWriteFile` 携带 `expectedMtimeMs` 复查冲突；Web 外部写锁引用内部锁 | 讨论定案 | 双方确认 |
| R-104 | 补写 `TaskStats.onTrack` 语义（在时间线上未超期的任务数：todo/doing 且 due ≥ today，02-core §8 isPast/overdue），`Progress` 增加 `onTrack`；`pm stats --json`、`/api/projects`、overview 均输出 `onTrack` | 00-plan定案（详设收敛） | 双方确认 |
| R-105 | Web "编辑"承诺收敛为只承诺 status 流转 PATCH（server 无字段编辑端点）；05-server §3.4 `GET /api/tasks/:id` 存在，06-web §3.3 读取引用无断链 | 讨论定案 | 双方确认 |
| R-106 | 编号正则统一为 `\d{3}`（三位序号语义与 `E_SEQ_EXHAUSTED` >999 耗尽一致），覆盖 01 §1.2/§1.3/§1.4、01 §5 Zod、05-server §3.2 | 讨论定案 | 双方确认 |
| R-107 | `pm new project --period` 默认改为 `[今天, 今天]`，与 `ZProject.period` 必填元组语义一致 | 00-plan定案 | 双方确认 |
| R-108 | 03-cli §2.3 示例改为 `validate` 可见的合法错误（`E_VALIDATION`，`due: "2026-13-01"`）；明确悬空引用由 `pm check` 报告（`E_DANGLING_WIKI`），`validate` 不校验悬空 | 讨论定案 | 双方确认 |
| R-109 | `validateAll` 纳入 `unnumbered` 文件校验（reason: unknown-type），报精确到 file+field | 讨论定案 | 双方确认 |
| R-110 | `POST /api/projects` 响应 `created` 补 `id`（= slug，00-plan-final §4.2） | 00-plan定案 | 双方确认 |
| R-111 | 07-workflow §2.4 巡检 SOP 异常处理补 `E_CONFLICT`（刷新重试，Web §6.3；CLI 重跑 `pm move`）/ `E_IO`（重跑）路径 | 讨论定案 | 双方确认 |
| R-112 | 01 §1.2 status 行澄清：frontmatter 必填；创建端点/CLI/Web 默认 pool（05-server §2.5、03-cli §3.2、06-web §3.4） | 00-plan定案 | 双方确认 |
| R-113 | 02-core §4.4/§5.2 显式注明 `inbox/archive/` 排除规则（归档产物不进索引、不算 unnumbered） | 00-plan定案 | 双方确认 |
| R-114 | MCP `pm_create` 补 `status` 输入（project 默认 active；requirement 默认 pool；task 默认 todo），与 CLI `--status` 三端语义同源 | 00-plan定案 | 双方确认 |
| R-115 | 02-core §3.2 统一 Web 错误响应信封为 `{ ok: false, error: { code, message, file?, field?, issues? } }`（05-server §1.1/§6.4 约定） | 00-plan定案 | 双方确认 |
| R-116 | 核对 07-workflow §3.3 交叉引用：当前落库文档中无指向不存在节的引用（02-core §3.4 是错误形状示例节）；各引用均指向存在的节，无需改动 | 讨论定案 | 双方确认 |
| R-117 | 02-core §8 `today()` 备注引用修正为 `06-web §7`（任务趋势折线） | 00-plan定案 | 双方确认 |
| R-118 | 05-server §3.1 看板分组引用修正为 `06-web §2.2`（任务看板列）；05-server §6.3 乐观更新引用补正为 `06-web §3.1`（拖拽流转乐观更新） | 00-plan定案 | 双方确认 |
| R-119 | 05-server §2.3 periods 漏斗引用修正为 `06-web §7`（进度总览：需求交付漏斗） | 00-plan定案 | 双方确认 |
| R-120 | 02-core §2.4 overdue 备注引用修正为 `07-workflow.md` §1 日期约定 | 00-plan定案 | 双方确认 |
| R-121 | 02-core §2.4 `TaskStats.onTrack` 补写语义：在时间线上未超期的任务数（todo/doing 且 due ≥ today，02-core §8 isPast/overdue） | 00-plan定案 | 双方确认 |
| R-122 | 05-server §3.2 `ZNewTask.estimate` 加 `.refine(n > 0)`，与 01 §5 ZTask.estimate 一致 | 00-plan定案 | 双方确认 |
| R-201 | 03-cli §5.2 progress 字段列表补 `onTrack`（= 02-core §2.4 Progress.onTrack），闭环 R-104 的输出未闭环问题 | 讨论定案（第 2 轮新发现定案） | 双方确认 |
| R-202 | 04-mcp §2.4 `progress`（properties+required）与 `totals.tasks`（properties+required）补 `onTrack`（与 02-core §2.4 Progress/TaskStats.onTrack 同语义），三端（CLI/MCP/REST）同语义统一 | 讨论定案（第 2 轮新发现定案） | 双方确认 |
| R-203 | 02-core §3.1 `E_UNKNOWN_TYPE` 引用从 `02-core §5.4` 修正为 `02-core §4.4`（5.4 是 `reindexFile`，分类规则在 4.4） | 讨论定案（第 2 轮新发现定案） | 双方确认 |

---

## 二、三接口契约总表（CLI/MCP/REST 同语义映射）

> 三端同核同语义（00-plan §3），具体 schema 由对应详设节定义；语义映射表（以各节定义的共享类型为标准）：

| 操作（语义） | CLI（03-cli） | MCP（04-mcp） | REST（05-server） |
|---|---|---|---|
| 校验全部/指定文件 | `pm validate [files...] [--json]`（§2） | `pm_validate` | —（REST 无对应入口） |
| 新建项目 | `pm new project --name/--slug/--period/--tags/--status`（§3.1） | `pm_create(type=project)`（§2.1） | `POST /api/projects`（§2.2） |
| 新建需求 | `pm new requirement --slug/--title/--module/--source/--priority/--status`（§3.2） | `pm_create(type=requirement)`（§2.1） | `POST /api/projects/:slug/requirements`（§2.5） |
| 新建任务 | `pm new task --slug/--requirement/--title/--priority/--due/--status`（§3.3） | `pm_create(type=task)`（§2.1） | `POST /api/projects/:slug/tasks`（§3.2） |
| 状态流转 | `pm move <id> --status <new>`（§4） | `pm_move`（§2.3） | `PATCH /api/requirements/:id` / `PATCH /api/tasks/:id`（§2.7/§3.3） |
| 统计聚合 | `pm stats --json` ≡ `Stats`（§5.2） | `pm_stats`（§2.4） | `GET /api/projects`（含统计，§2.1）+ `GET /api/projects/:slug/overview`（§2.3） |
| 一致性检查 | `pm check [--json]`（§6） | `pm_check`（§2.5） | —（REST 无对应入口） |
| 需求详情 | — | — | `GET /api/projects/:slug/requirements`（§2.4） / `GET /api/requirements/:id`（§2.6） |
| 任务详情 | — | — | `GET /api/projects/:slug/tasks`（§3.1） / `GET /api/tasks/:id`（§3.4） |
| 派生任务 | — | `pm_create(type=task, requirement=[[REQ-...]])`（04-mcp §2.1） | `POST /api/requirements/:id/derive-task`（§2.8） | 派生语义：需求 accepted 后由 agent 派生（00-plan §4.3） |
| 检索 | — | — | `GET /api/search?q=`（§4.1） |
| 实时推送 | — | — | `GET /api/events`（SSE，§5） |

> **语义同源说明**：三端共用 `@pm/core` 的 `VaultIndex`/`Stats`/`MoveResult`/`ValidateResult`（02-core §2），结构字段唯一真源；状态流转同源于 01-数据规范 §3 状态机；错误码同源于 02-core §3.1（HTTP 映射表：05-server §1.2/§6.5）。

---

## 三、需求与任务状态机流转表（定案，来源：01-数据规范 §3）

### 3.1 requirement 流转表（01-数据规范 §3.2）

| 流转 | 合法性 | 触发方 | 流转副作用 |
|---|---|---|---|
| pool → reviewing | 合法 | agent（提交整理完成） | `updated=<今天>` |
| pool → rejected | 合法（直接拒绝） | agent | `updated=<今天>` |
| pool → done | 非法 | — | — |
| reviewing → accepted | 合法（接受） | agent 或人 | `updated=<今天>` |
| reviewing → rejected | 合法 | agent | `updated=<今天>` |
| reviewing → done | 非法 | — | — |
| accepted → done | 合法（接受后派发/完成） | agent | `updated=<今天>` |
| accepted → reviewing | 非法 | — | — |
| accepted → rejected | 非法 | — | — |
| rejected → pool | 合法（退回重塑） | agent/人 | `updated=<今天>` |
| rejected → reviewing / done | 非法 | — | — |
| done → * | 非法（done 终态） | — | — |

### 3.2 task 流转表（01-数据规范 §3.3）

| 流转 | 合法性 | 触发方 | 流转副作用 |
|---|---|---|---|
| todo → doing | 合法（开始） | agent/人 | `updated=<今天>` |
| todo → done | 合法（补签完成） | agent/人 | `updated=<今天>`，`completed=<今天>` |
| todo → cancelled | 合法（取消） | agent/人 | `updated=<今天>` |
| doing → done | 合法（完成） | agent/人 | `updated=<今天>`，`completed=<今天>` |
| doing → cancelled | 合法（取消） | agent/人 | `updated=<今天>` |
| doing → todo | 非法（回退不允许） | — | — |
| done → * | 非法（done 终态） | — | — |

### 3.3 project 流转表（01-数据规范 §3.1）

> 说明：项目同样为定案状态机；创建入口：03-cli `pm new project`（§3.1）、REST `POST /api/projects`（05-server §2.2），默认 active（05-server §2.2）。

| 流转 | 合法性 | 触发方 | 流转副作用 |
|---|---|---|---|
| active → paused | 合法 | agent | `updated=<今天>` |
| paused → active | 合法 | agent | `updated=<今天>` |
| active → done | 合法 | agent | `updated=<今天>` |
| active → archived | 合法 | agent | `updated=<今天>` |
| done → archived | 合法 | agent | `updated=<今天>` |
| paused → done | 非法 | — | — |
| done → active / done → paused | 非法 | — | — （done 为终态） |
| archived → * | 非法 | — | — |

---

## 四、统一错误码体系表（定案，来源：02-core §3.1 / 05-server §6.5 / 03-cli §1.3）

| 错误码 | 语义 | HTTP 状态 | CLI 退出码 | 生成点 |
|---|---|---|---|---|
| `E_CONFIG_INVALID` | 配置缺失/非法（`pm.config.json`） | 500 | 2 | 全局（所有，03-cli §1.3/02-core §3.1） |
| `E_USAGE` | 参数/用法错误（未知命令、缺必填参数、参数取值非法） | 400 | 2 | `pm move` 无 `--status`；CLI 层校验；POST 缺必填（05-server §1.2） |
| `E_NOT_FOUND` | 引用的 id/文件/项目不存在 | 404 | 1 | `pm move REQ-x-999` 找不到文件；`GET /api/.../x` 404（02-core §3.1） |
| `E_VALIDATION` | frontmatter/Zod 校验失败（精确到 file+field） | 422 | 4 | `pm validate`、接口 PATCH 校验失败（02-core §3.1） |
| `E_INVALID_TRANSITION` | 非法状态流转 | 409 | 4 | `pm move doing → todo`；`PATCH /api/requirements/:id`（03） |
| `E_CONFLICT` | mtime 写冲突（外部并发修改） | 409 | 3 | `atomicWriteFile` 检测到外部修改；`PUT/PATCH` 并发（02-core §3.1；05-server §6.1-6.4） |
| `E_SEQ_EXHAUSTED` | 编号池耗尽（>999） | 409 | 5 | `allocateId` 池用尽（02-core §3.1；01-数据规范 §1.5） |
| `E_DANGLING_WIKI` | 悬空 wiki-link（`pm check` 报告） | —（check 以 issues 见下） | 2（check 非空 issues） | 链接目标不存在或跨项目（01-数据规范 §6.2；03-cli §2.2/§6.2） |
| `E_IO` | 其它文件 IO 错误（权限/磁盘） | 500 | 1 | scan/write IO 失败（02-core §3.1；05-server §6.5） |
| `E_UNKNOWN_TYPE` | 文件不可识别（`unnumbered`，分类规则 + 降级） | —（check 以 issues 见下） | 2（check 非空 issues） | 无法识别类型的 md 文件（02-core §4.4；01-数据规范 §7.5） |

---

## 五、R-101/R-103/R-105 收敛结论

### 5.1 R-101：inbox 默认 slug 收敛

- 收敛结果：inbox 默认 slug 统一为合法值 `inbox`；编号 id 格式 `INBOX-<slug>-NNN`。
- 三处一致：01-数据规范 §1.4（示例 `INBOX-inbox-001`）、§1.5（前缀表：slug 取 frontmatter，默认 `inbox`）、Zod（`ZInboxEntry.slug` default `"inbox"`，id 正则 `^INBOX-[A-Za-z0-9一-鿿]+-\d{3}$` 与 `Slug` 正则 `^[A-Za-z0-9一-鿿]+(-[A-Za-z0-9一-鿿]+)*$` 互补）。
- 第 2 轮复核已验证：默认条目 `INBOX-inbox-001` 可通过 Zod 校验。

### 5.2 R-103：CLI/MCP/Web 三端状态流转收敛

- 收敛结果：`moveStatus`（02-core §4.7）为三端统一状态流转入口。
- Web（05-server §6.2）改为引用内部锁（`moveLocks`，02-core §4.7.1）与外部写锁共同串行；CLI 与 MCP 经 `moveStatus` 走 `moveLocks`，无再裸写；锁内 `atomicWriteFile` 携带 `expectedMtimeMs`，冲突返回 `E_CONFLICT`（409），调用方刷新重试。
- 第 2 轮复核已验证：02-core §4.7.1 新增 `moveLocks` + `expectedMtimeMs` 复查。

### 5.3 R-105：Web 字段编辑承诺收敛

- 收敛结果：06-web §3.3/§3.4 编辑承诺收敛为 status 流转 PATCH（`PATCH /api/requirements/:id` / `PATCH /api/tasks/:id`，无字段编辑类端点）。
- 第 2 轮复核已验证：05-server §3.4 `GET /api/tasks/:id` 存在，06-web §3.3/§3.4 引用（`05-server §2.6`/`§3.4`）无断链。

---

## 六、Q-01~Q-10 裁决结果（来源：docs/design/open-questions.md，状态：双方确认）

> 裁决结果与 open-questions.md 表逐行一致（Q-01~Q-10 的"已裁决"行落在该文件）；本表复制作为定案版本一部分：

| Q-ID | 裁决结果（简述） |
|---|---|
| Q-01 | `requirement.status = accepted` 触发者保持现状：`01-数据规范 §3.2` 表中 accepting 行触发方为"agent 或人"，无需追加设计变更 |
| Q-02 | `task.due` 必填保持（定案）；要可选需改 01/02-core/05-server 三处同步 |
| Q-03 | inbox 编号保持定案 `INBOX-<slug>-NNN`（slug 取 frontmatter，默认 `inbox`），R-101 详设收敛；要全局编号可再改 |
| Q-04 | 状态流转副作用 `updated` 只维护 `updated=today`，不加 `updated_by` 等可选字段 |
| Q-05 | 前端 409 冲突行为保持"刷新+重试一次"（06-web §3.2 已定案） |
| Q-06 | 需求/任务详情页面保持模态（`RequirementDetailModal`/`TaskDetailModal`） |
| Q-07 | 需求/任务派生任务默认 due 保持 `today + 7 天` |
| Q-08 | SSE 心跳间隔保持 15s（`vault:ping`） |
| Q-09 | 需求池折叠列"Done + Rejected"保持四列（Pool / Reviewing / Accepted / Done+Rejected） |
| Q-10 | `pm check` 保持只读，不做 `pm check --fix` |

---

## 七、双方确认

- 第 1 轮审核：22 条（blocking 3、major 7、minor 12）均已 resolved，阻塞项清零，**审核通过，可定案**。
- 第 2 轮复核：逐条对照 fix-responses.md 与修订后设计文档验证改动位置，22 条全部 resolved，blocking=0。
- 第 2 轮新发现：R-201（03-cli §5.2 progress 补 onTrack）、R-202（04-mcp §2.4 progress 与 totals.tasks 补 onTrack）、R-203（02-core §3.1 E_UNKNOWN_TYPE 引用修正 §5.4→§4.4）——已新增定案并由 fix-responses.md 第 2 轮修复小节记录（`docs/design/fix-responses.md`）。

定案文档到此为止；详设文档（01-数据规范~07-workflow）仍为主体实现依据，本文为最高优先级定案汇总供测试设计代理核对。
