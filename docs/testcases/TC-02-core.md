# TC-02 · `@pm/core` 详设（`02-core.md` · 依据定案文档）

> 依据：`docs/design/decisions.md`（R-103 等），契约参考 `02-core.md` §2.1-§8，跨引 `01-数据规范`。
> 纪律：预期结果可判定（AppResult ok/value/error.code，WriteResult/MoveResult 字段）。

---

### TC-02-001 loadConfig 正常（02-core §4.1）
- **功能点**：`02-core §2.1` Config；`02-core §4.1` loadConfig
- **优先级**：P0
- **类型**：单元
- **前置条件**：vaultPath/pm.config.json 合法（vaultPath 指向真实 vault）
- **步骤**：1. loadConfig(root)（02-core §4.1）。
- **预期结果**：ok=true，Config.vaultPath 与 pmRoot 正确（pmRoot 默认 = vaultPath/PM，`02-core §4.2`）。

### TC-02-002 loadConfig E_CONFIG_INVALID（vault 不存在/配置非法，02-core §4.8 注）
- **功能点**：`02-core §2.1` E_CONFIG_INVALID；`02-core §4.1`
- **优先级**：P0
- **类型**：单元
- **前置条件**：无
- **步骤**：1. pm.config.json 缺失/非法 JSON/字段不合法 → loadConfig。
- **预月果**：ok=false, code="E_CONFIG_INVALID"（`02-core §3.1`）。

### TC-02-003 scanTree 正常（02-core §4.2）
- **功能点**：`02-core §4.2` scanTree（递归、排序、byPath）
- **优先级**：P0
- **类型**：集成
- **前置条件**：vault 构造有若干 md
- **步骤**：1. scanTree(pmRoot)（02-core §4.2）。
- **预期结果**：返回排序后 FileEntry[]（`02-core §2.2`，relPath/mtimeMs/size），byPath 与条目一一对应。

### TC-02-004 scanTree 跳过隐藏与自写登记（02-core §5.3）
- **功能点**：`02-core §4.2` 跳过隐藏文件/目录（.obsidian）；`02-core §5.3` 自写登记
- **优先级**：P1
- **类型**：集成
- **前置条件**：vault 含 .obsidian/foo.md 与已登记的 self-write
- **步骤**：1. registerSelfWrite(path, mtimeMs)；2. scanTree(pmRoot)；3. isSelfWrite(path, mtimeMs)。
- **预月果**：scanTree 不含 .obsidian/foo.md；isSelfWrite 返回 true；过期 mtime 返回 false（64 条 FIFO 淘汰，TC-02-023）。

### TC-02-005 parseFile 正常（02-core §4.3）
- **功能点**：`02-core §4.3` parseFile（gray-matter + Zod safeParse）
- **优先级**：P0
- **类型**：单元
- **前置条件**：合法 md 文件
- **步骤**：1. parseFile(absPath, ZRequirement)（02-core §4.3）。
- **预期结果**：ok=true，data = 校验后 Requirement，body 为正文。

### TC-02-006 parseFile broken（02-core §4.3）
- **功能点**：`02-core §4.3` 解析失败 → issues（ZodIssue 缩略，含 path）
- **优先级**：P1
- **类型**：单元
- **前置条件**：含非法字段的 md 文件
- **步骤**：1. parseFile；2. 供 buildIndex 生成 BrokenFile（`02-core §4.4` reason="parse"）。
- **预月果**：ok=false，issues 含具体 path；`02-core §2.3` BrokenFile.issues 含 {path, code, message}。

### TC-02-007 classifyFile 六态（02-core §4.4 表）
- **功能点**：`02-core §4.4` 分类规则：project/requirement/task/inbox/unnumbered/broken
- **优先级**：P0
- **类型**：集成
- **前置条件**：vault 构造：projects/x/project.md、projects/x/requirements/REQ-x-001.md、projects/x/tasks/TASK-x-001.md、inbox/a.md、obsidian 无 frontmatter 文件、inbox/archive/old.md
- **步骤**：1. buildIndex(config)（`02-core §5.1/§5.2`）。
- **预期结果**：各文件分别进 projects/requirements/tasks/inboxEntries；无类型 md → unnumbered；inbox/archive 下文件不进索引（`02-core §4.4` 归档排除）。

