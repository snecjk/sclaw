/**
 * read_page 滚动收集（计划 §四 B4 readPage / P1-4）：
 * 找真滚动容器 → 0.85 屏步进 → 每步 settle 窗口观察文本增长 → 三层去重 →
 * 冻结检测（scrollTop 停滞 + rAF 探针）→ 恢复滚动位置 → 分页语义返回。
 *
 * 页内脚本保持 ES5 语法风格（与 observe-script 一致）；去重/分页为主进程纯函数，便于单测。
 */
import {
  BROWSER_AUTOMATION_READ_PAGE_MAX_CHARS,
  BROWSER_AUTOMATION_READ_PAGE_MAX_PAGES,
  BROWSER_AUTOMATION_READ_PAGE_OVERLAP_LINES,
  BROWSER_AUTOMATION_READ_PAGE_RAF_TIMEOUT_MS,
  BROWSER_AUTOMATION_READ_PAGE_SETTLE_MS,
  BROWSER_AUTOMATION_READ_PAGE_STEP_RATIO,
  type BrowserAutomationReadPageOptions,
} from '../../../shared/browser-automation/types';

export interface ReadPageDeps {
  executeJavaScript: (script: string) => Promise<unknown>;
}

/** 内部可调参数（测试用 settleMs:0 加速）；不暴露到共享契约。 */
export interface ReadPageRunOptions extends BrowserAutomationReadPageOptions {
  settleMs?: number;
  rafTimeoutMs?: number;
}

export interface ReadPageCollected {
  /** 全量收集文本（未按 MAX_CHARS 截断）。 */
  fullText: string;
  /** 实际滚动屏数（首屏计 1）。 */
  pages: number;
  /** 连续 2 屏 scrollTop 不变且无新增文本 → 提前终止。 */
  frozen: boolean;
  /** rAF 探针超时（渲染冻结，§六 风险项的页内信号）。 */
  renderFrozen: boolean;
  /** 到达容器底部。 */
  reachedBottom: boolean;
}

interface PageProbeResult {
  found?: boolean;
  text?: string;
  scrollTop?: number;
  viewportH?: number;
  scrollHeight?: number;
  atBottom?: boolean;
  renderFrozen?: boolean;
}

/**
 * 页内脚本（ES5）：op=init 找真滚动容器并缓存到 window.__stoBaReadPage；
 * op=probe 采集当前屏文本与滚动指标 + rAF 冻结探针；op=scroll 步进；op=restore 恢复原位。
 * 真滚动容器判定：scrollHeight > clientHeight + 4 且 computed overflowY ∈ auto/scroll，
 * 取可滚距离最大者；找不到则回退 window（document.scrollingElement）。
 */
const READ_PAGE_SCRIPT = `(function(op, payload) {
  var RAF_TIMEOUT = __RAF_TIMEOUT__;
  var st = window.__stoBaReadPage || (window.__stoBaReadPage = {});
  payload = payload || {};

  function metrics() {
    var el = st.el || null;
    var top = el ? el.scrollTop : (window.pageYOffset || document.documentElement.scrollTop || 0);
    var viewportH = el ? el.clientHeight : (window.innerHeight || document.documentElement.clientHeight || 0);
    var scrollH = el ? el.scrollHeight : Math.max(
      document.body ? document.body.scrollHeight : 0,
      document.documentElement ? document.documentElement.scrollHeight : 0
    );
    var textEl = el || document.body || document.documentElement;
    var text = (textEl.innerText || textEl.textContent || '');
    return {
      found: !!el,
      text: text,
      scrollTop: top,
      viewportH: viewportH,
      scrollHeight: scrollH,
      atBottom: top + viewportH >= scrollH - 4,
    };
  }

  function pickContainer() {
    var best = null;
    var bestDistance = 0;
    var all = document.querySelectorAll('*');
    var limit = Math.min(all.length, 2000);
    for (var i = 0; i < limit; i++) {
      var el = all[i];
      if (!el || !el.scrollHeight || !el.clientHeight) continue;
      var distance = el.scrollHeight - el.clientHeight;
      if (distance <= 4) continue;
      var style = window.getComputedStyle(el);
      var overflowY = style.overflowY;
      if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
      if (distance > bestDistance) {
        best = el;
        bestDistance = distance;
      }
    }
    return best;
  }

  function rafProbe(next) {
    var done = false;
    var timer = setTimeout(function() {
      if (!done) { done = true; next(true); }
    }, RAF_TIMEOUT);
    requestAnimationFrame(function() {
      if (!done) { done = true; clearTimeout(timer); next(false); }
    });
  }

  if (op === 'init') {
    st.el = pickContainer();
    var m0 = metrics();
    st.originalTop = m0.scrollTop;
    return m0;
  }
  if (op === 'scroll') {
    var delta = Number(payload.deltaY || 0);
    if (st.el) st.el.scrollTop = st.el.scrollTop + delta;
    else window.scrollBy(0, delta);
    return metrics();
  }
  if (op === 'restore') {
    if (st.el) st.el.scrollTop = Number(payload.top || 0);
    else window.scrollTo(0, Number(payload.top || 0));
    return metrics();
  }
  // op === 'probe'：采集 + rAF 冻结探针（executeJavaScript 会 await 返回的 Promise）
  return new Promise(function(resolve) {
    rafProbe(function(frozen) {
      var m = metrics();
      m.renderFrozen = frozen;
      resolve(m);
    });
  });
})`;

