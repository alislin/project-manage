# 05 · REST API 详设

> 依据：`docs/00-plan-final.md`（唯一事实来源，接口清单 §5 REST 草案：`GET/POST /api/projects`、`GET /api/projects/:slug/overview`、`GET/POST /api/projects/:slug/requirements`、`PATCH /api/requirements/:id`、`POST /api/requirements/:id/derive-task`、`GET/POST /api/projects/:slug/tasks`、`PATCH /api/tasks/:id`、`GET /api/search?q=`、`GET /api/events`）
> 契约参考：`docs/design/01-数据规范.md`（Zod、状态机）、`docs/design/02-core.md`（Stats、VaultIndex、错误模型、atomicWriteFile）、`docs/design/03-cli.md`（退出码）

---

## 1. 通用约定

### 1.1 请求/响应结构（统一）

```ts
// 响应通用结构
{
  ok: boolean;              // true（成功）/ false（失败）
  data?: T;                 // 成功载荷
  error?: {
    code: string;           // 02-core §3.1 错误码
    message: string;
    file?: string;          // 精确到绝对路径
    field?: string;         // 字段路径
    issues?: Array<{ file: string; field: string; code: string; message: string }>;
  };
}

// 带冲突详情的特例（409）
error.code = "E_CONFLICT";
error.file, error.expectedMtimeMs, error.currentMtimeMs  // §6.5
```

- 成功状态码：`200`（GET/PATCH/POST）、`201`（POST 创建）。
- 错误状态码：见 §6.5 表（核心错误码 ↔ HTTP 状态，统一 CLI 退出码映射）。
- 时间字段格式：`YYYY-MM-DD`（ISO 日期）。
- 时间戳：ISO 8601 UTC（`createdAt` 之外，详见 02-core §2.2 `FileEntry.mtimeMs`，冲突检测用）。
- `mtimeMs`：核心业务响应载荷中嵌入 `{ path, mtimeMs }`（`02-core §2.2/§2.7`），写冲突时的校验基准。
  > **整数毫秒口径**（S5R1 OBS-4）：`mtimeMs` 一律为写盘后 `stat` 的取整值（`Math.round`，整数毫秒）。
  > Windows/NTFS 原生返回浮点（如 `1795144857216.1277`），core `writer.statMtimeMs` 统一取整后再进入
  > 自写缓存/scan/index/响应载荷，保证 JSON 数值稳定、跨平台一致；冲突比较 epsilon（1ms）不受 ≤0.5ms 取整差影响。

### 1.2 错误码 ↔ HTTP 状态表（§6.5，统一 `02-core §3.1` 与 `03-cli §1.3`）

| 核心错误码 | HTTP 状态 | CLI 退出码（`03-cli §1.3`） | 说明 |
|---|---|---|---|
| `E_CONFIG_INVALID` | 500 | 2 | 配置缺失/非法 |
| `E_USAGE` | 400 | 2 | 用法错误（如 `POST /api/projects` 缺 `name`） |
| `E_NOT_FOUND` | 404 | 1 | 资源不存在（id、项目、文件） |
| `E_VALIDATION` | 422 | 4 | Zod/校验失败（精确到 file+field） |
| `E_INVALID_TRANSITION` | 409 | 4 | 非法流转（`01-数据规范 §3`） |
| `E_CONFLICT` | 409 | 3 | mtime 冲突（前端提示重试，§6.5） |
| `E_SEQ_EXHAUSTED` | 409 | 5 | 编号耗尽 |
| `E_IO` | 500 | 1 | 磁盘等 IO 错误 |

> **理由**：`E_USAGE` = 400，`E_VALIDATION` = 422（请求体/校验类），其余与 `02-core §3.1`、`03-cli §1.3` 一致；错误响应 body 固定结构（§1.1），前端不需要分支。

### 1.3 前端请求约定

- 每次写操作带 `expectedMtimeMs`（取自当前数据载荷的 `mtimeMs`）；冲突 → 409 → 前端提示并重新 GET 后让用户确认（§6.5）。
- 读操作附带 `If-None-Match: <etag>`？不做 ETag，改为"本地状态版本号"：`mtimeMs` 作为数据版本（§1.1）。

---

## 2. 项目端点

### 2.1 `GET /api/projects` — 项目列表（含聚合统计）

- 方法：`GET`
- 请求：无
- 响应（`data`）：

