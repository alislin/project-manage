/**
 * 看板列/泳道类型（06-web §6.1：需求第 4 列 = Done + Rejected 折叠合并，泳道各自落卡）。
 * 独立 ts 文件：<script setup> 不支持导出类型。
 */
import type { ReqStatus, RequirementItem, TaskItem, TaskStatus } from "../../api/types";

/** 泳道 = 列内的一个可放置(drop)分组；多数列单泳道，Done+Rejected 列双泳道 */
export interface RequirementLane {
  status: ReqStatus;
  label: string;
  items: RequirementItem[];
}

export interface TaskLane {
  status: TaskStatus;
  label: string;
  items: TaskItem[];
}
