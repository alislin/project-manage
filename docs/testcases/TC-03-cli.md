# TC-03 · CLI（`pm` 命令）详设（`03-cli.md` · 依据定案文档）

> 依据：`docs/design/decisions.md`（R-102/106/110/201/202/103 等）；契约参考 `03-cli.md` 各节 + `02-core §3.1/§3.2` 错误映射。
> 纪律：预期结果可判定（exit 码 `03-cli §1.3`，stderr 错误结构 `02-core §3.2`）。

---

### TC-03-001 pm validate 全通过（exit 0）
- **功能点**：`03-cli §2` pm validate 正常；`03-cli §1.3` 退出码 0
- **优先级**：P0
- **类型**：集成
- **前置条件**：vault 全部文件合法
- **步骤**：1. `pm validate`（`03-cli §2.1`）。
- **预月果**：exit 0；输出 ✅ 全部 N 个文件校验通过（`03-cli §2.3`）。

### TC-03-002 pm validate 指定文件（--json 结构齐全）
- **功能点**：`03-cli §2.1/§2.2` `[files...]` 参数（目录 = 该目录下 md）
- **优先级**：P1
- **类型**：集成
- **前置条件**：无
- **步骤**：1. `pm validate projects/proj --json`。
- **预月果**：exit 0；checkedFiles = 该目录 md 数；ok=true；errors=[]。

### TC-03-003 pm validate E_VALIDATION 精确到 file+field（exit 4）
- **功能点**：`03-cli §2.3` 错误输出（file/field/code/message）；`02-core §3.4` 统一错误形状
- **优先级**：P0
- **类型**：集成
- **前置条件**：某文件 status 非法（`03-cli §2.3` 示例）
- **步骤**：1. `pm validate`（`03-cli §2`）。
- **预月果**：exit 4；stderr 含 {file, field:"status", code:"E_VALIDATION"}。

### TC-03-004 pm validate 空 vault（exit 0, checkedFiles=0）
- **功能点**：`03-cli §2.2` checkedFiles 语义
- **优先级**：P1
- **类型**：集成
- **前置条件**：vault 无 md
- **步骤**：1. `pm validate`。
- **预月果**：exit 0，checkedFiles=0，ok=true。

### TC-03-005 pm validate --json 输出结构（正常）
- **功能点**：`03-cli §2.2` validate --json 完整 schema
- **优先级**：P1
- **类型**：集成
- **前置条件**：含 1 个非法文件（可选）
- **步骤**：1. `pm validate --json`。
- **预月果**：输出 JSON 含 checkedFiles/ok/errors[{file,field?,code,message}]。

### TC-03-006 pm new project 正常（我的应用 v2）
- **功能点**：`03-cli §3.1` pm new project（slug 规范化，`01-数据规范 §1.5`）
- **优先级**：P0
- **类型**：集成
- **前置条件**：vault 不存在该 project
- **步骤**：1. `pm new project --name "我的应用 v2" --tag frontend`。
- **预月果**：exit 0；✅ 已创建项目；slug="我的应用-v2"（`01-数据规范 §1.5` 正常化策略）；project.md 合规；`--json` 输出 created{id, slug, path}。

### TC-03-007 pm new project 重名 slug E_CONFLICT（exit 3）
- **功能点**：`03-cli §3.4` exit 3；`05-server §2.2` slug 已存在 → E_CONFLICT
- **优先级**：P1
- **类型**：集成
- **前置条件**：projects/app 已存在
- **步骤**：1. `pm new project --name app`。
- **预月果**：exit 3；stderr 含 E_CONFLICT。

### TC-03-008 pm new project 缺 --name E_USAGE（exit 2）
- **功能点**：`03-cli §3.4` exit 2（E_USAGE 缺必填参数，`02-core §3.1`）
- **优先级**：P0
- **类型**：集成
- **前置条件**：无
- **步骤**：1. `pm new project`。
- **预月果**：exit 2；错误输出 E_USAGE。

### TC-03-009 pm new project period start>end E_VALIDATION（exit 4）
- **功能点**：`03-cli §3.1` 校验 start ≤ end（`01-数据规范 §1.1`）
- **优先级**：P1
- **类型**：集成
- **前置条件**：无
- **步骤**：1. `pm new project --name test --period 2026-12-31 2026-01-01`。
- **预月果**：exit 4；E_VALIDATION。