```ts
interface ProjectsResponse {
  projects: Array<{
    slug: string;
    name: string;
    status: "active" | "paused" | "done" | "archived";
    period: [string, string];
    tags: string[];
    progress: {                              // 02-core §2.4 Progress
      completedRate: number;                 // 0..1
      overdueCount: number;
      totalTasks: number;
      doneTasks: number;
      cancelledTasks: number;
      onTrack: number;                       // 02-core §2.4
    };
    mtimeMs: number;                         // project.md mtime（冲突检测基准）
  }>;
}
```

- 错误码：`E_CONFIG_INVALID`(500)、`E_IO`(500)
- 理由：`progress` 由 `02-core deriveStats`（§2.4）计算（进度为派生值，`00-plan-final §4.3` 第 2 条）。

### 2.2 `POST /api/projects` — 新建项目

- 请求体（Zod，对应 `01-数据规范 §1.1`）：

```ts
const ZNewProject = z.object({
  slug: z.string().regex(/^[A-Za-z0-9一-鿿]+(-[A-Za-z0-9一-鿿]+)*$/, "slug 规则见 01-数据规范 §1.5"),
  name: z.string().min(1).max(100),
  period: z.tuple([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
  tags: z.array(z.string().min(1)).default([]),
  status: z.enum(["active", "paused", "done", "archived"]).default("active"),
}).refine((v) => v.period[0] <= v.period[1]);
```

- 响应（201）：`{ ok: true, data: { created: { id: string; slug: string; path: string; mtimeMs: number } } }`
- 错误：`E_USAGE`(400) 缺 `name`；`E_VALIDATION`(422) 字段不合法；`E_CONFLICT`(409) `slug` 已存在；`E_SEQ_EXHAUSTED`(409)。

> **理由**：project 的 `id` = `slug`（`00-plan-final §4.2`），响应同时给出 slug 与 path，前端可跳转路由（`06-web` 路由表）。`E_CONFLICT` 用于"slug 已存在"（409 是存在类冲突，语义与普通写冲突一致）。

### 2.3 `GET /api/projects/:slug/overview` — 项目进度总览

- 方法：`GET`
- 响应：

```ts
interface OverviewResponse {
  project: Project & { mtimeMs: number };
  progress: Progress;                         // 02-core §2.4
  totals: {
    requirements: { total: number; byStatus: Partial<Record<ReqStatus, number>> };
    tasks: { total: number; overdue: number; byStatus: Partial<Record<TaskStatus, number>>; onTrack: number };
  };
  periods: { done: number; total: number; rate: number };   // 需求交付漏斗（06-web §7 进度总览：需求交付漏斗 ECharts funnel）
  lastSync?: string;                          // 索引构建时间（`02-core §2.3 builtAt`），可选
}
```

- 错误：`E_NOT_FOUND`(404) slug 不存在。

### 2.4 `GET /api/projects/:slug/requirements` — 需求池列表

- 响应：

```ts
interface RequirementsResponse {
  requirements: Array<Requirement & { mtimeMs: number }>;   // 02-core §2.3 + byPath
  brokenFiles?: Array<{ file: string; field?: string; code: string; message: string }>;  // §2.2 降级可见
}
```

- 理由：`mtimeMs` 用于拖拽流转的冲突检测（§6.4 `PATCH /api/requirements/:id`）。

### 2.5 `POST /api/projects/:slug/requirements` — 新建需求

- 请求体（Zod，对应 `01-数据规范 §1.2`）：

```ts
const ZNewRequirement = z.object({
  title: z.string().min(1).max(200),
  module: z.string().default(""),
  source: z.string().min(1),
  priority: z.enum(["P0", "P1", "P2", "P3"]).default("P2"),
  status: z.enum(["pool", "reviewing", "accepted", "rejected", "done"]).default("pool"),
  created?: z.string(),   // 可选覆盖（默认 today）
  updated?: z.string(),
});
```

- 响应（201）：`{ ok: true, data: { id: string; path: string; mtimeMs: number } }`（`id = REQ-<slug>-NNN`）。
- 错误：`E_NOT_FOUND`(404) 项目不存在；`E_VALIDATION`(422)；`E_SEQ_EXHAUSTED`(409)。

### 2.6 `GET /api/requirements/:id` — 需求详情（新增，供详情面板）

- 响应：

```ts
interface RequirementDetailResponse {
  requirement: Requirement & { mtimeMs: number };
  relatedTasks: Task[];                        // 反链聚合（`01-数据规范 §6.3`, `02-core deriveRequirementTasks`）
}
```