export function buildReadPageScript(
  op: 'init' | 'probe' | 'scroll' | 'restore',
  payload?: { deltaY?: number; top?: number },
  rafTimeoutMs: number = BROWSER_AUTOMATION_READ_PAGE_RAF_TIMEOUT_MS,
): string {
  const serialized = JSON.stringify(payload ?? {});
  return `(${READ_PAGE_SCRIPT.replace('__RAF_TIMEOUT__', String(Math.trunc(rafTimeoutMs)))})(${JSON.stringify(op)}, ${serialized})`;
}

/**
 * 三层去重追加（主进程纯函数）：
 * 层 1：整屏文本与上一屏相同 → 不追加；
 * 层 2：chunk 以既有文本/上一屏为前缀（容器返回全量且增长）→ 只加增量尾；
 * 层 3：虚拟列表——相邻批交界行级重叠（≤BROWSER_AUTOMATION_READ_PAGE_OVERLAP_LINES 行）只去交界重叠。
 * 返回新增字符数。
 */
export function appendReadPageChunk(
  state: { text: string; lastChunk: string },
  chunk: string,
): number {
  const normalized = chunk.replace(/\r\n/g, '\n');
  if (!normalized.trim()) return 0;

  // 层 1：整页相同不追加
  if (normalized === state.lastChunk) return 0;

  // 层 2：前缀一致只加增量尾（全量容器文本增长 / 上屏文本增长两种形态）
  if (state.text && normalized.startsWith(state.text)) {
    if (normalized.length === state.text.length) {
      state.lastChunk = normalized;
      return 0;
    }
    const delta = normalized.slice(state.text.length);
    state.text = normalized;
    state.lastChunk = normalized;
    return delta.length;
  }
  if (state.lastChunk && normalized.startsWith(state.lastChunk) && normalized.length > state.lastChunk.length) {
    const delta = normalized.slice(state.lastChunk.length);
    state.text += delta;
    state.lastChunk = normalized;
    return delta.length;
  }

  // 层 3：行级交界重叠去重（从最大可能重叠往下找首个命中）
  const accLines = state.text ? state.text.split('\n') : [];
  const chunkLines = normalized.split('\n');
  let overlap = 0;
  const maxK = Math.min(BROWSER_AUTOMATION_READ_PAGE_OVERLAP_LINES, accLines.length, chunkLines.length);
  for (let k = maxK; k >= 1; k -= 1) {
    let matched = true;
    for (let i = 0; i < k; i += 1) {
      if (accLines[accLines.length - k + i] !== chunkLines[i]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      overlap = k;
      break;
    }
  }
  const addition = chunkLines.slice(overlap).join('\n');
  if (!addition.trim()) {
    state.lastChunk = normalized;
    return 0;
  }
  state.text += (state.text ? '\n' : '') + addition;
  state.lastChunk = normalized;
  return addition.length;
}

/**
 * 滚动收集主循环。返回全量文本与收集元数据；MAX_CHARS 截断与 artifact 落盘由调用方（service）负责。
 */
export async function collectReadPageText(
  deps: ReadPageDeps,
  opts?: ReadPageRunOptions,
): Promise<ReadPageCollected> {
  const maxPages = Math.max(1, opts?.maxPages ?? BROWSER_AUTOMATION_READ_PAGE_MAX_PAGES);
  const settleMs = opts?.settleMs ?? BROWSER_AUTOMATION_READ_PAGE_SETTLE_MS;
  const rafTimeoutMs = opts?.rafTimeoutMs ?? BROWSER_AUTOMATION_READ_PAGE_RAF_TIMEOUT_MS;

  const probe = async (): Promise<PageProbeResult> => {
    const raw = await deps.executeJavaScript(buildReadPageScript('probe', undefined, rafTimeoutMs));
    return (raw ?? {}) as PageProbeResult;
  };

  const init = (await deps.executeJavaScript(buildReadPageScript('init', undefined, rafTimeoutMs))) as PageProbeResult;
  const originalTop = typeof init?.scrollTop === 'number' ? init.scrollTop : 0;
  const viewportH = typeof init?.viewportH === 'number' && init.viewportH > 0 ? init.viewportH : 800;
  const stepPx = Math.max(1, Math.round(opts?.pixelPerPage ?? viewportH * BROWSER_AUTOMATION_READ_PAGE_STEP_RATIO));

  const state = { text: '', lastChunk: '' };
  appendReadPageChunk(state, typeof init?.text === 'string' ? init.text : '');

  let pages = 1;
  let frozen = false;
  let renderFrozen = init?.renderFrozen === true;
  let reachedBottom = init?.atBottom === true;
  let stagnantRounds = 0;
  let lastScrollTop = typeof init?.scrollTop === 'number' ? init.scrollTop : 0;

  try {
    while (!frozen && !renderFrozen && !reachedBottom && pages < maxPages) {
      await deps.executeJavaScript(buildReadPageScript('scroll', { deltaY: stepPx }, rafTimeoutMs));
      await new Promise((resolve) => setTimeout(resolve, settleMs));
      const current = await probe();
      pages += 1;

      renderFrozen = current.renderFrozen === true;
      const added = appendReadPageChunk(state, typeof current.text === 'string' ? current.text : '');
      const scrollTop = typeof current.scrollTop === 'number' ? current.scrollTop : lastScrollTop;
      const scrollMoved = Math.abs(scrollTop - lastScrollTop) > 1;
      lastScrollTop = scrollTop;
      reachedBottom = current.atBottom === true;

      // 冻结检测：scrollTop 不动且无新增文本，连续 2 屏 → frozen 提前终止
      if (!scrollMoved && added === 0) {
        stagnantRounds += 1;
        if (stagnantRounds >= 2) {
          frozen = true;
        }
      } else {
        stagnantRounds = 0;
      }

      if (renderFrozen) break;
      if (reachedBottom && added === 0) break;
    }
  } finally {
    // 恢复滚动位置（best-effort，不遮蔽主流程错误）
    await deps
      .executeJavaScript(buildReadPageScript('restore', { top: originalTop }, rafTimeoutMs))
      .catch(() => undefined);
  }

  return {
    fullText: state.text,
    pages,
    frozen,
    renderFrozen,
    reachedBottom,
  };
}

/**
 * 分页语义裁剪（complete/nextStart）：从 fullText 的 startOffset 起取 MAX_CHARS 窗口。
 * complete = 窗口覆盖到全文末尾 且 收集确已收尾（读到底或滚动冻结；renderFrozen 不算收尾）。
 */
export function paginateReadPageText(
  collected: ReadPageCollected,
  opts?: BrowserAutomationReadPageOptions,
): {
  text: string;
  complete: boolean;
  truncated: boolean;
  nextStart?: number;
} {
  const startOffset = Math.max(0, opts?.startOffset ?? 0);
  const start = Math.min(startOffset, collected.fullText.length);
  const end = Math.min(start + BROWSER_AUTOMATION_READ_PAGE_MAX_CHARS, collected.fullText.length);
  const truncated = end < collected.fullText.length;
  const collectedToEnd = collected.reachedBottom || collected.frozen;
  return {
    text: collected.fullText.slice(start, end),
    complete: !truncated && collectedToEnd && !collected.renderFrozen,
    truncated,
    nextStart: truncated ? end : undefined,
  };
}