### TC-03-010 pm new requirement 默认 source=human（R-102）
- **功能点**：`03-cli §3.2` 默认 source="human"（非空，`01-数据规范 §1.2`）
- **优先级**：P0
- **类型**：集成
- **前置条件**：项目 proj 已存在（`03-cli §3.2` 项目目录必须已存在）
- **步骤**：1. `pm new requirement --slug proj --title "需求一" --module auth`（无 --source）。
- **预月果**：exit 0；REQ-proj-001.md 生成；frontmatter.source="human"；status="pool"（默认）；priority="P2"（默认）（`03-cli §3.2`）。

### TC-03-011 pm new requirement 空 title E_VALIDATION（exit 4）
- **功能点**：`03-cli §3.2` title 非空（`01-数据规范 §1.2`）
- **优先级**：P1
- **类型**：集成
- **前置条件**：项目已存在
- **步骤**：1. `pm new requirement --slug proj --title ""`。
- **预月果**：exit 4，E_VALIDATION，field=title。

### TC-03-012 pm new requirement 项目不存在 E_NOT_FOUND（exit 1）
- **功能点**：`03-cli §3.4` exit 1（`02-core §3.1`，项目目录不存在）
- **优先级**：P0
- **类型**：集成
- **前置条件**：无
- **步骤**：1. `pm new requirement --slug no-such --title t`。
- **预月果**：exit 1；E_NOT_FOUND。

### TC-03-013 pm new task 正常
- **功能点**：`03-cli §3.3` pm new task（--requirement 必填）
- **优先级**：P0
- **类型**：集成
- **前置条件**：REQ-proj-001 存在
- **步骤**：1. `pm new task --slug proj --requirement REQ-proj-001 --title "任务一" --priority P1 --due 2026-11-30`。
- **预月果**：exit 0；TASK-proj-001.md 生成；frontmatter.requirement="[[REQ-proj-001]]"；status="todo"；`--json` created{id, path}。

### TC-03-014 pm new task 缺 --due E_USAGE（exit 2）
- **功能点**：`03-cli §3.3` due 必填（Q-02 决策，`01-数据规范 §1.3` 非空必填）
- **优先级**：P1
- **类型**：集成
- **前置条件**：REQ-proj-001 存在
- **步骤**：1. `pm new task --slug proj --requirement REQ-proj-001 --title t`（缺 --due）。
- **预月果**：exit 2，E_USAGE。

### TC-03-015 pm new task requirement 格式不合法 E_VALIDATION（exit 4）
- **功能点**：`03-cli §3.3` 外键校验 format（`01-数据规范 §1.3` 正则）
- **优先级**：P1
- **类型**：集成
- **前置条件**：REQ-proj-001 存在
- **步骤**：1. `--requirement REQ-proj-01`（两位序号）。
- **预月果**：exit 4，E_VALIDATION，field=requirement。

### TC-03-016 pm new task requirement 目标不存在 fail-fast E_VALIDATION（exit 4）
- **功能点**：`03-cli §3.3` fail-fast 校验（`03-cli §3.3` 外键校验；R-108 `pm check` 可发现但此处 fail-fast）
- **优先级**：P1
- **类型**：集成
- **前置条件**：无
- **步骤**：1. `--requirement REQ-proj-999`。
- **预月果**：exit 4；E_VALIDATION（`01-数据规范 §6.2` 跨项目/不存在；R-108：validate 不校验悬空，`03-cli §2.3`）。

### TC-03-017 编号池耗尽 E_SEQ_EXHAUSTED（exit 5）
- **功能点**：`03-cli §3.4` exit 5（`01-数据规范 §1.5`）；R-106
- **优先级**：P2
- **类型**：集成
- **前置条件**：vault 已有 REQ-proj-999（池耗尽）
- **步骤**：1. `pm new requirement --slug proj --title t`。
- **预月果**：exit 5；E_SEQ_EXHAUSTED（`02-core §3.1`，`01-数据规范 §1.5` 序号 >999）。

