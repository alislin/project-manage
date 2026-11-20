// @vitest-environment happy-dom
// 新建项目模态表单组件测试（S11，编号续 TC-06 系列）：
// - TC-06-027：成功创建 → POST payload 正确（slug 留空自动生成/显式填写优先、period 默认今天、
//   tags 逗号分隔去重），成功后 emit created(slug)（父级刷新列表并跳转工作台）；
// - TC-06-028：校验失败分支 → 不发请求，字段级错误展示（name 必填、period 起止逆序、slug 非法）；
// - TC-06-029：服务端信封错误 → 按 error.field/issues 映射字段级错误，E_CONFLICT（无 field）归 slug。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import NewProjectModal from "./NewProjectModal.vue";
import { ApiError } from "../../api/client";
import type { ApiErrorBody } from "../../api/types";
import { todayIso } from "../../utils/board";

const { createProject } = vi.hoisted(() => ({ createProject: vi.fn() }));

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return { ...actual, api: { ...actual.api, createProject } };
});

/** 构造服务端 ApiError（05-server §1.1 信封错误体形状） */
function serverError(code: string, message: string, status: number, body?: Partial<ApiErrorBody>): ApiError {
  return new ApiError(code, message, status, { code, message, ...body } as ApiErrorBody);
}

async function mountForm(): Promise<ReturnType<typeof mount>> {
  const wrapper = mount(NewProjectModal);
  await flushPromises();
  return wrapper;
}

const input = (wrapper: ReturnType<typeof mount>, selector: string) => wrapper.find(selector);

/** 填写基础合法字段（name 必填；其余可覆盖） */
async function fillValid(wrapper: ReturnType<typeof mount>): Promise<void> {
  await input(wrapper, "#np-name").setValue("我的应用 v2");
}

beforeEach(() => {
  createProject.mockReset();
});

describe("NewProjectModal（S11 新建项目表单）", () => {
  it("TC-06-027：period 起止默认今天，slug 留空显示自动生成预览", async () => {
    const wrapper = await mountForm();

    expect((input(wrapper, "#np-period-start").element as HTMLInputElement).value).toBe(todayIso());
    expect((input(wrapper, "#np-period-end").element as HTMLInputElement).value).toBe(todayIso());

    await fillValid(wrapper);
    expect(wrapper.find(".pm-form__hint").text()).toContain("我的应用-v2");
    expect(createProject).not.toHaveBeenCalled();
  });

  it("TC-06-027：成功创建 → POST payload（slug 自动生成、period 默认今天、tags 解析去重）并 emit created", async () => {
    createProject.mockResolvedValue({ created: { id: "我的应用-v2", slug: "我的应用-v2", path: "x", mtimeMs: 1 } });
    const wrapper = await mountForm();

    await fillValid(wrapper);
    // slug 留空 → 自动生成；tags 中英文逗号混用 + 重复项去重
    await input(wrapper, "#np-tags").setValue("前端, 高优，前端 web");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(createProject).toHaveBeenCalledTimes(1);
    expect(createProject).toHaveBeenCalledWith({
      slug: "我的应用-v2",
      name: "我的应用 v2",
      period: [todayIso(), todayIso()],
      tags: ["前端", "高优", "前端 web"],
    });
    expect(wrapper.emitted("created")).toEqual([["我的应用-v2"]]);
    expect(wrapper.emitted("close")).toBeUndefined(); // 关闭由父级在 created 后处理
  });

  it("TC-06-027：显式填写 slug 优先于自动生成", async () => {
    createProject.mockResolvedValue({ created: { id: "custom-slug", slug: "custom-slug", path: "x", mtimeMs: 1 } });
    const wrapper = await mountForm();

    await fillValid(wrapper);
    await input(wrapper, "#np-slug").setValue("custom-slug");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "custom-slug" }),
    );
    expect(wrapper.emitted("created")).toEqual([["custom-slug"]]);
  });

  it("TC-06-028：校验失败分支（name 必填）→ 不发请求，name 字段级错误展示", async () => {
    const wrapper = await mountForm();

    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(createProject).not.toHaveBeenCalled();
    const errors = wrapper.findAll(".pm-form__error").map((e) => e.text());
    expect(errors.some((t) => t.includes("name 必填"))).toBe(true);
    expect(wrapper.emitted("created")).toBeUndefined();
  });

  it("TC-06-028：校验失败分支（period 起止逆序 / slug 非法）→ 对应字段级错误，不发请求", async () => {
    const wrapper = await mountForm();

    await fillValid(wrapper);
    await input(wrapper, "#np-period-start").setValue("2026-12-31");
    await input(wrapper, "#np-period-end").setValue("2026-01-01");
    await input(wrapper, "#np-slug").setValue("bad__slug");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(createProject).not.toHaveBeenCalled();
    const errors = wrapper.findAll(".pm-form__error").map((e) => e.text());
    expect(errors.some((t) => t.includes("结束日期不能早于起始日期"))).toBe(true);
    expect(errors.some((t) => t.includes("slug 需为字母数字或中文"))).toBe(true);
    expect(wrapper.emitted("created")).toBeUndefined();
  });

  it("TC-06-029：服务端 E_VALIDATION（field=slug）→ slug 字段级错误，不 emit created", async () => {
    createProject.mockRejectedValue(
      serverError("E_VALIDATION", "请求体校验失败（01-数据规范）", 422, {
        field: "slug",
        issues: [{ file: "(request-body)", field: "slug", code: "invalid_string", message: "slug 非法" }],
      }),
    );
    const wrapper = await mountForm();

    await fillValid(wrapper);
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    const errors = wrapper.findAll(".pm-form__error").map((e) => e.text());
    expect(errors.some((t) => t.includes("slug 非法"))).toBe(true);
    expect(wrapper.emitted("created")).toBeUndefined();
    expect(wrapper.find(".pm-form__error--form").exists()).toBe(false);
  });

  it("TC-06-029：服务端 E_CONFLICT（slug 已存在，无 field）→ 归入 slug 字段级错误", async () => {
    createProject.mockRejectedValue(serverError("E_CONFLICT", "项目 demo 已存在（05-server §2.2）", 409));
    const wrapper = await mountForm();

    await fillValid(wrapper);
    await input(wrapper, "#np-slug").setValue("demo");
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    const errors = wrapper.findAll(".pm-form__error").map((e) => e.text());
    expect(errors.some((t) => t.includes("项目 demo 已存在"))).toBe(true);
    expect(wrapper.emitted("created")).toBeUndefined();
  });

  it("TC-06-029：服务端错误无字段信息（如 E_IO）→ 表单级错误整体展示", async () => {
    createProject.mockRejectedValue(serverError("E_IO", "写入失败", 500));
    const wrapper = await mountForm();

    await fillValid(wrapper);
    await wrapper.find("form").trigger("submit");
    await flushPromises();

    const formError = wrapper.find(".pm-form__error--form");
    expect(formError.exists()).toBe(true);
    expect(formError.text()).toContain("写入失败");
    expect(wrapper.emitted("created")).toBeUndefined();
  });
});
