import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** 非源码产物测试根：优先 C:\Users\Aidee\AppData\Local\Temp\opencode（环境允许外部访问） */
function makeTempRoot(prefix: string): string {
  const base = path.join(os.tmpdir(), "opencode");
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, prefix));
}

/** 建 vault 根：`<root>/vault/` + `pm.config.json`（02-core §4.1 ZConfig） */
export function makeVaultRoot(prefix: string): string {
  const root = makeTempRoot(prefix);
  const vault = path.join(root, "vault");
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(root, "pm.config.json"), JSON.stringify({ vaultPath: vault, pmRoot: path.join(vault, "PM") }));
  return root;
}

/** 写 PM 文件（rel 相对 vault/PM） */
export function writePmFile(vault: string, rel: string, content: string): string {
  const abs = path.join(vault, "PM", rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  return abs;
}

export function readPmFile(vault: string, rel: string): string {
  return fs.readFileSync(path.join(vault, "PM", rel), "utf8");
}

export function pathExists(vault: string, rel: string): boolean {
  return fs.existsSync(path.join(vault, "PM", rel));
}

/** 返回当前日期（YYYY-MM-DD，07-workflow §1 日期约定） */
export function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 返回今天 + n 天 */
export function shiftDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
