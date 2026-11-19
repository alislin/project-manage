# TC-05 · REST API 详设（`05-server.md` · 依据定案文档）

> 依据：`docs/design/decisions.md`（R-110/R-115 等）；契约参考 `05-server.md` 各节。
> 纪律：预期结果可判定（HTTP 状态码，错误信封 {ok:false, error:{code,...}}）。

---

### TC-05-001 GET /api/projects 正常（集成）
- **功能点**：`05-server §2.1` projects[] 含 progress（`02-core §2.4`）
- **优先级**：P0
- **类型**：集成
- **前置条件**：vault 有项目与任务
- **步骤**：1. GET /api/projects（`05-server §1.1` 响应外壳 {ok, data}）。
- **预月果**：200；data.projects[{slug, name, status, period, tags, progress{completedRate,overdueCount,totalTasks,doneTasks,cancelledTasks,onTrack}}]；mtimeMs 以 project.md 为基准。

### TC-05-002 GET /api/projects 空 vault（正常）
- **功能点**：`05-server §2.1` 空列表
- **优先级**：P1
- **类型**：集成
- **前置条件**：vault 无项目
- **步骤**：1. GET /api/projects。
- **预月果**：200；data.projects=[]。

### TC-05-003 POST /api/projects 正常（201，R-110）
- **功能点**：`05-server §2.2` 新建项目；响应 created.id=slug（R-110）
- **优先级**：P0
- **类型**：集成
- **前置条件**：slug 未占用
- **步骤**：1. POST /api/projects {slug:"web", name:"Web", period:["2026-01-01","2026-12-31"], tags:["a"]}。
- **预月果**：201；data.created={id:"web", slug:"web", path, mtimeMs}；project.md 生成。

### TC-05-004 POST /api/projects 缺 name（异常）
- **功能点**：`05-server §2.2` E_USAGE(400)（`02-core §3.1`）
- **优先级**：P1
- **类型**：集成
- **前置条件**：无
- **步骤**：1. POST /api/projects {}。
- **预月果**：400；error.code="E_USAGE"。

### TC-05-005 POST /api/projects 非法 slug（边界/异常）
- **功能点**：`05-server §2.2` Zod 校验 → E_VALIDATION(422)（`01-数据规范 §1.5`）
- **优先级**：P1
- **类型**：集成
- **前置条件**：无
- **步骤**：1. POST /api/projects {name:"x", slug:"a--b"}。
- **预月果**：422；error.code="E_VALIDATION"，field=slug。

### TC-05-006 POST /api/projects 重复 slug（异常）
- **功能点**：`05-server §2.2` E_CONFLICT(409) 重复 slug（`02-core §3.1`，`00-plan-final §4.2`）
- **优先级**：P1
- **类型**：集成
- **前置条件**：projects/web 已存在
- **步骤**：1. POST /api/projects {slug:"web", name:"Web 2"}。
- **预月果**：409；error.code="E_CONFLICT"。

### TC-05-007 GET /api/projects/:slug/overview（正常）
- **功能点**：`05-server §2.3` overview；progress=`02-core §2.4`；periods 需求交付漏斗（`06-web §7`）
- **优先级**：P0
- **类型**：集成
- **前置条件**：项目 + 需求 + 任务
- **步骤**：1. GET /api/projects/web/overview。
- **预月果**：200；data.project（含 mtimeMs）、progress、totals{requirements, tasks}、periods{done, total, rate}。

### TC-05-008 GET /api/projects/:slug/overview 404（异常）
- **功能点**：`05-server §2.3` E_NOT_FOUND(404)
- **优先级**：P1
- **类型**：集成
- **前置条件**：无
- **步骤**：1. GET /api/projects/nope/overview。
- **预月果**：404；error.code="E_NOT_FOUND"。

### TC-05-009 GET /api/projects/:slug/requirements（正常）
- **功能点**：`05-server §2.4` 需求池列表（含 brokenFiles）
- **优先级**：P0
- **类型**：集成
- **前置条件**：项目 web
- **步骤**：1. GET /api/projects/web/requirements。
- **预月果**：200；data.requirements[]（Requirement & {mtimeMs}）；data.brokenFiles[]（可选）。

### TC-05-010 POST /api/projects/:slug/requirements（201）
- **功能点**：`05-server §2.5` 新建需求（Zod `01-数据规范 §1.2`）
- **优先级**：P0
- **类型**：集成
- **前置条件**：项目 web 存在
- **步骤**：1. POST /api/projects/web/requirements {title:"需求一", source:"inbox:1", module:"auth", priority:"P2"}。
- **预月果**：201；data.id="REQ-web-001"（`01-数据规范 §1.5`）、data.path、data.mtimeMs；frontmatter 符合 01 §1.2。

