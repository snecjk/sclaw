export type ScrollbarLayoutMode = 'classic' | 'overlay';

/** 实测滚动条是否占用布局宽度（Win / mac「始终显示」= classic；mac 默认 overlay）。 */
export function detectScrollbarLayoutMode(): ScrollbarLayoutMode {
  if (typeof document === 'undefined') return 'overlay';

  const outer = document.createElement('div');
  outer.style.cssText = 'visibility:hidden;overflow:scroll;width:100px;height:100px;position:absolute;top:-9999px;left:-9999px';
  const inner = document.createElement('div');
  inner.style.width = '100%';
  inner.style.height = '200px';
  outer.appendChild(inner);
  document.documentElement.appendChild(outer);

  const classic = outer.offsetWidth > inner.clientWidth;
  outer.remove();
  return classic ? 'classic' : 'overlay';
}

export function applyScrollbarLayoutAttribute(): ScrollbarLayoutMode {
  const mode = detectScrollbarLayoutMode();
  document.documentElement.setAttribute('data-scrollbar-layout', mode);
  return mode;
}
