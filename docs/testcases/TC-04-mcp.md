# TC-04 · MCP 工具清单详设（`04-mcp.md` · 依据定案文档）

> 依据：`docs/design/decisions.md`（R-114/R-202 等）；契约参考 `04-mcp.md` 各节。
> 纪律：预期结果可判定（isError、content[0].text、details，同源 `03-cli`/`02-core` 输出）。

---

### TC-04-001 pm_validate 正常（集成）
- **功能点**：`04-mcp §2.1` pm_validate；输出 = `03-cli §2.2` 结构；`04-mcp §1.2` 重 JSON 模式
- **优先级**：P0
- **类型**：集成
- **前置条件**：vault 合法
- **步骤**：1. pm_validate({ files: ["projects/proj"] })（`04-mcp §2.1` 输入）。
- **预月果**：isError=false；输出含 checkedFiles/ok/errors（= `03-cli §2.2`）。

### TC-04-002 pm_validate 错误信封（异常）
- **功能点**：`04-mcp §1.1` 错误信封（isError/details）
- **优先级**：P1
- **类型**：集成
- **前置条件**：含非法文件
- **步骤**：1. pm_validate({})，文件非法 → isError=true；2. 检查 details.code=E_VALIDATION，file+field。
- **预月果**：content[0].text = "[E_VALIDATION] ..."（`04-mcp §1.1`）；details.code 同核心错误码（`02-core §3.1`）。

### TC-04-003 pm_create(project) 输出（集成）
- **功能点**：`04-mcp §2.2` pm_create；输出 = `03-cli §3.1` created{id, slug, path}
- **优先级**：P0
- **类型**：集成
- **前置条件**：vault 不存在该 project
- **步骤**：1. pm_create({ type:"project", slug:"mcp-proj", name:"MCP 项目", period:["2026-01-01","2026-12-31"] })。
- **预月果**：isError=false；输出 created{id:"mcp-proj", slug, path}。

### TC-04-004 pm_create(requirement) 默认 status=pool（集成）
- **功能点**：`04-mcp §2.2` 取值；R-114 `pm_create` 补 `status` 输入（project 默认 active；requirement 默认 pool）
- **优先级**：P1
- **类型**：集成
- **前置条件**：项目已存在
- **步骤**：1. pm_create({ type:"requirement", projectSlug:"mcp-proj", title:"需求", source:"inbox:1" })。
- **预月果**：isError=false；REQ-mcp-proj-001.md 生成；status="pool"（R-114）。

### TC-04-005 pm_create(task) 默认 status=todo（集成）
- **功能点**：R-114 task 默认 todo（`03-cli §3.3` 同源）
- **优先级**：P1
- **类型**：集成
- **前置条件**：REQ-mcp-proj-001 存在
- **步骤**：1. pm_create({ type:"task", projectSlug:"mcp-proj", requirement:"[[REQ-mcp-proj-001]]", title:"任务", due:"2026-11-30" })。
- **预月果**：isError=false；TASK-mcp-proj-001.md 生成；status="todo"。

### TC-04-006 pm_create 缺必填 E_USAGE（异常）
- **功能点**：`04-mcp §2.2` 缺 type/必填字段 → isError details.code=E_USAGE（`02-core §3.1`）
- **优先级**：P0
- **类型**：集成
- **前置条件**：无
- **步骤**：1. pm_create({ type:"task", title:"t" })（缺 projectSlug 等）。
- **预月果**：isError=true，details.code="E_USAGE"。

### TC-04-007 pm_move 输出（集成）
- **功能点**：`04-mcp §2.3` pm_move；输出 = `03-cli §4.2`（file/from/to/updatedField/id）
- **优先级**：P0
- **类型**：集成
- **前置条件**：REQ-mcp-proj-001 status=pool
- **步骤**：1. pm_move({ id:"REQ-mcp-proj-001", status:"reviewing" })（`04-mcp §2.3` 输入）。
- **预月果**：isError=false；输出 {ok:true, file, from:"pool", to:"reviewing", updatedField:"updated", id}。

### TC-04-008 pm_move 非法流转 E_INVALID_TRANSITION（异常）
- **功能点**：`04-mcp §2.3` details.code=E_INVALID_TRANSITION（`01-数据规范 §3` 非法流转清单）
- **优先级**：P1
- **类型**：集成
- **前置条件**：REQ-mcp-proj-001 status=rejected
- **步骤**：1. pm_move({ id:"REQ-mcp-proj-001", status:"reviewing" })（rejected→reviewing 非法，`01-数据规范 §3.2`）。
- **预月果**：isError=true，details.code="E_INVALID_TRANSITION"。

### TC-04-009 pm_stats 输出（集成）
- **功能点**：`04-mcp §2.4` pm_stats；输出 = `02-core §2.4` Stats（R-202 onTrack，`03-cli §5.2` 闭环）
- **优先级**：P0
- **类型**：集成
- **前置条件**：有项目与任务
- **步骤**：1. pm_stats({})。
- **预月果**：isError=false；输出含 projects[].progress.onTrack（= `02-core §2.4` Progress.onTrack）与 totals.tasks.onTrack（R-202）。

### TC-04-010 pm_check 输出（集成）
- **功能点**：`04-mcp §2.5` pm_check；输出 = `03-cli §6.3` 结构（ok/issues[].code）
- **优先级**：P1
- **类型**：集成
- **前置条件**：无（或含 issue）
- **步骤**：1. pm_check({})。
- **预月果**：isError=false；输出 {ok, issues[]}，issues[].code ∈ {dangling-wiki, invalid-link-target, id-conflict, date-inverted, invalid-frontmatter}（`03-cli §6.3`）。

### TC-04-011 pm_search 输出（集成）
- **功能点**：`04-mcp §2.6` pm_search；输出 = `02-core §2.6` SearchResult
- **优先级**：P0
- **类型**：集成
- **前置条件**：vault 有相关记录
- **步骤**：1. pm_search({ q:"mcp-proj" })。
- **预月果**：isError=false；results[] 含 {id, type∈{project,requirement,task,inbox}, slug, relPath, title}（`04-mcp §2.6`/`02-core §2.6`）。

### TC-04-012 pm_search 空 q（异常）
- **功能点**：`04-mcp §2.6` q minLength 1 → isError
- **优先级**：P1
- **类型**：集成
- **前置条件**：无
- **步骤**：1. pm_search({ q:"" })。
- **预月果**：isError=true，details.code="E_USAGE"（`02-core §3.1`）。

### TC-04-013 pm_search limit 边界（边界）
- **功能点**：`04-mcp §2.6` limit 1-50，默认 10
- **优先级**：P2
- **类型**：集成
- **前置条件**：vault 有 ≥10 条记录
- **步骤**：1. pm_search({ q:"proj", limit:50 })；2. pm_search({ q:"proj", limit:51 })；3. pm_search({ q:"proj", limit:0 })。
- **预月果**：1: ok；2/3: isError=true（E_USAGE/E_VALIDATION）。

### TC-04-014 E_CONFIG_INVALID 全局（异常）
- **功能点**：`04-mcp §1.2` 全部工具先 loadConfig，缺失/非法 → isError details.code=E_CONFIG_INVALID（`02-core §3.1`）
- **优先级**：P0
- **类型**：集成
- **前置条件**：vault 不存在（TC-02-002）
- **步骤**：1. 任意 pm_tool（如 pm_stats({}））。
- **预月果**：isError=true，details.code="E_CONFIG_INVALID"。
