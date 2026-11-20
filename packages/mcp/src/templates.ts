/**
 * frontmatter 模板（01-数据规范 §1.1/§1.2/§1.3，与 03-cli §3 / @pm/server templates 同源）。
 * `yq` = JSON 字符串语法（合法 YAML 双引号标量）；数组用 flow sequence。
 */

function yq(s: string): string {
  return JSON.stringify(s);
}

function yamlStringArray(arr: string[]): string {
  return `[${arr.map(yq).join(", ")}]`;
}

/** 01-数据规范 §1.1 project.md */
export function projectMd(slug: string, name: string, status: string, period: [string, string], tags: string[]): string {
  return `---
type: project
id: ${yq(slug)}
name: ${yq(name)}
status: ${status}
period: [${period.map((d) => yq(d)).join(", ")}]
tags: ${yamlStringArray(tags)}
---
`;
}

/** 01-数据规范 §1.2 需求文件（projects/<slug>/requirements/REQ-<slug>-NNN.md） */
export function requirementMd(
  id: string,
  title: string,
  status: string,
  priority: string,
  module: string,
  source: string,
  created: string,
  updated: string,
): string {
  return `---
type: requirement
id: ${yq(id)}
title: ${yq(title)}
status: ${status}
priority: ${yq(priority)}
module: ${yq(module)}
source: ${yq(source)}
created: ${yq(created)}
updated: ${yq(updated)}
---
`;
}

/** 01-数据规范 §1.3 任务文件（projects/<slug>/tasks/TASK-<slug>-NNN.md） */
export function taskMd(
  id: string,
  title: string,
  status: string,
  requirement: string,
  priority: string,
  due: string,
  created: string,
  updated: string,
): string {
  return `---
type: task
id: ${yq(id)}
title: ${yq(title)}
status: ${status}
requirement: ${yq(requirement)}
priority: ${yq(priority)}
due: ${yq(due)}
completed: null
created: ${yq(created)}
updated: ${yq(updated)}
---
`;
}