### TC-03-018 新建项目中文/空格路径正常（边界）
- **功能点**：`01-数据规范 §1.5` slug 正常化（我的应用 v2 → 我的应用-v2）；`01-数据规范 §2` UTF-8
- **优先级**：P1
- **类型**：集成
- **前置条件**：vault 不含该名项目
- **步骤**：1. `pm new project --name "我的应用 v2"`（含空格）。
- **预月果**：exit 0；slug="我的应用-v2"；vault 中 PM/projects/我的应用-v2/project.md 可读（`01-数据规范 §2` UTF-8）。

### TC-03-019 pm move pool→reviewing 正常（exit 0, updated=今天）
- **功能点**：`03-cli §4` pm move；`01-数据规范 §3.2` pool→reviewing（副作用 updated=今天）
- **优先级**：P0
- **类型**：集成
- **前置条件**：REQ-proj-001 status=pool
- **步骤**：1. `pm move REQ-proj-001 --status reviewing`（`03-cli §4.1`）。
- **预月果**：exit 0；副作用前面 updated=<today>（`01-数据规范 §3.2`）；`--json` 输出{ok:true, file, from:"pool", to:"reviewing", updatedField:"updated", id}。

### TC-03-020 pm move 非法流转 E_INVALID_TRANSITION（exit 4）
- **功能点**：`03-cli §4.4` exit 4；`01-数据规范 §3.4` 非法流转清单
- **优先级**：P0
- **类型**：集成
- **前置条件**：REQ-proj-001 status=pool（pool→done 非法，`01-数据规范 §3.2`）
- **步骤**：1. `pm move REQ-proj-001 --status done`。
- **预月果**：exit 4；stderr 含 E_INVALID_TRANSITION，message 含拒绝原因（`02-core §3.1/§3.2`）；frontmatter 不变。

### TC-03-021 pm move id 不存在 E_NOT_FOUND（exit 1）
- **功能点**：`03-cli §4.4` exit 1；`02-core §3.1`
- **优先级**：P0
- **类型**：集成
- **前置条件**：无
- **步骤**：1. `pm move REQ-proj-999 --status done`。
- **预月果**：exit 1，E_NOT_FOUND。

### TC-03-022 pm move 缺 --status E_USAGE（exit 2）
- **功能点**：`03-cli §4.4` exit 2（`02-core §3.1` E_USAGE）
- **优先级**：P1
- **类型**：集成
- **前置条件**：存在任意 REQ
- **步骤**：1. `pm move REQ-proj-001`。
- **预月果**：exit 2，E_USAGE。

### TC-03-023 pm move todo→doing→done 全流程（exit 0, completed=今天）
- **功能点**：`01-数据规范 §3.3` todo→doing/done（completed=今天）
- **优先级**：P0
- **类型**：集成
- **前置条件**：TASK-proj-001 status=todo
- **步骤**：1. `pm move TASK-proj-001 --status doing`（exit 0，updated=今天）；2. `pm move TASK-proj-001 --status done`（exit 0，updated+completed=今天）。
- **预月果**：两次 exit 0；第二次 frontmatter.status="done", completed=<today>。

### TC-03-024 pm move E_CONFLICT（exit 3，并发）
- **功能点**：`03-cli §4.4` exit 3；R-103（`02-core §4.7.1`）
- **优先级**：P1
- **类型**：集成
- **前置条件**：TASK-proj-001 已外部修改（mtime 变化）
- **步骤**：1. 确认 byPath mtime；2. 外部修改文件；3. `pm move TASK-proj-001 --status doing`。
- **预月果**：exit 3；E_CONFLICT。

### TC-03-025 pm stats 聚合正常（exit 0）
- **功能点**：`03-cli §5` pm stats；`02-core §2.4` Stats
- **优先级**：P0
- **类型**：集成
- **前置条件**：有项目与任务
- **步骤**：1. `pm stats`。
- **预月果**：exit 0；输出 projects[]（slug/name/status/progress{completedRate,overdueCount,totalTasks,doneTasks,cancelledTasks,onTrack}，R-104/R-121）与 totals{requirements/tasks}（`03-cli §5.2`）。

### TC-03-026 pm stats 空 vault（exit 0, 0 值）
- **功能点**：`03-cli §5.4` exit 0
- **优先级**：P1
- **类型**：集成
- **前置条件**：vault 无任务
- **步骤**：1. `pm stats`。
- **预月果**：exit 0；completedRate=0，overdueCount=0，onTrack=0。

