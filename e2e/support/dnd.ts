/**
 * HTML5 DnD 拖拽助手（S12 任务书第 4 条）：
 * 应用侧为 HTML5 原生拖拽（draggable=true + dragstart/dragover/drop，06-web §3.1），
 * Playwright 原生 Locator.dragTo（Chromium 经 CDP Input.dispatchDragEvent 合成真实 DnD 事件序列）
 * 可直接驱动，无需降级；另提供 dispatchEvent 合成事件路径作备选（dragLibraryFallback 注记）。
 */
import type { Locator, Page } from "@playwright/test";

/** 主路径：Playwright 原生拖拽（真实鼠标序列 → 浏览器合成 HTML5 dragstart/dragover/drop） */
export async function dragCardTo(source: Locator, target: Locator): Promise<void> {
  await source.dragTo(target, { timeout: 10_000 });
}

/**
 * 备选路径（仅当原生 dragTo 无法触发 DnD 时使用）：
 * 单帧内 dispatchEvent 合成 HTML5 DnD 事件链，dragstart/dragover/drop/dragend 共享同一 DataTransfer
 * （与 06-web §3.1 的 dataTransfer.setData("text/plain", id) 契约一致）。
 */
export async function dragCardByEvents(page: Page, sourceSelector: string, targetSelector: string): Promise<void> {
  await page.evaluate(
    ({ src, tgt }) => {
      const source = document.querySelector(src);
      const target = document.querySelector(tgt);
      if (!source || !target) throw new Error(`dragCardByEvents: 元素不存在 src=${src} tgt=${tgt}`);
      const dt = new DataTransfer();
      const rect = target.getBoundingClientRect();
      const opts = (extra: DragEventInit): DragEventInit => ({
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        clientX: rect.x + rect.width / 2,
        clientY: rect.y + rect.height / 2,
        ...extra,
      });
      source.dispatchEvent(new DragEvent("dragstart", opts({})));
      target.dispatchEvent(new DragEvent("dragenter", opts({})));
      target.dispatchEvent(new DragEvent("dragover", opts({})));
      target.dispatchEvent(new DragEvent("drop", opts({})));
      source.dispatchEvent(new DragEvent("dragend", opts({})));
    },
    { src: sourceSelector, tgt: targetSelector },
  );
}
