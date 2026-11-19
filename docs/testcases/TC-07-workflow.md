# TC-07 · 工作流 SOP（`07-workflow.md`，AGENTS.md/PM/WORKFLOW.md 成品）

> 依据：`docs/design/decisions.md`（Q-01/Q-05/Q-07/Q-08/Q-09/Q-10 等裁决）；契约参考 `07-workflow.md` §2.1–2.5 + `03-cli`/`04-mcp`/`05-server`/`06-web` 各节。
> 纪律：覆盖 SOP 每步触发条件→涉及命令→产物→异常处理；预期结果可判定（exit 码、文件内容）。

---

### TC-07-001 SOP 2.1 全流程（inbox 整理, `07-workflow §2.1`）
- **功能点**：`07-workflow §2.1` 全流程（inbox 整理, `01-数据规范 §7.2/§7.3/§7.4`）
- **优先级**：P0
- **类型**：集成
- **前置条件**：inbox/ 下有条目（如 `a.md`）
- **步骤**：1. `pm inbox list --json`（`03-cli §7.2`）；2. `pm inbox process --all --json`（`03-cli §7.3`）；3. `pm new requirement --slug proj --title "支持 OAuth 登录" --module auth --source "inbox:a.md"`（`03-cli §3.2`）；4. `pm inbox archive INBOX-inbox-001`（`03-cli §7.4`, `01-数据规范 §7.4`）。
- **预月果**：exit 0；生成 `REQ-proj-001.md`（整理产物, `01-数据规范 §7.3`）；archive/<id>.md 存在，frontmatter.archived=<today>。

### TC-07-002 SOP 2.1 异常 unnumbered 条目
- **功能点**：`07-workflow §2.1` 异常处理；R-109；`01-数据规范 §7.5`, `02-core §4.4`
- **优先级**：P1
- **类型**：集成
- **前置条件**：inbox/plain.md 无 frontmatter（人手丢的普通 md, `01-数据规范 §7.5` 降级）
- **步骤**：1. `pm inbox list`；2. `pm validate`（`03-cli §2`）。
- **预月果**：`pm validate` exit 2，issue code="invalid-frontmatter"，file=inbox/plain.md（`02-core §4.4` reason="unknown-type"）。

### TC-07-003 SOP 2.1 异常 archive 404
- **功能点**：`07-workflow §2.1` 异常处理
- **优先级**：P1
- **类型**：集成
- **前置条件**：条目被删除/改名
- **步骤**：1. `pm inbox archive INBOX-inbox-001`（`03-cli §7.4`）。
- **预月果**：exit 1，E_NOT_FOUND。

### TC-07-004 SOP 2.2 需求状态流转
- **功能点**：`07-workflow §2.2` 流转流程（`03-cli §4`，`01-数据规范 §3.2`，副作用）
- **优先级**：P0
- **类型**：集成
- **前置条件**：REQ-proj-001 status=pool
- **步骤**：1. `pm move REQ-proj-001 --status reviewing`（`03-cli §4.1`）。
- **预月果**：exit 0；副作用 updated=<today>（`01-数据规范 §3.2`, `07-workflow §2.2 副作用`）。

### TC-07-005 SOP 2.2 异常 非法流转，状态不变
- **功能点**：`07-workflow §2.2` 异常处理（`01-数据规范 §3.2` 非法流转表, `01-数据规范 §3.4`）
- **优先级**：P1
- **类型**：集成
- **前置条件**：REQ-proj-001 status=pool
- **步骤**：1. `pm move REQ-proj-001 --status accepted`（pool→accepted 非法）。
- **预月果**：exit 4，E_INVALID_TRANSITION（`03-cli §4.4`）；frontmatter 不变。

### TC-07-006 SOP 2.2 异常 E_CONFLICT 刷新重试
- **功能点**：`07-workflow §2.2` 异常处理
- **优先级**：P1
- **类型**：集成
- **前置条件**：REQ 被 Obsidian/云盘外部改
- **步骤**：1. `pm move` 返回 E_CONFLICT（`02-core §3.1`）；2. 重跑 `pm move`（`07-workflow §2.2 异常处理`）。
- **预月果**：第二次 exit 0（`03-cli §4.4`），副作用只维护 updated（Q-04）。

### TC-07-007 SOP 2.3 需求派生任务
- **功能点**：`07-workflow §2.3` 派生流程（Web `05-server §2.8`, 人工/Agent `03-cli §3.3`）
- **优先级**：P0
- **类型**：集成
- **前置条件**：REQ-proj-001 status=accepted（`01-数据规范 §3.2`）
- **步骤**：1. Web：`POST /api/requirements/REQ-proj-001/derive-task`；2. 人工/Agent：`pm new task --slug proj --requirement REQ-proj-001 --title ... --priority ... --due ...`。
- **预月果**：TASK-proj-001.md 生成；`requirement="[[REQ-proj-001]]"`（`01-数据规范 §3.1` 单写原则, `07-workflow §2.3` 产物）；updated=created=today（`07-workflow §2.3 副作用`）。