### TC-02-008 排序与双索引结构（02-core §2.3/§7）
- **功能点**：`02-core §2.3` projects/requirements/tasks 按 id 升序；byPath；requirementTasks
- **优先级**：P1
- **类型**：集成
- **前置条件**：若干任务关联同一需求
- **步骤**：1. buildIndex（`02-core §5.2.9`）。
- **预月果**：requirements 按 id 升序；requirementTasks.get("REQ-x-001") 值按 id 升序（`01-数据规范 §6.3`）；byPath.get(absPath) 存在。

### TC-02-009 deriveRequirementTasks 反链聚合（01-数据规范 §6.3）
- **功能点**：`01-数据规范 §6.3` 聚合（纯函数，`02-core §4.4`）
- **优先级**：P0
- **类型**：单元
- **前置条件**：tasks 数组（2 个任务指向同一需求）
- **步骤**：1. deriveRequirementTasks(tasks)（`02-core §4.4`）。
- **预月果**：map 值按 id 升序排列；悬空链接（目标不存在）不进入聚合。

### TC-02-010 deriveStats 正常聚合（02-core §2.4 + 08）
- **功能点**：`02-core §2.4` Stats/Progress；`02-core §8` today/maxDate/isPast
- **优先级**：P0
- **类型**：单元
- **前置条件**：mock tasks（含 todo/doing/done/cancelled）
- **步骤**：1. deriveStats(index)（`02-core §4.7` services/stats）。
- **预月果**：completedRate=done/total；overdue=todo/doing 且 due<today；onTrack=todo/doing 且 due≥today。

### TC-02-011 deriveStats 边界（02-core §2.4）
- **功能点**：`02-core §2.4` 0 个任务 completedRate=0；due==today 时 overdue=0/onTrack
- **优先级**：P1
- **类型**：单元
- **前置条件**：空 tasks 或 due==today
- **步骤**：1. deriveStats。
- **预月果**：0 tasks → completedRate=0, overdue=0, onTrack=0；due==today 的 todo/doing 计入 onTrack 不计 overdue；done 不算 onTrack。

### TC-02-012 工具函数（02-core §2.8/§8）
- **功能点**：`02-core §2.8` today/maxDate/isPast；`02-core §8` normalizePath
- **优先级**：P1
- **类型**：单元
- **前置条件**：无
- **步骤**：1. today() 返回 YYYY-MM-DD 本地日期；2. maxDate("2026-01-02","2026-01-01")="2026-01-02"；3. isPast("2026-01-01")=true（等于 today 为 false）；4. normalizePath("a\\b")="a/b"。
- **预月果**：各函数返回预期值。

### TC-02-013 atomicWriteFile 正常（02-core §6.1）
- **功能点**：`02-core §6.1` atomicWriteFile（临时文件+rename）
- **优先级**：P0
- **类型**：集成
- **前置条件**：目标文件已存在
- **步骤**：1. atomicWriteFile(path, content)（02-core §4.6/§6.1）。
- **预月果**：ok=true；文件内容与 content 一致；临时文件被 rename 消耗（目录内无残留）；selfWrite 登记（TC-02-023）。

### TC-02-014 atomicWriteFile E_CONFLICT（02-core §6.1）
- **功能点**：`02-core §6.1` expectedMtimeMs 预检 → E_CONFLICT（含 expectedMtimeMs/currentMtimeMs）
- **优先级**：P0
- **类型**：集成
- **前置条件**：目标文件存在，mtime 与 expectedMtimeMs 不一致
- **步骤**：1. stat 获取 current mtimeMs；2. atomicWriteFile(path, content, { expectedMtimeMs: other })（02-core §4.6）。
- **预月果**：ok=false, code="E_CONFLICT"，error.expectedMtimeMs=传入值，error.currentMtimeMs=实际值（`02-core §3.1`，`02-core §2.7` WriteConflict）。

### TC-02-015 atomicWriteFile 并发冲突（02-core §6.1）
- **功能点**：并发两个写同目标文件 → 第二个 E_CONFLICT
- **优先级**：P2
- **类型**：集成
- **前置条件**：无（初始无目标文件）
- **步骤**：1. 两个 worker 同时 atomicWriteFile(path)（02-core §6.1）。
- **预月果**：其中一个 ok=true，另一个 ok=false, E_CONFLICT（R-103 mtime 冲突重试，调用方刷新重试）。

