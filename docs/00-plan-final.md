# PM 台账 · 方案定稿（唯一事实来源）

> 本文档是多代理设计与审核流程的唯一事实来源（Single Source of Truth）。
> 所有设计产出不得与本文已定案内容冲突；遇到歧义或本文未覆盖的决策点，写入 `docs/design/open-questions.md` 上报，**不得自行变更定案内容**。

## 1. 项目定位

- **面向个人的多项目管理台账**：需求池管理、任务跟进、进度总览。
- **数据即知识库**：全部项目数据以 Markdown 存储于用户的 Obsidian Vault，Obsidian 打开即知识库，应用打开即台账。
- **Agent-first**：需求整理与台账维护主要由 AI 代理完成（通过 CLI / MCP），人通过 Web UI 查看进度并保留完整看板交互能力。
- 运行环境：Windows 单用户；代理运行于 Herdr 终端环境（仅作背景了解，本项目不与 Herdr 集成）。

## 2. 技术栈（已定案）

| 层 | 选型 |
|---|---|
| 语言 | TypeScript，Node.js 20+ |
| 后端 | Fastify 5 |
| 文件处理 | gray-matter（frontmatter）、remark + mdast（正文与 wiki-link 解析）、chokidar（文件监听） |
| 校验 | Zod（frontmatter schema） |
| 前端 | Vite + Vue 3（Composition API + `<script setup>`）+ Pinia |
| 样式 | SCSS（dart-sass，7-1 架构） |
| 图表 | ECharts（按需引入） |
| 看板拖拽 | vuedraggable 或同类方案 |
| CLI | commander |
| 测试 | vitest |
| 工程结构 | npm workspaces monorepo |

## 3. 总体架构（已定案）

三个操作接口共享同一个核心库 `@pm/core`，保证行为一致：

```
操作接口（三个，同一核心）
  AI 代理: MCP 工具（如 OpenCode）    人（浏览器）: Web 看板    人（终端）: pm CLI
        └──────────────┬──────────────────┴──────────────┘
                       │
        @pm/core（TypeScript 核心库）
        Zod schema · 状态机 · 扫描/解析 · 编号分配 · 统计聚合 · 原子写
                       │
        Obsidian Vault（唯一数据源）
        PM/ ├ inbox/（收集箱）├ _config.md └ projects/
```

- `@pm/core` 是唯一业务实现，CLI、MCP、Web 后端均为薄封装。
- 后端服务按需启动（`pm serve`）；不开服务时 CLI/MCP 完全可用。
- 双向同步：应用写 → 落盘 → watcher 自忽略；Obsidian 端修改 → chokidar 触发 → 增量重解析 → SSE 推送前端刷新（≤2s）。

## 4. 数据规范（已定案方向，字段级细节由详设补充）

### 4.1 目录结构（Vault 内约定）

```
<用户 Obsidian Vault>/          ← pm.config.json 配置 vaultPath
└── PM/
    ├── WORKFLOW.md             # 代理操作 SOP
    ├── _config.md              # 全局配置（编号规则、状态枚举、优先级定义）
    ├── inbox/                  # 收集箱：人随手丢想法，代理整理成规范需求
    └── projects/
        └── <project-slug>/     # 项目目录名即 slug
            ├── project.md      # 项目主页
            ├── requirements/   # 需求池：一需求一文件 REQ-<slug>-NNN.md
            ├── tasks/          # 任务：一任务一文件 TASK-<slug>-NNN.md
            └── journal/        # 项目日志（应用只读不管理）
```

### 4.2 Frontmatter Schema（已定案字段，详设补充约束细节）

**project.md**
```yaml
type: project
id: <slug>
name: string
status: active | paused | done | archived
period: [start, end]
tags: string[]
```

**requirement（REQ-<slug>-NNN.md）**
```yaml
type: requirement
id: REQ-<slug>-NNN
title: string
status: pool | reviewing | accepted | rejected | done
priority: P0 | P1 | P2 | P3
module: string
source: string
created: date
updated: date
```

**task（TASK-<slug>-NNN.md）**
```yaml
type: task
id: TASK-<slug>-NNN
title: string
status: todo | doing | done | cancelled
requirement: "[[REQ-<slug>-NNN]]"   # wiki-link 关联需求
priority: P0 | P1 | P2 | P3
estimate: number        # 人日，可选
due: date
completed: date | null
created: date
updated: date
```

