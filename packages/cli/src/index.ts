#!/usr/bin/env node
import { Command } from "commander";
import { CORE_NAME, CORE_VERSION } from "@pm/core";
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

const program = new Command();
program.name("pm").description(`${CORE_NAME} 台账 CLI`).version(CORE_VERSION);

/** `pm` 无参数/未知命令 → 输出全命令表，退出码 2（03-cli §1.2, TC-03-042） */
function printCommands(): void {
  console.log(
    "pm 命令表（03-cli §1.2）:\n" +
      "  validate\t全部/指定文件校验（03-cli §2）\n" +
      "  new project|requirement|task\t脚手架：自动分配编号、生成合规模板（03-cli §3）\n" +
      "  move <id> --status <new>\t状态流转（03-cli §4）\n" +
      "  stats\t聚合统计（03-cli §5）\n" +
      "  check\t一致性检查（待后续阶段）\n" +
      "  inbox\tinbox 整理（待后续阶段）\n" +
      "  serve\t启动 Web 服务（待后续阶段）",
  );
}

const args = process.argv.slice(2);
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
program
  .command("validate")
  .description("校验全部/指定文件（03-cli §2）")
  .argument("[files...]")
  .option("--json", "结构化输出（03-cli §2.2）")
  .action(async (files: string[], opts: { json?: boolean }) => {
    const a: ValidateArgs = { files, json: !!opts.json };
    process.exitCode = await runValidate(a);
  });

// new（03-cli §3）：逐子命令注册
const newCmd = program.command("new").description("新建脚手架：项目/需求/任务（03-cli §3）");
newCmd
  .command("project")
  .description("新建项目（03-cli §3.1）")
  .option("--name <name>", "项目名（必填）")
  .option("--slug <slug>", "显式覆盖 slug")
  .option("--period <start...>", "period 起止（≥2 个；默认 [今天, 今天]，R-107）")
  .option("--tags <t1,t2>", "逗号分隔标签（默认 []）")
  .option("--tag <t1,t2>", "--tags 别名（TC-03-006）")
  .option("--status <status>", "项目状态（默认 active）")
  .option("--json", "结构化输出（03-cli §3.1）")
  .action(async (opts: NewProjectOpts) => {
    process.exitCode = await runNewProject(opts);
  });
newCmd
  .command("requirement")
  .description("新建需求（03-cli §3.2）")
  .option("--slug <slug>", "目标项目 slug（必填，项目目录必须已存在）")
  .option("--title <title>", "需求标题（必填）")
  .option("--module <module>", "归属模块（默认 \"\"）")
  .option("--source <source>", "来源描述（默认 human，R-102）")
  .option("--priority <p>", "优先级（默认 P2）")
  .option("--status <status>", "状态（默认 pool）")
  .option("--json", "结构化输出（03-cli §3.2）")
  .action(async (opts: NewRequirementOpts) => {
    process.exitCode = await runNewRequirement(opts);
  });
newCmd
  .command("task")
  .description("新建任务（03-cli §3.3）")
  .option("--slug <slug>", "项目 slug（必填）")
  .option("--requirement <REQ id>", "关联需求 id（必填，需已存在）")
  .option("--title <title>", "任务标题（必填）")
  .option("--priority <p>", "优先级（默认 P2）")
  .option("--due <date>", "截止日期（必填，ISO 日期）")
  .option("--status <status>", "状态（默认 todo）")
  .option("--json", "结构化输出（03-cli §3.3）")
  .action(async (opts: NewTaskOpts) => {
    process.exitCode = await runNewTask(opts);
  });

// move（03-cli §4）
program
  .command("move")
  .description("状态流转（03-cli §4）")
  .argument("[id]", "REQ/TASK/project id")
  .option("-s, --status <status>", "目标状态（必填）")
  .option("--json", "结构化输出（03-cli §4.2）")
  .action(async (id: string | undefined, opts: { json?: boolean; status?: string }) => {
    process.exitCode = await runMove({ id, status: opts.status, json: !!opts.json });
  });

// stats（03-cli §5）
program
  .command("stats")
  .description("聚合统计（03-cli §5）")
  .option("--json", "结构化输出（03-cli §5.2）")
  .action(async (opts: { json?: boolean }) => {
    process.exitCode = await runStats({ json: !!opts.json });
  });

// 占位：check / inbox / serve（待后续阶段实现）
for (const name of ["check", "inbox", "serve"] as const) {
  program.command(name).description(`${name}（占位，待后续阶段实现）`).action(() => {
    console.error(`${name} 尚未实现`);
    process.exitCode = 2;
  });
}

await program.parseAsync(process.argv);