### TC-02-016 moveStatus 流转副作用（02-core §4.7）
- **功能点**：`02-core §4.7` moveStatus（updated=今天；todo→doing）
- **优先级**：P0
- **类型**：集成
- **前置条件**：TASK-proj-001 为 todo，updated=created 旧日期
- **步骤**：1. moveStatus(index, "TASK-proj-001", "doing")（02-core §4.7）。
- **预月果**：ok=true, from="todo", to="doing", updatedField="updated"；文件 frontmatter.updated=today，status="doing"。

### TC-02-017 moveStatus E_NOT_FOUND（02-core §4.7）
- **功能点**：`02-core §4.7` 查记录（byPath）不存在 → E_NOT_FOUND
- **优先级**：P0
- **类型**：集成
- **前置条件**：无
- **步骤**：1. moveStatus(index, "TASK-proj-999", "doing")。
- **预月果**：ok=false, code="E_NOT_FOUND"（`02-core §3.1`，CLI exit 1）。

### TC-02-018 moveStatus 非法流转（02-core §4.7 + 01 §3.3）
- **功能点**：`02-core §4.7` isValidTransition → E_INVALID_TRANSITION（message 含拒绝原因）
- **优先级**：P0
- **类型**：集成
- **前置条件**：TASK-proj-001 为 doing
- **步骤**：1. moveStatus(index, "TASK-proj-001", "todo")（doing→todo 非法，`01-数据规范 §3.3`）。
- **预月果**：ok=false, code="E_INVALID_TRANSITION"；文件未改动。

### TC-02-019 moveStatus mtime 冲突（并发，02-core §4.7.1）
- **功能点**：锁内 atomicWriteFile 含 expectedMtimeMs；外部修改 → E_CONFLICT（409）
- **优先级**：P1
- **类型**：集成
- **前置条件**：TASK-proj-001 已在 byPath（mtime M0）
- **步骤**：1. 获取 M0；2. 外部追加修改文件（非应用写）→ mtime 变化；3. moveStatus(index, id, "doing")（02-core §4.7.1）。
- **预月果**：ok=false, code="E_CONFLICT"（`02-core §4.7.1`）。

### TC-02-020 moveLocks 按路径串行（并发，02-core §4.7.1）
- **功能点**：`02-core §4.7.1` moveLocks（Map<relPath, Promise<void>> 串行）
- **优先级**：P2
- **类型**：集成
- **前置条件**：同一 TASK-proj-001，todo→doing 在多个调用方并发发起
- **步骤**：1. N 个并发 moveStatus(index, id, "doing")（02-core §4.7）。
- **预月果**：仅第一个 ok；其余 E_INVALID_TRANSITION（同状态流转非法，`01-数据规范 §3.3`）或 E_CONFLICT——关键：无并发覆盖丢更新（对应 Web §5 序列化）。

### TC-02-021 reindexFile 更新（02-core §5.4）
- **功能点**：`02-core §5.4` reindexFile（更新）
- **优先级**：P0
- **类型**：集成
- **前置条件**：已 buildIndex
- **步骤**：1. 直接写目标文件（非经写冲突检测）；2. reindexFile(index, absPath)（02-core §5.4）。
- **预月果**：index 中对应记录更新（title 等）。

### TC-02-022 reindexFile 删除（02-core §5.4）
- **功能点**：`02-core §5.4` reindexFile（absPath 不存在 → 移除）
- **优先级**：P1
- **类型**：集成
- **前置条件**：已 buildIndex，记录在 projects/requirements/tasks/inboxEntries
- **步骤**：1. 删除文件；2. reindexFile(index, absPath)。
- **预月果**：byPath/三类数组均不再包含该路径。

### TC-02-023 registerSelfWrite/isSelfWrite（02-core §5.3）
- **功能点**：`02-core §5.3` registerSelfWrite/isSelfWrite（最多 64 条 FIFO 淘汰）
- **优先级**：P1
- **类型**：单元
- **前置条件**：无
- **步骤**：1. 注册 N>64（如 70 条）路径；2. isSelfWrite(最早路径) → false；3. isSelfWrite(最新) → true；4. 过期 mtime 匹配 → false。
- **预月果**：缓存 FIFO 淘汰最早；最新路径仍 true。

### TC-02-024 startWatcher 防抖（02-core §4.5/§5.5）
- **功能点**：`02-core §4.5` startWatcher（debounceMs 默认 250）；`02-core §5.5`
- **优先级**：P2
- **类型**：集成
- **前置条件**：已 buildIndex
- **步骤**：1. 开始 watcher；2. 连续在短窗内修改目标文件 5 次；3. 等待 >debounce。
- **预月果**：onChange 合并为最终一次路径集；Obsidian 自写（self-ignore）不触发 reindex。

