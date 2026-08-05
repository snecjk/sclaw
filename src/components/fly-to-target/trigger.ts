import {
  FLY_TO_TARGET_EVENT,
  FLY_TO_TARGET_START_POP_MS,
  FLY_TO_TARGET_START_POP_SCALE,
} from './constants';
import { animateScaleTo, clearInlineTransform } from './motion';
import type { FlyToTargetDetail, FlyToTargetRect } from './types';

function toPlainRect(rect: DOMRect): FlyToTargetRect {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 从起点元素发起一次「飞入目标」请求。
 * 先对起点做短促放大反馈，再派发飞行事件。
 * 用户开启「减少动态效果」时直接跳过。
 */
export function triggerFlyToTarget(startEl: Element): void {
  if (typeof window === 'undefined') return;
  if (prefersReducedMotion()) {
    return;
  }

  const htmlEl = startEl instanceof HTMLElement ? startEl : null;
  // 在 pop 之前快照，飞行从自然尺寸起算，而不是放大后的尺寸
  const startRect = toPlainRect(startEl.getBoundingClientRect());

  if (!htmlEl) {
    window.dispatchEvent(
      new CustomEvent<FlyToTargetDetail>(FLY_TO_TARGET_EVENT, {
        detail: { startRect },
      }),
    );
    return;
  }

  const previousTransform = htmlEl.style.transform;

  void (async () => {
    // 1) 点击反馈：起点图标放大
    await animateScaleTo(htmlEl, {
      scale: FLY_TO_TARGET_START_POP_SCALE,
      durationMs: FLY_TO_TARGET_START_POP_MS,
      easing: 'ease-out',
    });

    // 2) 用 pop 前的矩形发起抛物线飞行
    window.dispatchEvent(
      new CustomEvent<FlyToTargetDetail>(FLY_TO_TARGET_EVENT, {
        detail: { startRect },
      }),
    );

    // 飞球已起飞，起点图标还原
    await animateScaleTo(htmlEl, {
      scale: 1,
      durationMs: FLY_TO_TARGET_START_POP_MS,
      easing: 'ease-in-out',
    });
    clearInlineTransform(htmlEl, previousTransform);
  })();
}