### 2.7 `PATCH /api/requirements/:id` — 状态流转（拖拽/手动状态变更）

> plan §5："PATCH /api/requirements/:id"

- 请求体（Zod，对应 `01-数据规范 §3.2`）：

```ts
const ZPatchRequirement = z.object({
  status: ReqStatus,                            // 合法流转在服务层校验
  expectedMtimeMs: z.number().optional(),       // §1.3 冲突检测基准
});
```

- 处理（`02-core services/moveStatus`，`03-cli §4.4` 同源）：
  1. `byPath` 查找 → `E_NOT_FOUND`(404)。
  2. `isValidTransition`（`01-数据规范 §3.2`）→ `E_INVALID_TRANSITION`(409)。
  3. `atomicWriteFile(expectedMtimeMs)` → `E_CONFLICT`(409)。
  4. `reindexFile`（`02-core §5.4`）。
- 响应：`{ ok: true, data: { id, from, to, updatedField: "updated" | "updated+completed", mtimeMs: number } }`（200）。
- 错误：见上述；`E_USAGE`(400) 无 status。

### 2.8 `POST /api/requirements/:id/derive-task` — 需求派生任务

> plan §5："POST /api/requirements/:id/derive-task # 需求派生任务"

- 逻辑：`requirement.status === "accepted"`（只能派生已接受需求；否则 `E_INVALID_TRANSITION`）；新建任务（`pm new task` 语义）：`title` 取从需求 `title` 推导（或接受可选 `title` 覆盖）、`requirement = "[[REQ-id]]"`、`priority = 需求的`、`due = today + 1 周`（默认；可选 body.due）、`status = todo`、`estimate = 需求.estimate`（未定）。
- 请求体（Zod）：

```ts
const ZDeriveTask = z.object({
  title: z.string().min(1).max(200).optional(),   // 可选覆盖
  due: IsoDate.optional(),                          // 可选覆盖
});
```

- 响应（201）：

```ts
{
  ok: true,
  data: {
    requirementId: string,
    task: Task & { mtimeMs: number },
    created: { id: string; path: string },
  },
}
```

- 错误：`E_NOT_FOUND`(404)；`E_INVALID_TRANSITION`(409) 需求非 accepted；`E_SEQ_EXHAUSTED`(409)。

---

## 3. 任务端点

### 3.1 `GET /api/projects/:slug/tasks` — 任务列表

- 响应：`{ ok: true, data: { tasks: Array<Task & { mtimeMs: number }> } }`。
- 看板分组：前端按 `status` 分组 `todo/doing/done/cancelled`（`06-web §2.2` 任务看板列）。
- 逾期：`overdue = status ∈ {todo, doing} && due < today`（`02-core §2.4`；`today()` = `02-core §8`）。

### 3.2 `POST /api/projects/:slug/tasks` — 新建任务

- 请求体（Zod，对应 `01-数据规范 §1.3`）：

```ts
const ZNewTask = z.object({
  title: z.string().min(1).max(200),
  // slug 段支持连字符（S5R1 ISSUE-3，同源 01-数据规范 §1.5）
  requirement: z.string().regex(/^\[\[REQ-[A-Za-z0-9一-鿿]+(?:-[A-Za-z0-9一-鿿]+)*-\d{3}\]\]$/, "需在同项目已存在的需求上"),
  priority: z.enum(["P0", "P1", "P2", "P3"]).default("P2"),
  due: IsoDate,
  status: z.enum(["todo", "doing", "done", "cancelled"]).default("todo"),
  estimate: z.number().optional().refine((n) => n === undefined || n > 0, "estimate 为正数（人日）"),
});
```

- 外键校验：`requirement` 目标必须存在于同项目（§3.1 dangling 规则），否则 `E_VALIDATION`(422)。
- 响应（201）：`{ ok: true, data: { created: { id: string; path: string; mtimeMs: number }, task: Task } }`。

### 3.3 `PATCH /api/tasks/:id` — 状态流转

- 请求体：`ZPatchTask = z.object({ status: TaskStatus, expectedMtimeMs: z.number().optional() })`（流转副作用 `updated`/`completed` 同 `01-数据规范 §3.3`）。
- 处理与 `2.7` 同构：`02-core services/moveStatus`。
- 响应：`{ ok: true, data: { id, from, to, updatedField, mtimeMs } }`（200）。

### 3.4 `GET /api/tasks/:id` — 任务详情（供 `06-web §3.3` 任务详情面板）

