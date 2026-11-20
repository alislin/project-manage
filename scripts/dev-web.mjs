#!/usr/bin/env node
/**
 * dev:web 启动器（S11 hotfix 问题 1，根 package.json `dev:web` 指向本脚本）：
 * - 显式透传环境变量给 vite dev（PM_API_TARGET 由 apps/web/vite.config.ts 读取，
 *   未设置时 vite 使用默认 http://127.0.0.1:3000），启动前回显，避免静默打到别的应用；
 * - 额外 CLI 参数原样透传给 vite：`npm run dev:web -- --port 5174 --host`。
 */
import { spawn } from "node:child_process";

const target = process.env.PM_API_TARGET;
console.log(
  target
    ? `[pm-web] PM_API_TARGET=${target}（dev 代理 /api → 此地址）`
    : "[pm-web] PM_API_TARGET 未设置，dev 代理 /api → 默认 http://127.0.0.1:3000（可用 PM_API_TARGET 覆盖）",
);

const extraArgs = process.argv.slice(2);
// `--` 之后才是脚本参数（npm 自身不吞掉 --port 等透传旗标）
const npmArgs = ["run", "dev", "--workspace", "pm-web", "--", ...extraArgs];

const child = spawn("npm", npmArgs, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env, // 显式透传完整环境（含 PM_API_TARGET 等自定义变量）
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