### TC-02-025 vault 不存在（02-core §4.8 注）
- **功能点**：`02-core §4.2` 注释：vaultPath/pmRoot 必须解析到实际存在的 Obsidian Vault（`00-plan-final` 非目标：不做多用户/权限，没有网络意义）
- **优先级**：P1
- **类型**：集成
- **前置条件**：vaultPath 指向不存在目录
- **步骤**：1. loadConfig；2. scanTree(pmRoot) / buildIndex(config)。
- **预月果**：loadConfig 返回 E_CONFIG_INVALID（`02-core §4.1`）或 scanTree 返回空列表且不崩溃。

### TC-02-026 ProjectStats onTrack 语义（R-104/R-121，02-core §2.4）
- **功能点**：R-104 `TaskStats.onTrack`：todo/doing 且 due ≥ today；R-121 补写语义解释；`02-core §2.4`
- **优先级**：P0
- **类型**：单元
- **前置条件**：tasks：一个 todo 且 due=今天，一个 doing 且 due=明天，一个 todo 且 due=昨天（overdue）
- **步骤**：1. deriveStats(index)。
- **预月果**：onTrack=2（due ≥ today），overdue=1（due < today）；等于 today 的不计 overdue。

### TC-02-027 project 流转矩阵（合法, `01-数据规范 §3.1`，`02-core §4.7` moveStatus）
- **优先级**：P0
- **类型**：集成
- **前置条件**：构造各状态的 project（active/paused/done/archived）
- **步骤**：1. 调用 moveStatus(index, id, target)（`02-core §4.7`）。
- **预月果**：矩阵行（含合法均 ok=true）：active→paused；paused→active；active→done；active→archived；done→archived；from/to 符合流转表，updatedField="updated"（`01-数据规范 §3.1` 副作用），frontmatter.status 已更新，frontmatter.updated=today。

### TC-02-028 project 非法流转矩阵（`01-数据规范 §3.1`，`02-core §3.1`）
- **优先级**：P1
- **类型**：集成
- **前置条件**：paused/done/archived 状态的 project
- **步骤**：1. 调用 moveStatus。
- **预月果**：paused→done；done→active；done→paused；archived→any 非法；均 ok=false, code="E_INVALID_TRANSITION"，状态不变。

### TC-02-029 requirement 流转矩阵（合法, `01-数据规范 §3.2`，`02-core §4.7`）
- **优先级**：P0
- **类型**：集成
- **前置条件**：pool/reviewing/accepted/rejected 状态的 requirement
- **步骤**：1. 调用 moveStatus。
- **预月果**：矩阵行（ok=true）：pool→reviewing；pool→rejected；reviewing→accepted；reviewing→rejected；accepted→done；rejected→pool；副作用 updated=today（`01-数据规范 §3.2`）。

### TC-02-030 requirement 非法流转矩阵（`01-数据规范 §3.2`，`02-core §3.1`）
- **优先级**：P1
- **类型**：集成
- **前置条件**：pool/reviewing/accepted/rejected/done 状态
- **步骤**：1. 调用 moveStatus。
- **预月果**：矩阵行（E_INVALID_TRANSITION）：pool→done；reviewing→done；accepted→reviewing；accepted→rejected；rejected→reviewing；rejected→done；done→pool（done 终态，`01-数据规范 §3.2`）。

### TC-02-031 task 流转矩阵（合法, `01-数据规范 §3.3`，`02-core §4.7`）
- **优先级**：P0
- **类型**：集成
- **前置条件**：todo/doing/cancelled 状态的 task
- **步骤**：1. 调用 moveStatus。
- **预月果**：矩阵行（ok=true）：todo→doing；todo→done；todo→cancelled；doing→done；doing→cancelled；cancelled→todo；副作用：done 入口含 completed=today（`01-数据规范 §3.3`）。

### TC-02-032 task 非法流转矩阵（`01-数据规范 §3.3`，`02-core §3.1`）
- **优先级**：P1
- **类型**：集成
- **前置条件**：doing/done/cancelled 状态
- **步骤**：1. 调用 moveStatus。
- **预月果**：矩阵行（E_INVALID_TRANSITION）：doing→todo；done→todo/doing/cancelled（done 终态）；cancelled→done/doing/cancelled。