- 响应：

```ts
interface TaskDetailResponse {
  task: Task & { mtimeMs: number };
  relatedRequirement?: Requirement & { mtimeMs: number };   // 任务侧关联需求（反向查询，`01-数据规范 §6.1`）
}
```

- 错误：`E_NOT_FOUND`(404)。

---

## 4. 检索端点

### 4.1 `GET /api/search?q=<term>` — 检索

- 参数：`q`（必填，非空）、`type`（可选：`project|requirement|task|inbox`）、`limit`（可选，1–50，默认 10）。
- 实现：`02-core services/search.ts`（`search(index, q)`，按 `title` 与 `relPath` 子串匹配，区分大小写？全小写比较，稳定排序；理由：中文项目名均为汉字，搜索应对中文匹配）。
- 响应：`{ ok: true, data: { results: SearchResult[] } }`（`02-core §2.6`，含 `highlight`）。

---

## 5. 全局事件通道（SSE）

### 5.1 端点

`GET /api/events` → `text/event-stream`（Node `http` 流，Fastify `reply.hijack()`）。

### 5.2 事件协议

```
// 接入时
event: connected
data: {"revision": 12}

// 连接后立即推送当前版本号；防止客户端解析差异（理由：保证前端事件流确定）

// 变更（每次外部改动 ≥ 防抖窗）
event: vault:updated
data: {
  "changes": [
    { "op": "add" | "change" | "unlink", "path": "projects/proj/requirements/REQ-proj-001.md" }
  ],
  "revision": 13
}

// 运行态心跳（保持连接不挂，约每 15s 一次，为空 data）
event: vault:ping
data: {}
```

- `changes` 合并规则（§5.4）：每个 path 只保留最后操作；`unlink` 后若再出现 `add`，合并为 `change`（避免前端重复删）。
- **重连语义**：
  - 浏览器 `EventSource` 原生重连（默认间隔 ≈3s，指数退避）；前端不手动重连。
  - 重连收到 `connected` 后：前端调 `GET /api/projects` 与 `GET /api/projects/:slug/tasks` 等做**全量刷新**（自建“状态版本”字段 = `mtimeMs`，`06-web` 局部刷新策略），不依赖 `changes` 序列。
  - 为空/短暂分句格式，浏览器自动处理。

### 5.3 SSE 推送时序（跟 plan §3 "≤2s"）

```
Obsidian/云盘修改 → chokidar(防抖 250ms) → core reindexFile（§2-core §5.4）
  → server 合并变更 → SSE 推送（连续 250ms 内的事件合并为一次，再随 event 派发）
  → 前端收到 → 局部刷新（§6.2）
```
- 理由：`02-core §5.5` 防抖 250ms，远优于 plan 的"Obsidian 端修改 → chokidar 触发 → 增量重解析 → SSE 推送前端刷新（≤2s）"（进一步缩短时延）；SSE 先抵达视窗再看板本地刷新（`06-web §6.2`）。

### 5.4 chokidar 增量更新与推送流程（`02-core startWatcher` 接线）

1. Server 启动：`buildIndex(config)`（`02-core §5.1`）；`startWatcher(config, events, { debounceMs: 250 })`（`02-core §4.5`）。
2. `onChange(paths)`：对每个 path 先查索引 `byPath`（`02-core §2.3`）再 `reindexFile(index, path)`（`02-core §5.4`）；同时推送到 SSE 批次（§5.2）。
3. `onUnlink(paths)`：从 `index.byPath` 移除（§5.4 `reindexFile` 处理删除）；推送 `unlink`。
4. Server 持有 `VaultIndex` 唯一实例（`getIndex()` 单例导出自 `02-core` 或 server 内 `let` 全局），`GET` 接口读它。

---

## 6. 并发写冲突处理

### 6.1 流程（`mtime/409/前端提示`，plan §3）

```
1. 前端有数据（带 mtimeMs M0）→ PATCH /api/requirements/REQ-x
   body: { status: "reviewing", expectedMtimeMs: M0 }
2. 服务端：约索引 byPath，stat 当前文件（mtimeMs M1）
3. 若 M1 != M0（或文件已不存在）→ 409 { code: E_CONFLICT, expectedMtimeMs: M0, currentMtimeMs: M1 }
4. 前端：展示提示“文件已被修改，是否重新获取并重试？”+ 兜底"自动刷新并再次重试一次"（用户可撤）
5. 重试：前端 GET 刷新数据（新 M2）→ 重发 PATCH expectedMtimeMs=M2
```

