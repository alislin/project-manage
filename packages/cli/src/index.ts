#!/usr/bin/env node
import { Command } from "commander";
import { CORE_NAME } from "@pm/core";
import { runValidate, type ValidateArgs } from "./commands/validate.js";
import {
  runNewProject,
  runNewRequirement,
  runNewTask,
  type NewProjectOpts,
  type NewRequirementOpts,
  type NewTaskOpts,
} from "./commands/new.js";
import { runMove } from "./commands/move.js";
import { runStats } from "./commands/stats.js";
import { runCheck } from "./commands/check.js";
import { runInboxList, runInboxProcess, runInboxArchive } from "./commands/inbox.js";

const program = new Command();
program.name("pm").description(`${CORE_NAME} 台账 CLI`).version("0.1.0");

/** 全局 --root（03-cli §1.1）：指定 pm.config.json 所在工程根，覆盖 cwd 解析 */
program.option("--root <path>", "工程根路径（pm.config.json 所在目录，覆盖 cwd 解析，03-cli §1.1）");

/** 子命令级 --root（03-cli §1.1）：`pm <cmd> --root <path>` 与全局形态等价，子命令取值优先 */
function addRootOption(cmd: Command): void {
  cmd.option("--root <path>", "工程根路径（03-cli §1.1，同全局 --root）");
}

/** 解析生效的工程根：子命令级 --root > program 级 --root（03-cli §1.1） */
function resolveRoot(cmdOpts: { root?: string }): string | undefined {
  const globalOpts = program.opts() as { root?: string };
  return cmdOpts.root ?? globalOpts.root;
}

/** `pm` 无参数/未知命令 → 输出全命令表，退出码 2（03-cli §1.2, TC-03-042） */
function printCommands(): void {
  console.log(
    "pm 命令表（03-cli §1.2）:\n" +
      "  validate\t全部/指定文件校验（03-cli §2）\n" +
      "  new project|requirement|task\t脚手架：自动分配编号、生成合规模板（03-cli §3）\n" +
      "  move <id> --status <new>\t状态流转（03-cli §4）\n" +
      "  stats\t聚合统计（03-cli §5）\n" +
      "  check\t一致性检查（03-cli §6）\n" +
      "  inbox list|process|archive\tinbox 整理（03-cli §7）\n" +
      "  serve\t启动 Web 服务（待后续阶段）\n" +
      "全局选项: --json（结构化输出）、--root <path>（工程根，03-cli §1.1）",
  );
}

// 预扫描前剔除全局 --root（含取值），保证 `pm --root <path> <cmd>` 也能被命令表校验识别
const rawArgs = process.argv.slice(2);
const args: string[] = [];
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a === "--root") {
    i++; // 跳过取值
    continue;
  }
  if (a.startsWith("--root=")) continue;
  args.push(a);
}

const first = args[0];
if (args.length === 0) {
  printCommands();
  process.exit(2);
}
if (first !== "-h" && first !== "--help" && first !== "-v" && first !== "--version") {
  const known = new Set(["validate", "new", "move", "stats", "check", "inbox", "serve"]);
  if (!known.has(first)) {
    printCommands();
    process.exit(2);
  }
  if (first === "new" && !["project", "requirement", "task"].includes(args[1] ?? "")) {
    console.error("用法: pm new <project|requirement|task> [flags]");
    process.exit(2);
  }
}

// validate（03-cli §2）
{
  const cmd = program
    .command("validate")
    .description("校验全部/指定文件（03-cli §2）")
    .argument("[files...]")
    .option("--json", "结构化输出（03-cli §2.2）");
  addRootOption(cmd);
  cmd.action(async (files: string[], opts: { json?: boolean; root?: string }) => {
    const a: ValidateArgs = { files, json: !!opts.json, root: resolveRoot(opts) };
    process.exitCode = await runValidate(a);
  });
}