### TC-05-011 POST requirements 缺 title（异常）
- **功能点**：`05-server §2.5` E_USAGE/E_VALIDATION（`01-数据规范 §1.2` title 必填）
- **优先级**：P1
- **类型**：集成
- **前置条件**：项目 web 存在
- **步骤**：1. POST /api/projects/web/requirements {source:"human"}。
- **预月果**：400/422（E_USAGE 或 E_VALIDATION, field=title）。

### TC-05-012 POST requirements 默认 status=pool（正常）
- **功能点**：`05-server §2.5` status default pool（`01-数据规范 §1.2`；R-112 创建端点默认 pool）
- **优先级**：P0
- **类型**：集成
- **前置条件**：项目 web 存在
- **步骤**：1. POST 不带 status。
- **预月果**：201；frontmatter.status="pool"。

### TC-05-013 GET /api/requirements/:id（正常）
- **功能点**：`05-server §2.6` 需求详情（反链 relatedTasks，`01-数据规范 §6.3`）
- **优先级**：P0
- **类型**：集成
- **前置条件**：REQ-web-001 与一个 TASK 关联
- **步骤**：1. GET /api/requirements/REQ-web-001。
- **预月果**：200；data.requirement（含 mtimeMs）、data.relatedTasks[]（TASK id 升序）。

### TC-05-014 GET /api/requirements/:id 404（异常）
- **功能点**：`05-server §2.6` E_NOT_FOUND
- **优先级**：P1
- **类型**：集成
- **前置条件**：无
- **步骤**：1. GET /api/requirements/REQ-web-999。
- **预月果**：404，E_NOT_FOUND。

### TC-05-015 PATCH /api/requirements/:id 流转（正常）
- **功能点**：`05-server §2.7` 状态流转（`02-core services/moveStatus`；`01-数据规范 §3.2`）
- **优先级**：P0
- **类型**：集成
- **前置条件**：REQ-web-001 status=pool
- **步骤**：1. PATCH /api/requirements/REQ-web-001 {status:"reviewing", expectedMtimeMs: M0}。
- **预月果**：200；data{id, from:"pool", to:"reviewing", updatedField:"updated", mtimeMs}；frontmatter.updated=<today>。

### TC-05-016 PATCH 非法流转 409（异常）
- **功能点**：`05-server §2.7` E_INVALID_TRANSITION(409)（`01-数据规范 §3.2/§3.4`）
- **优先级**：P1
- **类型**：集成
- **前置条件**：REQ-web-001 status=pool（pool→done 非法）
- **步骤**：1. PATCH {status:"done", expectedMtimeMs: M0}。
- **预月果**：409；error.code="E_INVALID_TRANSITION"。

### TC-05-017 PATCH 缺 status 400（异常）
- **功能点**：`05-server §2.7` E_USAGE(400)（`02-core §3.1`）
- **优先级**：P1
- **类型**：集成
- **前置条件**：REQ-web-001
- **步骤**：1. PATCH /api/requirements/REQ-web-001 {}。
- **预月果**：400，E_USAGE。

### TC-05-018 PATCH mtime 冲突 409（并发）
- **功能点**：`05-server §2.7` E_CONFLICT(409)（R-103，`02-core §4.7.1`）
- **优先级**：P1
- **类型**：集成
- **前置条件**：REQ-web-001 已被外部修改
- **步骤**：1. 外部修改；2. PATCH {status:"reviewing", expectedMtimeMs: M0}。
- **预月果**：409；error{code:"E_CONFLICT", expectedMtimeMs: M0, currentMtimeMs: 实际}（`05-server §6.4`）。

### TC-05-019 POST /api/requirements/:id/derive-task（正常）
- **功能点**：`05-server §2.8` 派生任务（默认 due=today+7，Q-07；status=todo；`01-数据规范 §3.2`）
- **优先级**：P0
- **类型**：集成
- **前置条件**：REQ-web-001 status=accepted
- **步骤**：1. POST /api/requirements/REQ-web-001/derive-task {title? 覆盖, due? 覆盖}。
- **预月果**：201；data{requirementId:"REQ-web-001", task:{id:"TASK-web-001", status:"todo", due: 今天+7}, created{id, path}}。

### TC-05-020 derive-task 非 accepted 409（异常）
- **功能点**：`05-server §2.8` E_INVALID_TRANSITION（`01-数据规范 §3.2`，触发状态只接受 accepting）
- **优先级**：P1
- **类型**：集成
- **前置条件**：REQ-web-001 status=pool
- **步骤**：1. POST derive-task。
- **预月果**：409，E_INVALID_TRANSITION。