### 6.2 序列化（防止丢更新）

- 服务端维护 `Map<relPath, Promise<void>>` 逐路径写锁队列：`PATCH` 进入时 `await lockQueue.get(relPath)?.catch(()=>{})`，再执行 §6.1 流程，释放锁后排队下一个。
- 这样“同时两个 PATCH”变成“后者以新预期 mtime 检测到冲突，正确提示用户而非盲覆盖”。

### 6.3 前端显示（`06-web §6.3`）

- 409 → 打开"文件已被修改"提示弹窗：含“刷新并重试（推荐）”与“取消”。
- 前端乐观更新策略（`06-web §3.1` 拖拽流转乐观更新）先改本地，`PATCH` 失败 → `rollback()`（本地回滚 + 重新拉取 `GET`）。

### 6.4 服务端 409 body（通用 envelope 的扩展）

```json
{
  "ok": false,
  "error": {
    "code": "E_CONFLICT",
    "message": "文件已被外部修改",
    "file": "E:\\repos\\project-manage\\PM\\projects\\proj\\requirements\\REQ-proj-001.md",
    "expectedMtimeMs": 1710000000000,
    "currentMtimeMs": 1710000100000
  }
}
```

### 6.5 错误码映射总表（§1.2 特化）

| 核心错误码 | HTTP | CLI 退出码 | 生成点（端点） |
|---|---|---|---|
| `E_CONFIG_INVALID` | 500 | 2 | 全局（所有） |
| `E_USAGE` | 400 | 2 | 参数缺失（如 `POST /api/projects` 无 name） |
| `E_NOT_FOUND` | 404 | 1 | 路径中 id 不存在（`GET /api/tasks/TASK-x`） |
| `E_VALIDATION` | 422 | 4 | 请求体 Zod 失败（各 POST/PATCH） |
| `E_INVALID_TRANSITION` | 409 | 4 | `PATCH /api/requirements/:id`（`01-数据规范 §3`） |
| `E_CONFLICT` | 409 | 3 | `PATCH` 写冲突（§6.1-6.4） |
| `E_SEQ_EXHAUSTED` | 409 | 5 | `POST` 创建（`01-数据规范 §1.5`） |
| `E_IO` | 500 | 1 | 各 `GET`/`PATCH` 磁盘错误 |

> **理由**：Web 层"冲突/流转失败"均映射 409，与 `03-cli §1.3`/`02-core §3.1` 同一语义；`E_USAGE` 映射 400（请求格式错误）。

---

## 7. 静态托管与开发代理

### 7.1 生产（`pm serve` 默认模式）

- 启动 Fastify（`fastify@5`，plan §2），`fastify.ready` 后：
  1. 注册所有 API 路由（§2-5）；
  2. `fastify.register(require("@fastify/static"), { root: path.join(__dirname, "../../../apps/web/dist"), index: false })`；
  3. SPA fallback：`fastify.addHook("onRequest", ...)`？不，用 `fastify.setNotFoundHandler`：非 `/api/*`、无扩展名 → 返回 `apps/web/dist/index.html`（`reply.send(fs.readFileSync(...))`），404 HTML 文件 → 404。
- 端口默认 3000（`03-cli §8`）。

### 7.2 开发模式

- `apps/web` 用 Vite：`npm run dev`，在 `vite.config` 里配置：

```ts
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": { target: `http://localhost:3000`, changeOrigin: true },  // 转发到 Fastify
      "/api/events": { target: `http://localhost:3000`, ws: false },   // SSE 透传
    },
  },
});
```
- 或 `pm serve --dev`：Fastify 自身反向代理到 Vite？实现：注册一个 catch-all `onRequest`：若 `req.url.startsWith("/api")` 转发到 `http://localhost:5173`（用 `@fastify/reply-from`），否则静态/SPA。选方案：Vite proxy 模式（更简单，理由：挂载轻量）。

> **理由**：两种模式都按 `00-plan-final §3` "后端服务按需启动（pm serve）；不开服务时 CLI/MCP 完全可用"，Web 只在开发/访问时启动；Vite proxy 是常见简洁方案。

### 7.3 服务器生命周期

- 启动：`loadConfig → buildIndex → startWatcher(250ms)`；`server.listen({ port, host })`。
- 退出：SIGINT/SIGTERM → `watcher.stop()`、`fastify.close()` → 进程退出码 0。