### 4.3 关键规则（已定案）

- **单写原则**：任务→需求的关联只写在任务侧（`requirement` 字段）；需求的关联任务列表由后端解析反链聚合，不落盘。
- **进度为派生值**：完成率、交付率全部实时计算，不写入任何 md 文件。
- **编号**：`<前缀>-<项目slug>-<三位序号>`，由 core 统一分配；Obsidian 手建的无编号文件降级展示为"未识别编号"，不崩溃。
- **状态机**：状态枚举如上；合法流转表由详设定义，非法流转必须被拒绝并给出原因。
- **原子写**：临时文件 + `fs.rename`；写前比对 mtime，冲突返回 409 由前端提示。
- **降级策略**：frontmatter 校验失败（Zod）的文件进入"待修复"清单，UI 提示但不崩溃。

## 5. 接口清单（已定案）

### CLI（`pm` 命令，全部支持 `--json` 结构化输出）

```
pm validate [--json]          # 校验全部/指定文件，报错精确到 file+field
pm new project|req|task       # 脚手架：自动分配编号、生成合规模板
pm move <id> --status X       # 状态流转：校验状态机，自动维护 updated/completed
pm stats [--json]             # 聚合统计：进度、逾期、各状态数量
pm check                      # 一致性检查：悬空 wiki-link、孤儿任务、编号冲突、日期倒挂
pm inbox process              # inbox 整理辅助
pm serve                      # 启动 Web 服务
```

### MCP 工具

`pm_validate / pm_create / pm_move / pm_stats / pm_check` 等，与 CLI 同核同语义，详设定义工具清单与 schema。

### REST API（草案，详设定稿）

```
GET    /api/projects                       # 项目列表（含聚合统计）
POST   /api/projects
GET    /api/projects/:slug/overview        # 单项目进度总览
GET    /api/projects/:slug/requirements
POST   /api/projects/:slug/requirements
PATCH  /api/requirements/:id
POST   /api/requirements/:id/derive-task   # 需求派生任务
GET    /api/projects/:slug/tasks
POST   /api/projects/:slug/tasks
PATCH  /api/tasks/:id
GET    /api/search?q=
GET    /api/events                         # SSE：vault 变更推送
```

## 6. Web UI（已定案：保留完整看板交互）

- 路由：`/` 多项目总览卡片墙（状态、进度环、逾期数）；`/p/:slug` 项目工作台，Tab 切换：需求池四栏看板（pool/reviewing/accepted/done+rejected，拖拽流转）、任务看板（todo/doing/done/cancelled 拖拽，逾期标红）、任务列表（筛选/排序）、进度总览（ECharts：完成率环形、趋势、需求交付漏斗）。
- SCSS 7-1 架构（abstracts/base/components/layout/pages/themes），亮暗主题，BEM 命名，状态/优先级语义色由 CSS 变量管理。

## 7. 工程结构（已定案）

```
project-manage/
├── pm.config.json          # { vaultPath, pmRoot }
├── AGENTS.md               # 代理数据字典
├── package.json            # workspaces
├── packages/
│   ├── core/               # @pm/core
│   ├── cli/                # pm 命令
│   ├── mcp/                # MCP server
│   └── server/             # Fastify API + 静态托管（pm serve 复用）
└── apps/
    └── web/                # Vue3 + Vite + SCSS
```

## 8. 里程碑（已定案）

| 阶段 | 交付 | 退出标准 |
|---|---|---|
| M1 | 数据规范 + AGENTS.md/WORKFLOW.md + @pm/core + CLI(validate/new/move/stats) | 指向真实 vault 可校验、可建文件、可流转；Obsidian 正常打开 |
| M2 | inbox 模式 + pm check | 代理端到端跑通"丢想法→规范需求→派生任务" |
| M3 | pm serve + Web UI 全部页面 | Obsidian 改 → UI ≤2s 刷新；UI 改 → 文件合规 |
| M4 | MCP Server + 代理工作流模板（整理/派生/巡检/周报） | 代理挂载 MCP 后免文档即可操作台账 |

## 9. 非目标（已定案）

- 不做多用户 / 权限系统
- 不使用任何数据库
- 不与 Herdr 深度集成
- 不做移动端
