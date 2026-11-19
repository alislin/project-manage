import { describe, it, expect } from "vitest";
import { deriveRequirementTasks } from "../src/index";
import type { Task } from "../src/schema";

/** TC-02 · 01-数据规范 §6.3 反链聚合（02-core §4.4 deriveRequirementTasks，TC-02-009） */

describe("TC-02 indexer", () => {
  it("TC-02-009: deriveRequirementTasks 反链聚合（01-数据规范 §6.3）", () => {
    const tasks = [
      { id: "TASK-x-002", requirement: "[[REQ-x-001]]" },
      { id: "TASK-x-001", requirement: "[[REQ-x-001]]" },
      { id: "TASK-x-003", requirement: "[[REQ-x-002]]" },
    ] as unknown as Task[];
    const map = deriveRequirementTasks(tasks, new Set(["REQ-x-001", "REQ-x-002"]));
    // map 值按 id 升序排列
    expect(map.get("REQ-x-001")).toEqual(["TASK-x-001", "TASK-x-002"]);
    expect(map.get("REQ-x-002")).toEqual(["TASK-x-003"]);
  });

  it("TC-02-009b: 悬空链接（目标不存在）不进入聚合（01-数据规范 §6.3, 02-core §5.2.5）", () => {
    const tasks = [
      { id: "TASK-x-001", requirement: "[[REQ-x-001]]" },
      { id: "TASK-x-002", requirement: "[[REQ-x-999]]" }, // 悬空
    ] as unknown as Task[];
    const map = deriveRequirementTasks(tasks, new Set(["REQ-x-001"]));
    expect(map.get("REQ-x-001")).toEqual(["TASK-x-001"]);
    expect(map.has("REQ-x-999")).toBe(false);
  });
});