// new（03-cli §3）：逐子命令注册
const newCmd = program.command("new").description("新建脚手架：项目/需求/任务（03-cli §3）");
{
  const cmd = newCmd
    .command("project")
    .description("新建项目（03-cli §3.1）")
    .option("--name <name>", "项目名（必填）")
    .option("--slug <slug>", "显式覆盖 slug")
    .option("--period <start...>", "period 起止（≥2 个；默认 [今天, 今天]，R-107）")
    .option("--tags <t1,t2>", "逗号分隔标签（默认 []）")
    .option("--tag <t1,t2>", "--tags 别名（TC-03-006）")
    .option("--status <status>", "项目状态（默认 active）")
    .option("--json", "结构化输出（03-cli §3.1）");
  addRootOption(cmd);
  cmd.action(async (opts: NewProjectOpts & { root?: string }) => {
    process.exitCode = await runNewProject({ ...opts, root: resolveRoot(opts) });
  });
}
{
  const cmd = newCmd
    .command("requirement")
    .description("新建需求（03-cli §3.2）")
    .option("--slug <slug>", "目标项目 slug（必填，项目目录必须已存在）")
    .option("--title <title>", "需求标题（必填）")
    .option("--module <module>", "归属模块（默认 \"\"）")
    .option("--source <source>", "来源描述（默认 human，R-102）")
    .option("--priority <p>", "优先级（默认 P2）")
    .option("--status <status>", "状态（默认 pool）")
    .option("--json", "结构化输出（03-cli §3.2）");
  addRootOption(cmd);
  cmd.action(async (opts: NewRequirementOpts & { root?: string }) => {
    process.exitCode = await runNewRequirement({ ...opts, root: resolveRoot(opts) });
  });
}
{
  const cmd = newCmd
    .command("task")
    .description("新建任务（03-cli §3.3）")
    .option("--slug <slug>", "项目 slug（必填）")
    .option("--requirement <REQ id>", "关联需求 id（必填，需已存在）")
    .option("--title <title>", "任务标题（必填）")
    .option("--priority <p>", "优先级（默认 P2）")
    .option("--due <date>", "截止日期（必填，ISO 日期）")
    .option("--status <status>", "状态（默认 todo）")
    .option("--json", "结构化输出（03-cli §3.3）");
  addRootOption(cmd);
  cmd.action(async (opts: NewTaskOpts & { root?: string }) => {
    process.exitCode = await runNewTask({ ...opts, root: resolveRoot(opts) });
  });
}

// move（03-cli §4）
{
  const cmd = program
    .command("move")
    .description("状态流转（03-cli §4）")
    .argument("[id]", "REQ/TASK/project id")
    .option("-s, --status <status>", "目标状态（必填）")
    .option("--json", "结构化输出（03-cli §4.2）");
  addRootOption(cmd);
  cmd.action(async (id: string | undefined, opts: { json?: boolean; status?: string; root?: string }) => {
    process.exitCode = await runMove({ id, status: opts.status, json: !!opts.json, root: resolveRoot(opts) });
  });
}

// stats（03-cli §5）
{
  const cmd = program
    .command("stats")
    .description("聚合统计（03-cli §5）")
    .option("--json", "结构化输出（03-cli §5.2）");
  addRootOption(cmd);
  cmd.action(async (opts: { json?: boolean; root?: string }) => {
    process.exitCode = await runStats({ json: !!opts.json, root: resolveRoot(opts) });
  });
}

// check（03-cli §6）
{
  const cmd = program
    .command("check")
    .description("一致性检查：悬空 wiki-link/编号冲突/日期倒挂等（03-cli §6）")
    .option("--json", "结构化输出（03-cli §6.3）");
  addRootOption(cmd);
  cmd.action(async (opts: { json?: boolean; root?: string }) => {
    process.exitCode = await runCheck({ json: !!opts.json, root: resolveRoot(opts) });
  });
}

// inbox（03-cli §7）：list / process / archive
const inboxCmd = program.command("inbox").description("inbox 收集箱整理（03-cli §7）");
inboxCmd.action(() => {
  console.error("用法: pm inbox <list|process|archive> [flags]（03-cli §7.1）");
  process.exitCode = 2;
});
{
  const cmd = inboxCmd
    .command("list")
    .description("列出未归档 inbox 条目（03-cli §7.2）")
    .option("--json", "结构化输出（03-cli §7.2）");
  addRootOption(cmd);
  cmd.action(async (opts: { json?: boolean; root?: string }) => {
    process.exitCode = await runInboxList({ json: !!opts.json, root: resolveRoot(opts) });
  });
}
{
  const cmd = inboxCmd
    .command("process")
    .description("预览待处理条目（默认前 20 条，03-cli §7.3）")
    .option("--limit <n>", "条数上限（默认 20）", (v: string) => Number.parseInt(v, 10))
    .option("--all", "不限条数")
    .option("--dry-run", "只预览不写入")
    .option("--json", "结构化输出（03-cli §7.3）");
  addRootOption(cmd);
  cmd.action(async (opts: { limit?: number; all?: boolean; dryRun?: boolean; json?: boolean; root?: string }) => {
    process.exitCode = await runInboxProcess({
      limit: Number.isNaN(opts.limit) ? undefined : opts.limit,
      all: !!opts.all,
      dryRun: !!opts.dryRun,
      json: !!opts.json,
      root: resolveRoot(opts),
    });
  });
}
{
  const cmd = inboxCmd
    .command("archive")
    .description("归档条目到 inbox/archive/（03-cli §7.4）")
    .argument("[id]", "INBOX 条目 id")
    .option("--json", "结构化输出（03-cli §7.4）");
  addRootOption(cmd);
  cmd.action(async (id: string | undefined, opts: { json?: boolean; root?: string }) => {
    process.exitCode = await runInboxArchive({ id, json: !!opts.json, root: resolveRoot(opts) });
  });
}

// 占位：serve（待后续阶段实现）
program.command("serve").description("serve（占位，待后续阶段实现）").action(() => {
  console.error("serve 尚未实现");
  process.exitCode = 2;
});

await program.parseAsync(process.argv);
