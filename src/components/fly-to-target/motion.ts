/**
 * 飞入目标用的命令式缩放工具（起点 pop / 终点弹跳）。
 * 只操作 DOM，方便与 React 调用方解耦。
 */

type ScalePulseOptions = {
  scale: number;
  durationMs: number;
  easing?: string;
};

function readInlineTransform(el: HTMLElement): string {
  return el.style.transform;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** 强制提交待写入的 style，再做下一次 transform 变更 */
function commitStyle(el: HTMLElement): void {
  void el.offsetWidth;
}

/**
 * 用显式 transition 动画 `transform: scale(...)`。
 * 中间强制刷样式，保证连续缩放（先放大再缩小）两段都能播出来。
 */
export async function animateScaleTo(
  el: HTMLElement,
  { scale, durationMs, easing = 'ease-out' }: ScalePulseOptions,
): Promise<void> {
  el.style.transition = `transform ${durationMs}ms ${easing}`;
  commitStyle(el);
  el.style.transform = `scale(${scale})`;
  await delay(durationMs);
}

/** 弹跳结束后恢复内联 transform / transition */
export function clearInlineTransform(el: HTMLElement, previousTransform: string): void {
  el.style.transition = '';
  el.style.transform = previousTransform;
}

/**
 * 先放大再还原——两段都走 CSS transition（中间有 style flush）。
 */
export async function popScaleThenRestore(
  el: HTMLElement,
  {
    scale,
    upMs,
    downMs,
  }: {
    scale: number;
    upMs: number;
    downMs: number;
  },
): Promise<void> {
  const previous = readInlineTransform(el);

  // 先无过渡地摆到已知起始姿态，避免「切到起点」也产生动画
  el.style.transition = 'none';
  el.style.transform = previous || 'scale(1)';
  commitStyle(el);

  await animateScaleTo(el, { scale, durationMs: upMs, easing: 'ease-out' });
  await animateScaleTo(el, {
    scale: 1,
    durationMs: downMs,
    easing: 'ease-out',
  });
  clearInlineTransform(el, previous);
}

/**
 * 瞬间落到 fromScale，再缓动回 1——飞球落地时用。
 */
export async function settleFromScale(
  el: HTMLElement,
  {
    fromScale,
    restoreMs,
  }: {
    fromScale: number;
    restoreMs: number;
  },
): Promise<void> {
  const previous = readInlineTransform(el);
  el.style.transition = 'none';
  el.style.transform = `scale(${fromScale})`;
  commitStyle(el);
  await animateScaleTo(el, {
    scale: 1,
    durationMs: restoreMs,
    easing: 'ease-out',
  });
  clearInlineTransform(el, previous);
}