### TC-05-021 derive-task 编号耗尽 409（异常）
- **功能点**：`05-server §2.8` E_SEQ_EXHAUSTED；`01-数据规范 §1.5`
- **优先级**：P2
- **类型**：集成
- **前置条件**：项目已有 TASK-web-999
- **步骤**：1. 先创建 REQ-web-002（为 accepted）；2. POST /api/requirements/REQ-web-002/derive-task。
- **预月果**：409，E_SEQ_EXHAUSTED。

### TC-05-022 GET /api/projects/:slug/tasks（正常）
- **功能点**：`05-server §3.1` 任务列表（看板分组，`06-web §2.2`）
- **优先级**：P0
- **类型**：集成
- **前置条件**：项目 web 有任务
- **步骤**：1. GET /api/projects/web/tasks。
- **预月果**：200；data.tasks[]（Task & {mtimeMs}）。

### TC-05-023 GET /api/projects/:slug/tasks 空（正常）
- **功能点**：`05-server §3.1` 空列表
- **优先级**：P1
- **类型**：集成
- **前置条件**：项目 web 无任务
- **步骤**：1. GET。
- **预月果**：200，tasks=[]。

### TC-05-024 POST /api/projects/:slug/tasks（201）
- **功能点**：`05-server §3.2` 新建任务（Zod `01-数据规范 §1.3`）
- **优先级**：P0
- **类型**：集成
- **前置条件**：REQ-web-001 存在
- **步骤**：1. POST /api/projects/web/tasks {title:"任务一", requirement:"[[REQ-web-001]]", due:"2026-11-30", priority:"P1"}。
- **预月果**：201；data.created{id:"TASK-web-001", path, mtimeMs}，data.task 合规。

### TC-05-025 POST tasks requirement 目标不存在 422（异常）
- **功能点**：`05-server §3.2` 外键校验（§3.1 dangling）→ E_VALIDATION(422)
- **优先级**：P1
- **类型**：集成
- **前置条件**：无
- **步骤**：1. POST /api/projects/web/tasks {title, requirement:"[[REQ-web-999]]", due:"2026-11-30"}。
- **预月果**：422，E_VALIDATION（`01-数据规范 §6.2`）。

### TC-05-026 POST tasks 缺 due 422（异常）
- **功能点**：`05-server §3.2` due 必填（Q-02，`01-数据规范 §1.3`）
- **优先级**：P1
- **类型**：集成
- **前置条件**：REQ-web-001 存在
- **步骤**：1. POST 缺 due。
- **预月果**：422（E_USAGE 或 E_VALIDATION）。

### TC-05-027 PATCH /api/tasks/:id 流转（正常）
- **功能点**：`05-server §3.3` 状态流转（同源 `01-数据规范 §3.3`）
- **优先级**：P0
- **类型**：集成
- **前置条件**：TASK-web-001 status=todo
- **步骤**：1. PATCH /api/tasks/TASK-web-001 {status:"doing", expectedMtimeMs: M0}。
- **预月果**：200；data{id, from:"todo", to:"doing", updatedField:"updated", mtimeMs}。

### TC-05-028 PATCH /api/tasks/:id 404（异常）
- **功能点**：`05-server §3.3` E_NOT_FOUND
- **优先级**：P1
- **类型**：集成
- **前置条件**：无
- **步骤**：1. PATCH /api/tasks/TASK-web-999 {status:"doing"}。
- **预月果**：404，E_NOT_FOUND。

### TC-05-029 PATCH tasks 非法流转 409（异常）
- **功能点**：`05-server §3.3` E_INVALID_TRANSITION
- **优先级**：P1
- **类型**：集成
- **前置条件**：TASK-web-001 status=doing
- **步骤**：1. PATCH {status:"todo"}（doing→todo 非法，`01-数据规范 §3.3`）。
- **预月果**：409，E_INVALID_TRANSITION。

### TC-05-030 PATCH tasks mtime 冲突 409（并发）
- **功能点**：`05-server §3.3` E_CONFLICT；R-103（`02-core §4.7.1`）
- **优先级**：P1
- **类型**：集成
- **前置条件**：TASK-web-001 已被外部修改
- **步骤**：1. PATCH {status:"doing", expectedMtimeMs: M0}。
- **预月果**：409，error.code="E_CONFLICT"（`05-server §6.4`）。

