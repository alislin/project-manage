// @vitest-environment happy-dom
// PmChart 组件测试（S8）：空态分支（TC-06-024）与 option 变更即时重绘（TC-06-013/TC-06-023 主题换色路径）
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

const { init, setOption, resize, dispose } = vi.hoisted(() => ({
  init: vi.fn(),
  setOption: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock("../../utils/echarts", () => ({
  echarts: { init },
}));

import PmChart from "./PmChart.vue";

beforeEach(() => {
  init.mockReset().mockReturnValue({ setOption, resize, dispose });
  setOption.mockReset();
  resize.mockReset();
  dispose.mockReset();
});

describe("PmChart", () => {
  it("TC-06-024: empty=true 渲染空态文案分支，不初始化 echarts 实例", () => {
    const w = mount(PmChart, { props: { option: {}, empty: true, emptyText: "暂无任务，完成率图表将在此展示" } });
    expect(w.find(".pm-chart__empty").text()).toBe("暂无任务，完成率图表将在此展示");
    expect(init).not.toHaveBeenCalled();
    expect(setOption).not.toHaveBeenCalled();
  });

  it("TC-06-024: empty 缺省文案为'暂无数据'", () => {
    const w = mount(PmChart, { props: { option: {}, empty: true } });
    expect(w.find(".pm-chart__empty").text()).toBe("暂无数据");
  });

  it("TC-06-013: 挂载即 init 并 setOption 图表配置", () => {
    const option = { series: [{ type: "pie" }] };
    const w = mount(PmChart, { props: { option } });
    expect(init).toHaveBeenCalledTimes(1);
    expect(setOption).toHaveBeenCalledWith(option, true);
    w.unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("TC-06-023: option 引用变化（主题换色重算）触发再次 setOption（notMerge 即时生效）", async () => {
    const w = mount(PmChart, { props: { option: { series: [] } } });
    expect(setOption).toHaveBeenCalledTimes(1);
    await w.setProps({ option: { series: [{ type: "pie", itemStyle: { color: "#58a6ff" } }] } });
    expect(setOption).toHaveBeenCalledTimes(2);
    expect(setOption).toHaveBeenLastCalledWith({ series: [{ type: "pie", itemStyle: { color: "#58a6ff" } }] }, true);
  });

  it("TC-06-024: empty 翻转（false→true）销毁实例并切回空态文案", async () => {
    const w = mount(PmChart, { props: { option: { series: [] }, empty: false } });
    expect(init).toHaveBeenCalledTimes(1);
    await w.setProps({ empty: true, emptyText: "暂无需求" });
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(w.find(".pm-chart__empty").text()).toBe("暂无需求");
    // 恢复非空 → 重建实例
    await w.setProps({ empty: false });
    expect(init).toHaveBeenCalledTimes(2);
  });
});
