/**
 * 启动参数解析（任务书第 4 条：--root 启动参数指定工程根，03-cli §1.1 同语义）。
 * 支持 `--root <path>` 与 `--root=<path>`；缺省 = cwd（loadConfig 默认解析）。
 */
export interface LaunchArgsOk {
  ok: true;
  /** 工程根（undefined = cwd） */
  root?: string;
}

export interface LaunchArgsExit {
  ok: false;
  /** 退出码：0 = --help；2 = 用法错误（03-cli §1.3） */
  exitCode: 0 | 2;
  message?: string;
}

export type LaunchArgs = LaunchArgsOk | LaunchArgsExit;

export function usageText(): string {
  return (
    "pm-mcp — PM 台账 MCP server（04-mcp §1，stdio 传输）\n" +
    "用法: pm-mcp [--root <path>]\n" +
    "  --root <path>  工程根路径（pm.config.json 所在目录，缺省 = 当前目录，03-cli §1.1）\n" +
    "工具清单: pm_validate / pm_create / pm_move / pm_stats / pm_check / pm_search /" +
    " pm_inbox_list / pm_inbox_process / pm_inbox_archive（04-mcp §2）"
  );
}

export function parseLaunchArgs(argv: string[]): LaunchArgs {
  let root: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      return { ok: false, exitCode: 0, message: usageText() };
    }
    if (a === "--root") {
      const value = argv[i + 1];
      if (value === undefined || value === "") {
        return { ok: false, exitCode: 2, message: "--root 需提供路径（03-cli §1.1）" };
      }
      root = value;
      i++;
      continue;
    }
    if (a.startsWith("--root=")) {
      const value = a.slice("--root=".length);
      if (value === "") {
        return { ok: false, exitCode: 2, message: "--root 需提供路径（03-cli §1.1）" };
      }
      root = value;
      continue;
    }
    return { ok: false, exitCode: 2, message: `未知参数 "${a}"（仅支持 --root <path>，03-cli §1.1）` };
  }
  return { ok: true, ...(root !== undefined ? { root } : {}) };
}