### TC-07-008 SOP 2.3 异常 非 accepted → E_INVALID_TRANSITION
- **功能点**：`07-workflow §2.3` 异常处理（`05-server §2.8`）
- **优先级**：P1
- **类型**：集成
- **前置条件**：REQ-proj-001 status=pool
- **步骤**：1. `POST /api/requirements/REQ-proj-001/derive-task`。
- **预月果**：409，E_INVALID_TRANSITION。

### TC-07-009 SOP 2.3 异常 编号耗尽 → 归档/删除低优任务后重试
- **功能点**：`07-workflow §2.3` 异常处理；`01-数据规范 §1.5`, `03-cli §3.4`, `05-server §6.5`
- **优先级**：P2
- **类型**：集成
- **前置条件**：vault 已有 TASK-proj-999
- **步骤**：1. `pm new task` 返回 E_SEQ_EXHAUSTED（exit 5）；2. 归档/删除低优任务；3. 重试成功。
- **预月果**：第一次 exit 5（`03-cli §3.4`）；第二次 exit 0。

### TC-07-010 SOP 2.4 台账巡检
- **功能点**：`07-workflow §2.4` 巡检流程（`03-cli §2`, `03-cli §6`, `05-server` 端点）
- **优先级**：P0
- **类型**：集成
- **前置条件**：vault 合法
- **步骤**：1. `pm validate --json`（`03-cli §2`）；2. `pm check --json`（`03-cli §6`, `07-workflow §2.4`）；3. 重跑直到 exit=0。
- **预月果**：validate errors=[]；check issues=[]，exit 0（`03-cli §6.5`）。

### TC-07-011 SOP 2.4 异常 dangling-wiki / invalid-link-target
- **功能点**：`07-workflow §2.4` 异常处理（`03-cli §6.2`, `01-数据规范 §6.2`）
- **优先级**：P1
- **类型**：集成
- **前置条件**：TASK-proj-003.requirement="[[REQ-proj-999]]"
- **步骤**：1. `pm check --json`；2. 删除链接或先创建目标 requirement。
- **预月果**：再次 `pm check` exit 0，无 dangling。

### TC-07-012 SOP 2.4 异常 id-conflict
- **功能点**：`07-workflow §2.4` 异常处理（`03-cli §6.2`）
- **优先级**：P1
- **类型**：集成
- **前置条件**：id 冲突（`03-cli §6.2` 说明取给它的 id 改回来，`pm move` 不做改名）
- **步骤**：1. `pm check --json` 找到冲突文件；2. 人/代理改 frontmatter id。
- **预月果**：再次 `pm check` 无 id-conflict。

### TC-07-013 SOP 2.4 异常 E_CONFLICT 刷新重试
- **功能点**：`07-workflow §2.4` 异常处理（Web §6.3, `05-server §6.1-6.4`）
- **优先级**：P1
- **类型**：集成
- **前置条件**：任意 PATCH 冲突
- **步骤**：1. 捕获 409；2. 重跑 `pm move` / 重跑 Web 拖拽（`07-workflow §2.4`）。
- **预月果**：第二次 exit 0（`03-cli §4.4`）。

### TC-07-014 SOP 2.4 异常 E_IO 重跑
- **功能点**：`07-workflow §2.4` 异常处理
- **优先级**：P2
- **类型**：集成
- **前置条件**：IO 错误
- **步骤**：1. 重跑 `pm validate` / `pm check` / `pm move`（`07-workflow §2.4`）。
- **预月果**：重跑正常或明确退出码（`03-cli §1.3`, `02-core §3.1`）。

### TC-07-015 SOP 2.5 周报生成
- **功能点**：`07-workflow §2.5` 周报（`03-cli §5`, `06-web §7`）
- **优先级**：P0
- **类型**：集成
- **前置条件**：若干任务
- **步骤**：1. `pm stats --json`（`03-cli §5.2`）；2. Web `/` + `/p/:slug` 查看总览与漏斗（`06-web §7`）。
- **预月果**：`stats.totals` 含 requirements/tasks 计数与 progress（`02-core §2.4`, `03-cli §5.2`）。

### TC-07-016 SOP 2.5 异常 数据缺省/工具失败注明
- **功能点**：`07-workflow §2.5` 异常处理
- **优先级**：P2
- **类型**：集成
- **前置条件**：vault 为空（`02-core §2.4` 0 值）
- **步骤**：1. `pm stats --json`；2. 追加周报条目。
- **预月果**：统计值为 0，周报注明"无数据/需补齐"；工具失败加"人工修正"与原因（`07-workflow §2.5`）。