### TC-03-027 pm stats 逾期统计（overdue 数量）
- **功能点**：`02-core §2.4` overdue = todo/doing 且 due<today；`07-workflow §1` 日期约定
- **优先级**：P1
- **类型**：集成
- **前置条件**：2 个 todo（due 明日/昨日）+ 1 个 done
- **步骤**：1. `pm stats`。
- **预月果**：exit 0；overdueCount=1；totals.tasks.byStatus.todo=2；done 不计 overdue（`02-core §2.4`）。

### TC-03-028 pm check 无问题（exit 0）
- **功能点**：`03-cli §6` pm check；`03-cli §6.5` exit 0
- **优先级**：P0
- **类型**：集成
- **前置条件**：vault 一致
- **步骤**：1. `pm check`。
- **预月果**：exit 0；✅ 台账一致性健康（`03-cli §6.4`）。

### TC-03-029 pm check dangling-wiki（exit 2）
- **功能点**：`03-cli §6.2` issue code dangling-wiki；`01-数据规范 §6.2`
- **优先级**：P0
- **类型**：集成
- **前置条件**：TASK-proj-003.requirement 指向 [[REQ-proj-999]]
- **步骤**：1. `pm check`。
- **预月果**：exit 2；issue[0].code="dangling-wiki"，file=TASK-proj-003.md。

### TC-03-030 pm check id-conflict（exit 2）
- **功能点**：`03-cli §6.2` id-conflict（`03-cli §6.2`：同前缀+slug 重复，`01-数据规范 §5`）
- **优先级**：P1
- **类型**：集成
- **前置条件**：两个文件 id 重复（手建的 Obsidian 文件）
- **步骤**：1. `pm check`。
- **预月果**：exit 2；issue 含 id-conflict。

### TC-03-031 pm check date-inverted（exit 2）
- **功能点**：`03-cli §6.2` date-inverted：updated<created（req/task）；due<created（task）（`01-数据规范 §4`）
- **优先级**：P1
- **类型**：集成
- **前置条件**：一条 req updated<created；一个 task due<created
- **步骤**：1. `pm check`。
- **预月果**：exit 2；issue.code="date-inverted"（TC-01-010/TC-01-016/TC-01-013 与此对应）。

### TC-03-032 pm check invalid-frontmatter（exit 2）
- **功能点**：`03-cli §6.2` invalid-frontmatter（`01-数据规范 §4.2` 待修复清单）
- **优先级**：P1
- **类型**：集成
- **前置条件**：含非法 frontmatter 的 md
- **步骤**：1. `pm check`。
- **预月果**：exit 2；issue.code="invalid-frontmatter"（`02-core §4.4` reason="parse"）。

### TC-03-033 pm check invalid-link-target（exit 2）
- **功能点**：`03-cli §6.2` invalid-link-target（`01-数据规范 §6.2` 无效格式 → E_VALIDATION/invalid-link-target）
- **优先级**：P1
- **类型**：集成
- **前置条件**：task.requirement="[[xxx]]"（不合法，`01-数据规范 §1.3` Zod 通过，仅 check 检测）
- **步骤**：1. `pm check`。
- **预月果**：exit 2；issue.code="invalid-link-target"。

### TC-03-034 pm check --json 输出结构（正常）
- **功能点**：`03-cli §6.3` check --json 完整 schema
- **优先级**：P1
- **类型**：集成
- **前置条件**：有若干 issue（可选）
- **步骤**：1. `pm check --json`。
- **预月果**：输出 JSON 含 ok/issues[{file,field?,code∈{dangling-wiki, invalid-link-target, id-conflict, date-inverted, invalid-frontmatter},message}]。

### TC-03-035 pm inbox list（按 created 降序）
- **功能点**：`03-cli §7.2` list 输出（`01-数据规范 §7.3` 步骤 2）
- **优先级**：P0
- **类型**：集成
- **前置条件**：inbox 下有 2 条
- **步骤**：1. `pm inbox list --json`。
- **预月果**：exit 0；entries[0].created ≥ entries[1].created；含 id/created/tags/source/file/bodyFirstLine/status="active"。

### TC-03-036 pm inbox list 空（exit 0，0 条）
- **功能点**：`03-cli §7.2` 空清单
- **优先级**：P1
- **类型**：集成
- **前置条件**：inbox 根无文件
- **步骤**：1. `pm inbox list`。
- **预月果**：exit 0，count=0。

