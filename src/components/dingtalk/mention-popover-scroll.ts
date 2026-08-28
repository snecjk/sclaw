/**
 * Mention picker 滚动辅助：只动列表自己的 scrollTop，避免带动祖先 / 触发浮层重定位。
 */

export function nearestScrollTopDelta(input: {
  childTop: number;
  childBottom: number;
  containerTop: number;
  containerBottom: number;
}): number {
  const { childTop, childBottom, containerTop, containerBottom } = input;
  if (childTop < containerTop) return childTop - containerTop;
  if (childBottom > containerBottom) return childBottom - containerBottom;
  return 0;
}

/** 将子项滚进容器可视区；不调用 scrollIntoView，以免滚动外层浮层或页面。 */
export function scrollChildIntoNearestView(container: HTMLElement, child: HTMLElement): void {
  const childRect = child.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const delta = nearestScrollTopDelta({
    childTop: childRect.top,
    childBottom: childRect.bottom,
    containerTop: containerRect.top,
    containerBottom: containerRect.bottom,
  });
  if (delta === 0) return;
  container.scrollTop += delta;
}

/** 浮层内部列表滚动不应触发 portal 坐标重算。 */
export function shouldIgnorePopoverRepositionScroll(
  event: Event,
  ignoreRoot: Node | null | undefined,
): boolean {
  if (event.type !== 'scroll' || !ignoreRoot) return false;
  const target = event.target;
  if (!(target instanceof Node)) return false;
  return target === ignoreRoot || ignoreRoot.contains(target);
}