### TC-05-031 PATCH todo→done 设置 completed（正常）
- **功能点**：`01-数据规范 §3.3` todo→done（completed=今天）
- **优先级**：P0
- **类型**：集成
- **前置条件**：TASK-web-001 status=todo
- **步骤**：1. PATCH {status:"done", expectedMtimeMs}。
- **预月果**：200；data.updatedField="updated+completed"；frontmatter.completed=<today>。

### TC-05-032 GET /api/tasks/:id（正常）
- **功能点**：`05-server §3.4` 任务详情（relatedRequirement，`01-数据规范 §6.1`）
- **优先级**：P0
- **类型**：集成
- **前置条件**：TASK-web-001
- **步骤**：1. GET /api/tasks/TASK-web-001。
- **预月果**：200；data.task（含 mtimeMs）、data.relatedRequirement{id, status, ...}。

### TC-05-033 GET /api/tasks/:id 404（异常）
- **功能点**：`05-server §3.4` E_NOT_FOUND
- **优先级**：P1
- **类型**：集成
- **前置条件**：无
- **步骤**：1. GET /api/tasks/TASK-web-999。
- **预月果**：404，E_NOT_FOUND。

### TC-05-034 GET /api/search?q=（正常）
- **功能点**：`05-server §4.1` 检索；`02-core services/search.ts`（title/relPath 子串，全小写，稳定排序）
- **优先级**：P0
- **类型**：集成
- **前置条件**：vault 有项目/需求/任务
- **步骤**：1. GET /api/search?q=web（`05-server §4.1`，`02-core §2.6`）。
- **预月果**：200；data.results[] 含 id/type/slug/relPath/title；默认 limit=10，类型全部包含。

### TC-05-035 search 空 q（异常）
- **功能点**：`05-server §4.1` q 必填非空
- **优先级**：P1
- **类型**：集成
- **前置条件**：无
- **步骤**：1. GET /api/search?q=（空）。
- **预月果**：400/422 E_USAGE。

### TC-05-036 GET /api/events SSE 正常（正常）
- **功能点**：`05-server §5.1-§5.3` SSE；Q-08 心跳 15s（`vault:ping`）
- **优先级**：P0
- **类型**：集成
- **前置条件**：有订阅者
- **步骤**：1. GET /api/events（`05-server §5.2`）。
- **预月果**：连接后收到 event:connected，data:{revision}；空推送 event:vault:ping（约 15s）；外部修改后 event:vault:updated{changes:[{op, path}]}。

### TC-05-037 SSE changes 合并规则（正常）
- **功能点**：`05-server §5.4` 相同 path 只保留最后 op；unlink→add 合并为 change
- **优先级**：P2
- **类型**：集成
- **前置条件**：多次外部写同一 path
- **步骤**：1. 触发 ≥2 次同路径变更（防抖 250ms，`02-core §5.5`）。
- **预月果**：vault:updated 中同路径仅保留最后一个 op；unlink+add 合并为 change。

### TC-05-038 错误信封统一（异常）
- **功能点**：`05-server §1.1` 响应外壳 {ok, error{code, message, file?, field?, issues?}}（R-115）
- **优先级**：P1
- **类型**：集成
- **前置条件**：任一发生错误
- **步骤**：1. GET /api/projects/nope/overview。
- **预月果**：404，body.ok=false，body.error.code="E_NOT_FOUND"。

### TC-05-039 静态托管与 SPA fallback（正常）
- **功能点**：`05-server §7.1` apps/web/dist 托管；非 /api/* → index.html
- **优先级**：P0
- **类型**：集成
- **前置条件**：apps/web/dist 存在
- **步骤**：1. GET / → index.html；2. GET /p/web → index.html；3. GET /nonexistent.css → 404 文件缺失。
- **预月果**：前两者 200 返回 HTML；第三者 404。

### TC-05-040 POST 非法 body（异常）
- **功能点**：`05-server §1.2` 请求体 Zod 失败 → E_VALIDATION(422)
- **优先级**：P2
- **类型**：集成
- **前置条件**：项目 web 存在
- **步骤**：1. POST /api/projects/web/requirements {title:"", source:"x"}。
- **预月果**：422，E_VALIDATION（`02-core §3.1`）。

### TC-05-041 derive-task 自定义 due（正常）
- **功能点**：`05-server §2.8` 请求体可覆盖 title/due（`05-server §2.8` ZDeriveTask）
- **优先级**：P2
- **类型**：集成
- **前置条件**：REQ-web-003 status=accepted
- **步骤**：1. POST derive-task {due:"2026-12-31"}。
- **预月果**：201；新任务 due=2026-12-31，title=从 requirement 推导（可覆盖），priority=需求 priority（Q-07 自定义 due 保留需求仓库的任意 due）。