### TC-03-037 pm inbox process（预览 + --dry-run）
- **功能点**：`03-cli §7.3` process 子命令
- **优先级**：P0
- **类型**：集成
- **前置条件**：inbox 有条目
- **步骤**：1. `pm inbox process`（人类输出，`03-cli §7.3` 示例）；2. `pm inbox process --dry-run --json`。
- **预月果**：1: exit 0，列出前 20 条（`03-cli §7.3` 默认 limit=20）；2: exit 0，不产生写入/归档。

### TC-03-038 pm inbox archive（移动 + frontmatter.archived=今天）
- **功能点**：`03-cli §7.4` archive 子命令（`01-数据规范 §7.4`）
- **优先级**：P0
- **类型**：集成
- **前置条件**：INBOX-inbox-001 在 inbox 根
- **步骤**：1. `pm inbox archive INBOX-inbox-001`。
- **预月果**：exit 0；✅ 已归档至 PM/inbox/archive/<id>.md；文件 frontmatter.archived=<today>（`01-数据规范 §7.4`）；`pm inbox list` 不再列出（`01-数据规范 §7.4`）。

### TC-03-039 pm inbox archive 不存在 id（exit 1）
- **功能点**：`03-cli §7.4` E_NOT_FOUND（`02-core §3.1`）
- **优先级**：P1
- **类型**：集成
- **前置条件**：无
- **步骤**：1. `pm inbox archive INBOX-inbox-999`。
- **预月果**：exit 1，E_NOT_FOUND。

### TC-03-040 pm inbox archive 非法 id（exit 1/2）
- **功能点**：`03-cli §7.4` 非法 id 编号（`01-数据规范 §7.6`）
- **优先级**：P1
- **类型**：集成
- **前置条件**：无
- **步骤**：1. `pm inbox archive "bad-id"`。
- **预月果**：exit 1（编号不在 INBOX 空间或先 E_VALIDATION）——归档前先按 id 查找，未知 id E_NOT_FOUND。

### TC-03-041 pm serve 启动（`03-cli §8` 输出）
- **功能点**：`03-cli §8` serve；`05-server §7` 生命周期
- **优先级**：P0
- **类型**：手动验收
- **前置条件**：vault 存在，端口 3000 空闲
- **步骤**：1. `pm serve`（超时数秒后 kill）。
- **预月果**：输出 ℹ️ 启动 PM Web 服务 http://127.0.0.1:3000/ （静态托管 apps/web/dist）；GET /api/projects 可访问（`05-server §2.1`）。

### TC-03-042 pm 无参数/未知命令（exit 2）
- **功能点**：`03-cli §1.2` 全命令表 + exit 2（`02-core §3.1` E_USAGE）
- **优先级**：P1
- **类型**：集成
- **前置条件**：无
- **步骤**：1. `pm`；2. `pm frobnicate`。
- **预月果**：exit 2，输出命令表（`03-cli §1.2`）。

### TC-03-043 vault 不存在（E_CONFIG_INVALID exit 2）
- **功能点**：`02-core §4.8` 注（vault 必须存在）；`03-cli §1.1` loadConfig
- **优先级**：P0
- **类型**：集成
- **前置条件**：pm.config.json 指向不存在的 vaultPath
- **步骤**：1. `pm stats`。
- **预月果**：exit 2；E_CONFIG_INVALID（`03-cli §1.3` exit 2 触发；`02-core §3.1`）。

### TC-03-044 pm validate 中文/空格路径（exit 0）
- **功能点**：`01-数据规范 §2` UTF-8 + 目录路径含中文/空格
- **优先级**：P1
- **类型**：集成
- **前置条件**：含中文/空格路径的项目文件（TC-03-018/TC-03-006）
- **步骤**：1. `pm validate`。
- **预月果**：exit 0，中文/空格路径文件正常校验。

### TC-03-050 pm move project 流转（CLI, `03-cli §4.1`，`01-数据规范 §3.1`）
- **功能点**：`03-cli §4` 三种 id 均接受（project 即 slug, `02-core §4.4`）；`01-数据规范 §3.1` project 流转表
- **优先级**：P0
- **类型**：集成
- **前置条件**：projects/my-app（active）
- **步骤**：1. `pm move my-app --status paused`。
- **预月果**：exit 0；副作用 updated=今天；project.md.status="paused"。
