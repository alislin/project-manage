# 审核意见（第 2 轮）

> 审核对象：`docs/00-plan-final.md` 定案 + `docs/design/01-数据规范.md` ~ `07-workflow.md` 修订后设计文档（第 1 轮设计代理已按 `fix-responses.md` 修复 R-101~R-122）。
> 审核代理：PM 台账审核代理。本文仅产出，不修改任何设计文档。
> 严重级定义（任务书）：blocking=不修就不能开工；major=不修会留隐患；minor=表达优化、补充示例。

## 结论摘要

- 第 1 轮共 22 条问题（blocking 3、major 7、minor 12）。第 2 轮逐条对照 `fix-responses.md` 与修订设计文档，**验证了改动位置而非仅看声明**。
- 结论：**22 条均 resolved**。阻塞项（R-101 下划线正则矛盾、R-102 `pm new requirement` 默认产生不合法文件、R-103 CLI/MCP 并发流转缺串行化）均已修复验证。
- 新发现：3 条 minor（R-201、R-202、R-203，见文末新发现清单）。
- 结论判定：阻塞项清零 → **审核通过，可定案**。

## 问题清单（第 1 轮原清单 + 原状）

| ID | 严重级 | 维度 | 位置(文件#节) | 问题描述 | 建议修复 |
|---|---|---|---|---|---|
| R-101 | blocking | 数据一致性 | 01-数据规范.md#编号分配规则 + 01-数据规范.md#Zodschema | inbox 默认编号与正则矛盾：默认 slug 为 `_inbox`、示例 id 为 `INBOX-_inbox-001`（01-数据规范.md#1-4、§1.5、07-workflow.md#1）均含下划线，但 `ZInboxEntry.id` 正则 `^INBOX-[A-Za-z0-9一-鿿]+-\d{3,}$` 与 `Slug` 正则 `^[A-Za-z0-9一-鿿]+(-[A-Za-z0-9一-鿿]+)*$`（01-数据规范.md#Zodschema）均禁止下划线，默认创建的 inbox 条目必然无法通过 Zod 校验 | 扩展 `Slug` 正则允许 `_`，或把默认 slug 改为合法值（如 `inbox`）并同步编号正则，使 01 §1.4、§1.5、Zod 三处表达一致 |
| R-102 | blocking | 接口契约一致性 | 03-cli.md#3-2（`pm new requirement`） vs 01-数据规范.md#Zodschema | `pm new requirement --source` 默认 `""`（03-cli §3.2）与 Zod（`source: z.string().min(1)` 必填非空）直接矛盾：脚手架默认路径会产生不合法 frontmatter，`pm validate` 必报 E_VALIDATION | 改为默认非空值（如 `human`），或要求 `--source` 必填，三端语义同步 |
| R-103 | blocking | 状态机完备性 | 02-core.md#4-7 + 05-server.md#6-2 | CLI/MCP 的 `pm move` 状态流转缺串行化：Web 侧由 per-path 写锁（05-server §6.2）保护，但 CLI/MCP 路径无锁、无 `expectedMtimeMs` 复查，两次并发 `pm move` 都读到同源状态并通过合法性校验后后写覆盖前写（lost update） | 在 `moveStatus` 对查找+校验+写入加锁；或给 `pm move` 传 `expectedMtimeMs` 并重试 |
| R-104 | major | 接口契约一致性 | 02-core.md#2-4 vs 03-cli.md#5-2、05-server.md#2-1 | `TaskStats.onTrack` 在 02-core.md#2-4 定义（无语义注释），但 `pm stats --json`（03-cli §5.2）与 `/api/projects`、`overview.tasks`（05-server §2.1/§2.3）均不输出该字段，三处表达矛盾 | 统一：加入 stats JSON 与 overview（或从 02-core 删除并澄清） |
| R-105 | major | 接口契约一致性 | 06-web.md#3-3、06-web.md#3-4、05-server.md#3-4 | 06-web §3.3 引用"05-server §3.5"（05-server 无此节，实为 §3.4 `GET /api/tasks/:id`）；同时 06-web §3.3/§3.4 承诺编辑 priority/title/due/estimate（05-server 仅提供 `PATCH /api/tasks/:id`/`PATCH /api/requirements/:id` 状态流转，无字段编辑类端点，Web 更新路径有后端支撑缺口） | 修正引用为 `05-server §3.4`；补建任务/需求字段编辑端点（或删除 Web 编辑承诺） |
| R-106 | major | 数据一致性 | 01-数据规范.md#编号分配规则 + 01-数据规范.md#Zodschema + 07-workflow.md#1 | 编号正则 `\d{3,}`（01-数据规范.md §1.2、§5 Zod）与"三位序号"/`E_SEQ_EXHAUSTED`（>999）矛盾：4+ 位 id 可通过校验却永不产生 | 改为 `\d{3}`，使三位与耗尽语义一致 |
| R-107 | major | 数据一致性 | 03-cli.md#3-1 vs 01-数据规范.md#Zodschema | `pm new project --period` 默认"今天..∞"（03-cli §3.1），但 `ZProject.period` 为必填 tuple of `IsoDate`（`YYYY-MM-DD`），∞ 无法落盘且省略 `--period` 会产生必填校验失败 | 默认 `[today, today]` 或要求显式 `--period` 并在文档标注 |
| R-108 | major | 状态机完备性 | 03-cli.md#2-3 vs 01-数据规范.md#wiki-link关联与反链聚合规则6-2 | 03-cli §2.3 示例把悬空 requirement 报为 validate 的 `E_VALIDATION`，与 01 §6.2（"仅 pm check 报告，frontmatter 本身 Zod 通过，以便聚合忽略悬空"）矛盾 | 示例改为 check 的 dangling（`E_DANGLING_WIKI`），或在 validate 输出注明不校验 dangling |
| R-109 | major | 状态机完备性 | 02-core.md#4-7 vs 01-数据规范.md#数据规范7-5 | 01 §7.5 要求 `pm validate` 对 unnumbered 文件报 `E_VALIDATION`（精确到 file+field），但 02-core `validateAll` 未包含 unnumbered 的检查 | `validateAll` 纳入 unnumbered（reason: unknown-type） |
| R-110 | major | 接口契约一致性 | 05-server.md#2-2 vs 03-cli.md#3-1、04-mcp.md#2-2 | POST /api/projects 响应 `created` 缺 `id`（CLI §3.1、MCP §2.2 均有 id） | 补 `id` |
| R-111 | minor | 代理可用性 | 07-workflow.md#2-4 | 台账巡检 SOP 无写冲突/IO 自纠路径（03-cli §6.2 清单无 `E_CONFLICT`/`E_IO` 项），代理对运行期错误的自纠指引不完整 | 改为对 `E_CONFLICT`/`E_IO` 给出：刷新重试（Web §6.3）/ 再跑 `pm move`（CLI 3/1） |
| R-112 | minor | 数据一致性 | 01-数据规范.md#1-2 vs 05-server.md#3-2 | requirement.status：01 §1.2 表格写"必填（默认 pool）"，但 Zod 必填、05-server §2.5 新建默认 pool，语义口径略异 | 澄清 frontmatter 必填，创建端点默认 pool |
| R-113 | minor | Obsidian兼容性 | 01-数据规范.md#数据规范7-2 + 02-core.md#4-4、02-core.md#5-2 | inbox/archive 归档产物（§7.4）应不进入索引（§7.5），但 02-core scanner/classifyFile 未提及排除 inbox/archive/，实现者会需要推断 | 02-core §4.4/§5.2 显式注明排除规则 |
| R-114 | minor | 接口契约一致性 | 04-mcp.md#2-2 vs 03-cli.md#3-2、03-cli.md#3-3 | `pm_create` 无 `status` 输入（CLI 有 `--status`：需求默认 pool、任务默认 todo） | 加入可选 status 字段 |
| R-115 | minor | 接口契约一致性 | 02-core.md#3-2 vs 05-server.md#1-1 | 02-core §3.2 说 Web 错误响应扁平 `{code,message,file?...}`，但 05-server §1.1 统一信封为 `{ok, data?, error?}`（§6.4 409 body 也为嵌套 error） | 统一 Web 信封，修 02-core 或 05-server 一侧 |
| R-116 | minor | 代理可用性 | 07-workflow.md#3-3 | 断链引用："02-core §3.4"（02-core 无此节，应为 03-cli §6.2/02-core §3.1） | 修正引用 |
| R-117 | minor | 代理可用性 | 02-core.md#2-8 | 引用"06-web §7.4"（06-web §7 是 ECharts 清单，无 §7.4 节） | 改为 06-web §7（漏斗表）或删除 |
| R-118 | minor | 接口契约一致性 | 05-server.md#3-1 | 引用"06-web §7.2"（06-web §7 是 ECharts 清单，无 §7.2 节） | 修正为 06-web §3.1 或删除 |
| R-119 | minor | 接口契约一致性 | 05-server.md#2-3 | 引用"06-web §7.4.3"（不存在） | 改为 06-web §7.1（漏斗） |
| R-120 | minor | 代理可用性 | 02-core.md#2-4 | overdue 定义引用 02-core §7.4（02-core 无此节） | 改为 07-workflow.md#1 日期约定 |
| R-121 | minor | 可测试性 | 02-core.md#2-4 | `TaskStats.onTrack` 无定义（只有类型定义，语义缺失） | 补写 onTrack 语义（如 in-progress 任务数） |
| R-122 | minor | 接口契约一致性 | 05-server.md#3-2 vs 01-数据规范.md#Zodschema | 05-server §3.2 `ZNewTask.estimate` 为 `z.number().optional()`（允许 ≤0），但 01 §5 `ZTask.estimate` 有 `n > 0` 约束 | 加入 `.refine(n > 0)` |

## 第 2 轮复核详情（R-101~R-122 逐条核对结论）

- **R-101**（resolved）：改动位置已验证——01 §1.4 示例 id 为 `INBOX-inbox-001`、§1.5 前缀表记入名"slug 取 frontmatter，默认 `inbox`"、§7.6 一并收敛；03-cli §7.2/§7.3/§7.5/§9.2 示例全部改用 `INBOX-inbox-001`；07-workflow §1 表格写法改为"slug 自 frontmatter，默认 `inbox`"。Zod 三处一致：`ZInboxEntry.slug` default `"inbox"`（01 §5），id 正则 `^INBOX-[A-Za-z0-9一-鿿]+-\d{3}$`（01 §5）与 `Slug` 正则互补，默认条目 `INBOX-inbox-001` 可通过校验。
- **R-102**（resolved）：改动位置已验证——03-cli §3.2 第 `--source` 行默认 `human` 且说明非空引用 01 §1.2；01 §1.2 `source` 行"非空"；06-web §3.4 表单项文案声明 source 必填非空。脚手架默认路径现已产生合法 frontmatter（`pm validate` 无误报）。
- **R-103**（resolved）：改动位置已验证——02-core §4.7.1 新增 `moveLocks: Map<string, Promise<void>>` 按路径串行 find+isValidTransition+atomicWriteFile，锁内 `expectedMtimeMs` 复查返回 E_CONFLICT；02-core §4.7 注释"Web/CLI/MCP 三端统一经 `moveStatus`"；05-server §6.2 与 02-core §4.7.1"外部写锁共同串行"的表述配套。CLI 与 MCP 均经 `moveStatus`，三端无再裸写。
- **R-104**（resolved）：改动位置已验证——02-core §2.4 `TaskStats.onTrack` 语义注释（todo/doing 且 due ≥ today）+ `Progress.onTrack`（02-core §2.4）；03-cli §5.2 `totals.tasks` 含 `onTrack`（03-cli §5.2）；05-server §2.1 `progress.onTrack`、05-server §2.3 `overview.totals.tasks.onTrack` 均已输出。
- **R-105**（resolved）：改动位置已验证——06-web §3.3 编辑承诺已收敛为 status 流转 PATCH（仅承诺 `PATCH /api/requirements/:id`/`PATCH /api/tasks/:id`）；05-server §3.4 `GET /api/tasks/:id` 存在，06-web §3.3 读取引用"05-server §2.6"/"05-server §3.4"均无断链。
- **R-106**（resolved）：改动位置已验证——01 §1.2 `id` 正则 `^REQ-[A-Za-z0-9一-鿿]+-\d{3}$`、01 §1.3 `id` 正则 `^TASK-[A-Za-z0-9一-鿿]+-\d{3}$`、01 §1.4 inbox id 正则 `\d{3}`、01 §5 Zod（ZRequirement/ZTask/ZInboxEntry id 正则）、05-server §3.2 ZNewTask.requirement 正则均为 `\d{3}`；E_SEQ_EXHAUSTED >999（01 §1.5）与三位耗尽语义一致。
- **R-107**（resolved）：改动位置已验证——03-cli §3.1 `--period` 默认 `[今天, 今天]`；与 01 §1.3 ZTask.period 必填 tuple of IsoDate 语义一致。
- **R-108**（resolved）：改动位置已验证——03-cli §2.3 示例改用 `due: "2026-13-01"` 与 E_VALIDATION 对应；03-cli §2.2 注明 validate 不校验悬空；pm check 报 dangling（03-cli §6.2/§2.2、01-数据规范 §6.2）。
- **R-109**（resolved）：改动位置已验证——02-core §4.7 `validateAll` 纳入 `unnumbered`（reason: unknown-type，01-数据规范 §7.5），精确到 file+field。
- **R-110**（resolved）：改动位置已验证——05-server §2.2 201 响应 `created` 含 `id`（= slug）；03-cli §3.2、04-mcp §2.2 同源字段已存在。
- **R-111**（resolved）：改动位置已验证——07-workflow §2.4 异常处理补充 E_CONFLICT（Web §6.3 刷新重试）/ E_IO（重跑）。
- **R-112**（resolved）：改动位置已验证——01 §1.2 `status` 行解释：frontmatter 必填；创建端点/CLI/Web 默认 pool（05-server §2.5、03-cli §3.2、06-web §3.4）。
- **R-113**（resolved）：改动位置已验证——02-core §4.4 classifyFile inbox 规则显式"`inbox/archive/` 排除"；02-core §5.2 step 7 显式 archive 不入索引、不算 unnumbered。
- **R-114**（resolved）：改动位置已验证——04-mcp §2.2 pm_create 输入加入 `status`（各类型默认值：project active、requirement pool、task todo），语义指向 03-cli §3.1-3.3 与 01-数据规范 §3。
- **R-115**（resolved）：改动位置已验证——02-core §3.2 统一 Web 错误信封为 `{ ok: false, error: { code, message, file?, field?, issues? } }`（05-server §1.1/§6.4 约定）。
- **R-116**（resolved）：核对已通过——07-workflow §3.3 交叉引用全部指向存在节（无指向 02-core §3.4 的引用；引用如 02-core §3.1、05-server §2.7/§3.3 均合法），无需改动。
- **R-117**（resolved）：改动位置已验证——02-core §8 `today()` 备注改为 06-web §7（任务趋势折线）。
- **R-118**（resolved）：改动位置已验证——05-server §3.1 看板分组引用改为 06-web §2.2；05-server §6.3 乐观更新引用改为 06-web §3.1。
- **R-119**（resolved）：改动位置已验证——05-server §2.3 periods 漏斗引用改为 06-web §7（进度总览漏斗）。
- **R-120**（resolved）：改动位置已验证——02-core §2.4 overdue 备注改为 07-workflow §1 日期约定。
- **R-121**（resolved）：改动位置已验证——02-core §2.4 `TaskStats.onTrack` 语义补写（02-core §8 isPast/overdue）。
- **R-122**（resolved）：改动位置已验证——05-server §3.2 `ZNewTask.estimate` 加 `.refine(n > 0)`，与 01 §5 ZTask.estimate 一致。

open-questions 裁决结果：Q-01~Q-10 的"已裁决"行已落在 `open-questions.md`，与第 2 轮所见一致（如 Q-03 统一为 `INBOX-<slug>-NNN`、默认 slug `inbox`），无需新增裁决。

## 新发现（第 2 轮新增）

| ID | 严重级 | 维度 | 位置 | 发现描述 | 建议修复 |
|---|---|---|---|---|---|
| R-201 | minor | 接口契约一致性 | 03-cli.md §5.2 | `Stats` 类型（02-core §2.4）`Progress.onTrack` 已定义，`05-server §2.1/§2.3` 输出了，但 `pm stats --json`（03-cli §5.2）的 `projects[].progress` 字段列表缺少 `onTrack`——R-104"PM stats --json 输出 onTrack"的表达未闭环。 | 在 03-cli §5.2 progress 加入 `onTrack` |
| R-202 | minor | 接口契约一致性 | 04-mcp.md §2.4 | MCP 对应 `pm stats` 的 schema（§2.4）的 `progress` 与 `totals.tasks` 均未列 `onTrack`，但 02-core §2.4 `Stats` 类型（TaskStats/Progress）已含——表达不统一。 | 在 04-mcp §2.4 补 `onTrack`（progress 与 tasks） |
| R-203 | minor | 代理可用性 | 02-core.md §3.1 | `E_UNKNOWN_TYPE` 引用"02-core §5.4 分类规则"，但分类规则实际在 02-core §4.4（§5.4 是 `reindexFile`）。 | 修正引用为 02-core §4.4 |
