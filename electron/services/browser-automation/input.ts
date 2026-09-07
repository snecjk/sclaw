import type { WebContents } from 'electron';
import type {
  BrowserAutomationActPayload,
  BrowserAutomationActResult,
} from '../../../shared/browser-automation/types';
import {
  buildObserveScript,
} from '../../../shared/browser-automation/observe-script';
import { BROWSER_AUTOMATION_MAX_ELEMENTS } from '../../../shared/browser-automation/types';
import { BrowserAutomationCdpSession } from './cdp-session';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ResolvedInputTarget {
  found: boolean;
  ref?: string;
  stableKey?: string;
  centerX?: number;
  centerY?: number;
  value?: string;
  editable?: boolean;
  error?: string;
  /** 页内代际兜底命中（A2）：引用过期，须重新 observe。 */
  staleRef?: boolean;
  /** 页内可见性守卫（B7）：document.visibilityState === 'hidden'。 */
  pageNotVisible?: boolean;
  /** 页内可见性守卫（B7）：scrollIntoView 后中心点仍出视口。 */
  outsideViewport?: boolean;
  /** 页内前置检查（B7.3）：disabled / aria-disabled。 */
  disabled?: boolean;
  /** 页内前置检查（B7.3）：readonly / aria-readonly。 */
  readonly?: boolean;
}

interface ReadTargetValueResult {
  found: boolean;
  value?: string;
  stableKey?: string;
  error?: string;
  staleRef?: boolean;
}

const CDP_MODIFIER_ALT = 1;
const CDP_MODIFIER_CTRL = 2;
const CDP_MODIFIER_META = 4;
const CDP_MODIFIER_SHIFT = 8;

const KEY_DEFS: Record<string, { key: string; code: string; keyCode: number }> = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  // R13 存量 bug 修复：Windows VK_END = 35（VK_HOME = 36）
  End: { key: 'End', code: 'End', keyCode: 35 },
  Space: { key: ' ', code: 'Space', keyCode: 32 },
  ' ': { key: ' ', code: 'Space', keyCode: 32 },
  Control: { key: 'Control', code: 'ControlLeft', keyCode: 17 },
  Meta: { key: 'Meta', code: 'MetaLeft', keyCode: 91 },
  a: { key: 'a', code: 'KeyA', keyCode: 65 },
  A: { key: 'A', code: 'KeyA', keyCode: 65 },
};

function buildObserveBootstrap(): string {
  return buildObserveScript(BROWSER_AUTOMATION_MAX_ELEMENTS);
}

function serializePayload(payload: BrowserAutomationActPayload): string {
  return JSON.stringify({
    ref: payload.ref,
    stableKey: payload.stableKey,
    name: payload.name,
    value: payload.value,
  });
}

export async function resolveTargetForInput(
  executeJavaScript: (script: string) => Promise<unknown>,
  payload: BrowserAutomationActPayload,
): Promise<ResolvedInputTarget> {
  const script = `${buildObserveBootstrap()}; window.__stoBrowserAutomation.resolveTargetForInput(${serializePayload(payload)})`;
  const result = await executeJavaScript(script) as ResolvedInputTarget;
  return result ?? { found: false, error: 'resolveTargetForInput returned null' };
}

export async function readTargetInputValue(
  executeJavaScript: (script: string) => Promise<unknown>,
  payload: BrowserAutomationActPayload,
): Promise<ReadTargetValueResult> {
  const script = `${buildObserveBootstrap()}; window.__stoBrowserAutomation.readTargetInputValue(${serializePayload(payload)})`;
  const result = await executeJavaScript(script) as ReadTargetValueResult;
  return result ?? { found: false, error: 'readTargetInputValue returned null' };
}

/**
 * includes 语义对短期望值有假阳性（计划 §四 B7.3）；workflow 校验已依赖，不改行为。
 */
function valuesMatch(actual: string, expected: string): boolean {
  const normalizedActual = actual.trim();
  const normalizedExpected = expected.trim();
  if (!normalizedExpected) return normalizedActual.length === 0;
  return normalizedActual === normalizedExpected || normalizedActual.includes(normalizedExpected);
}

export function assertElementActionable(
  resolved: ResolvedInputTarget,
  action: 'fill' | 'click' | 'press' = 'click',
): void {
  if (resolved.disabled) {
    throw Object.assign(new Error('Element is disabled'), { code: 'ELEMENT_NOT_VISIBLE' });
  }
  if (action === 'fill' && resolved.readonly) {
    throw Object.assign(new Error('Element is readonly'), { code: 'FILL_NOT_STUCK' });
  }
}

async function dispatchMouseClick(
  cdp: BrowserAutomationCdpSession,
  x: number,
  y: number,
): Promise<void> {
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
    button: 'none',
    clickCount: 0,
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    clickCount: 1,
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 1,
  });
}

async function dispatchKey(
  cdp: BrowserAutomationCdpSession,
  type: 'keyDown' | 'keyUp' | 'char',
  key: string,
  modifiers = 0,
): Promise<void> {
  const def = KEY_DEFS[key] ?? {
    key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
  };
  await cdp.send('Input.dispatchKeyEvent', {
    type,
    key: def.key,
    code: def.code,
    windowsVirtualKeyCode: def.keyCode,
    nativeVirtualKeyCode: def.keyCode,
    modifiers,
    text: type === 'char' ? def.key : undefined,
  });
}

async function selectAll(cdp: BrowserAutomationCdpSession): Promise<void> {
  const selectAllModifier = process.platform === 'darwin' ? CDP_MODIFIER_META : CDP_MODIFIER_CTRL;
  const selectKey = process.platform === 'darwin' ? 'Meta' : 'Control';
  await dispatchKey(cdp, 'keyDown', selectKey, selectAllModifier);
  await dispatchKey(cdp, 'keyDown', 'a', selectAllModifier);
  await dispatchKey(cdp, 'keyUp', 'a', selectAllModifier);
  await dispatchKey(cdp, 'keyUp', selectKey, selectAllModifier);
}

async function clearField(cdp: BrowserAutomationCdpSession): Promise<void> {
  await selectAll(cdp);
  await dispatchKey(cdp, 'keyDown', 'Backspace');
  await dispatchKey(cdp, 'keyUp', 'Backspace');
}

export async function typeTextViaCdp(
  cdp: BrowserAutomationCdpSession,
  text: string,
  options?: { clearFirst?: boolean },
): Promise<void> {
  if (options?.clearFirst !== false) {
    await clearField(cdp);
  }
  if (text) {
    await cdp.send('Input.insertText', { text });
  }
}

export async function pressKeyViaCdp(
  cdp: BrowserAutomationCdpSession,
  key: string,
): Promise<void> {
  const normalized = key.trim();
  if (!normalized) throw new Error('key is required');
  if (normalized === 'Space') {
    await dispatchKey(cdp, 'keyDown', 'Space');
    await dispatchKey(cdp, 'keyUp', 'Space');
    return;
  }
  await dispatchKey(cdp, 'keyDown', normalized);
  await dispatchKey(cdp, 'keyUp', normalized);
}

async function nativeFillTarget(
  executeJavaScript: (script: string) => Promise<unknown>,
  payload: BrowserAutomationActPayload,
): Promise<{ success: boolean; value?: string; stableKey?: string; error?: string }> {
  const script = `${buildObserveBootstrap()}; window.__stoBrowserAutomation.nativeFillTarget(${serializePayload(payload)})`;
  const result = await executeJavaScript(script) as {
    success?: boolean;
    value?: string;
    stableKey?: string;
    error?: string;
  };
  return {
    success: Boolean(result?.success),
    value: result?.value,
    stableKey: result?.stableKey,
    error: result?.error,
  };
}

export async function actFillOrType(
  input: {
    cdp: BrowserAutomationCdpSession;
    executeJavaScript: (script: string) => Promise<unknown>;
    payload: BrowserAutomationActPayload;
  },
): Promise<BrowserAutomationActResult> {
  const expected = input.payload.value ?? '';
  const resolved = await resolveTargetForInput(input.executeJavaScript, input.payload);
  if (!resolved.found || resolved.centerX == null || resolved.centerY == null) {
    return {
      success: false,
      action: 'fill',
      // 页内守卫命中（B7/A2）→ 结构化错误码，供上层分流
      error: resolved.error ?? 'Element not found',
      errorCode: resolved.staleRef
        ? 'STALE_REF'
        : resolved.pageNotVisible
          ? 'PAGE_NOT_VISIBLE'
          : resolved.outsideViewport
            ? 'ELEMENT_NOT_VISIBLE'
            : undefined,
    };
  }

  try {
    assertElementActionable(resolved, 'fill');
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    return {
      success: false,
      action: 'fill',
      ref: resolved.ref ?? input.payload.ref,
      stableKey: resolved.stableKey ?? input.payload.stableKey,
      error: error instanceof Error ? error.message : String(error),
      errorCode: code === 'ELEMENT_NOT_VISIBLE' || code === 'FILL_NOT_STUCK' ? code : undefined,
    };
  }

  await dispatchMouseClick(input.cdp, resolved.centerX, resolved.centerY);
  await typeTextViaCdp(input.cdp, expected, { clearFirst: true });

  let read = await readTargetInputValue(input.executeJavaScript, input.payload);
  if (read.found && valuesMatch(read.value ?? '', expected)) {
    return {
      success: true,
      action: 'fill',
      ref: resolved.ref ?? input.payload.ref,
      stableKey: read.stableKey ?? resolved.stableKey ?? input.payload.stableKey,
      error: undefined,
    };
  }

  const fallback = await nativeFillTarget(input.executeJavaScript, input.payload);
  read = await readTargetInputValue(input.executeJavaScript, input.payload);
  const actual = read.value ?? fallback.value ?? '';
  if (fallback.success && valuesMatch(actual, expected)) {
    return {
      success: true,
      action: 'fill',
      ref: resolved.ref ?? input.payload.ref,
      stableKey: fallback.stableKey ?? resolved.stableKey ?? input.payload.stableKey,
    };
  }

  return {
    success: false,
    action: 'fill',
    ref: resolved.ref ?? input.payload.ref,
    stableKey: resolved.stableKey ?? input.payload.stableKey,
    error: expected
      ? `Typed value did not stick (expected "${expected}", got "${actual}")`
      : 'Unable to clear or fill the target field',
  };
}

export async function actPressKey(
  input: {
    cdp: BrowserAutomationCdpSession;
    executeJavaScript: (script: string) => Promise<unknown>;
    payload: BrowserAutomationActPayload;
  },
): Promise<BrowserAutomationActResult> {
  const key = input.payload.key?.trim();
  if (!key) {
    return { success: false, action: 'press', error: 'key is required' };
  }

  const resolved = await resolveTargetForInput(input.executeJavaScript, input.payload);
  if (resolved.found && resolved.centerX != null && resolved.centerY != null) {
    await dispatchMouseClick(input.cdp, resolved.centerX, resolved.centerY);
  }

  await pressKeyViaCdp(input.cdp, key);
  return {
    success: true,
    action: 'press',
    ref: resolved.ref ?? input.payload.ref,
    stableKey: resolved.stableKey ?? input.payload.stableKey,
  };
}

// ── B7 click 降级链：JS el.click() → CDP 坐标三连 → 投递探针终验 ──────────────

/** JS click 到探针判读的观察窗口（计划 §四 B7：50ms）。 */
const CLICK_PROBE_WINDOW_MS = 50;

export interface ClickFallbackResult extends BrowserAutomationActResult {
  /** 实际生效的投递路径。 */
  via: 'js' | 'cdp';
  /** 投递探针确认事件到达目标或其交互祖先（探针不可用时缺省）。 */
  probeDelivered?: boolean;
}

interface PageClickActResult {
  success?: boolean;
  ref?: string;
  stableKey?: string;
  error?: string;
  staleRef?: boolean;
  occluded?: boolean;
  occluder?: string;
}

interface ClickProbeState {
  delivered: boolean;
  targetMatched: boolean;
}

/** 页内探针必须返回 { delivered, targetMatched }；观察对象等脏值视为探针不可用。 */
function parseClickProbe(value: unknown): ClickProbeState | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { delivered?: unknown; targetMatched?: unknown };
  if (typeof record.delivered !== 'boolean') return null;
  return { delivered: record.delivered, targetMatched: record.targetMatched === true };
}

/** resolveTargetForInput 失败 → 结构化降级链失败结果（波次 1 可见性守卫在真实输入路径前生效）。 */
function clickGuardFailure(
  action: BrowserAutomationActPayload['action'],
  resolved: ResolvedInputTarget,
): ClickFallbackResult {
  return {
    success: false,
    action,
    via: 'js',
    ref: resolved.ref,
    stableKey: resolved.stableKey,
    error: resolved.error ?? 'Element not found',
    errorCode: resolved.staleRef
      ? 'STALE_REF'
      : resolved.pageNotVisible
        ? 'PAGE_NOT_VISIBLE'
        : resolved.outsideViewport
          ? 'ELEMENT_NOT_VISIBLE'
          : 'ELEMENT_NOT_FOUND',
  };
}

/**
 * click 降级链（计划 §四 B7）：
 * ① 页内 installClickProbe → JS el.click()（遮挡检测返回 occluded/occluder）；
 * ② occluded 或探针窗口后 delivered===false → 取元素中心点 dispatchMouseClick（CDP 坐标三连），
 *    坐标来源：页内 refMap 元素 rect（resolveTargetForInput），或 AX ref 预解析坐标
 *    （resolvedPoint，由 service 经 refTable→backendNodeId→getContentQuads 提供）；
 * ③ 再读探针：事件目标链不含目标（链天然覆盖交互祖先）→ CLICK_NOT_DELIVERED + occluder。
 *
 * AX ref 命名空间与页内 refMap 不同（2a 交接约定）：resolvedPoint 提供时跳过 JS click，
 * 直接 CDP 坐标点击，探针以无目标模式安装（只验 delivered）。
 */
export async function actClickWithFallback(input: {
  cdp: BrowserAutomationCdpSession;
  executeJavaScript: (script: string) => Promise<unknown>;
  payload: BrowserAutomationActPayload;
  /** AX ref 的预解析坐标（viewport CSS px）；提供时走纯 CDP 路径。 */
  resolvedPoint?: { x: number; y: number };
  /** mouse_click：跳过 JS click 直接 CDP 坐标点击。 */
  forceCdp?: boolean;
  /** 探针观察窗口（默认 50ms；测试可传 0）。 */
  probeWindowMs?: number;
}): Promise<ClickFallbackResult> {
  const { cdp, executeJavaScript, payload } = input;
  const probeWindowMs = input.probeWindowMs ?? CLICK_PROBE_WINDOW_MS;
  // AX ref 不能交给页内 refMap 解析（命名空间不同），探针以无目标模式安装
  const probeTargetJson = input.resolvedPoint ? '{}' : serializePayload(payload);
  let probeAvailable = true;

  const installProbe = async (): Promise<void> => {
    if (!probeAvailable) return;
    try {
      await executeJavaScript(
        `${buildObserveBootstrap()}; window.__stoBrowserAutomation.installClickProbe(${probeTargetJson})`,
      );
    } catch {
      // 旧版页内脚本（波次 1 前缓存）无探针函数 → 降级为仅靠 occluded 判定
      probeAvailable = false;
    }
  };

  const readProbe = async (): Promise<ClickProbeState | null> => {
    if (!probeAvailable) return null;
    try {
      const state = await executeJavaScript(
        `${buildObserveBootstrap()}; window.__stoBrowserAutomation.readClickProbe()`,
      );
      return parseClickProbe(state);
    } catch {
      probeAvailable = false;
      return null;
    }
  };

  // ── 纯 CDP 路径（mouse_click / AX ref）──
  if (input.forceCdp || input.resolvedPoint) {
    let point = input.resolvedPoint;
    let stableKey = payload.stableKey;
    if (!point) {
      const resolved = await resolveTargetForInput(executeJavaScript, payload);
      if (!resolved.found || resolved.centerX == null || resolved.centerY == null) {
        return { ...clickGuardFailure(payload.action, resolved), via: 'cdp' };
      }
      point = { x: resolved.centerX, y: resolved.centerY };
      stableKey = resolved.stableKey ?? stableKey;
    }
    await installProbe();
    await dispatchMouseClick(cdp, point.x, point.y);
    if (probeWindowMs > 0) await delay(probeWindowMs);
    const probe = await readProbe();
    // 探针可用时要求事件真实投递；AX 无目标探针只验 delivered，DOM 探针要求命中目标链
    if (probe && (!probe.delivered || (!input.resolvedPoint && !probe.targetMatched))) {
      return {
        success: false,
        action: payload.action,
        via: 'cdp',
        probeDelivered: false,
        ref: payload.ref,
        stableKey,
        error: 'Click was dispatched but not delivered to the target (CDP coordinate path)',
        errorCode: 'CLICK_NOT_DELIVERED',
      };
    }
    return {
      success: true,
      action: payload.action,
      via: 'cdp',
      probeDelivered: probe ? true : undefined,
      ref: payload.ref,
      stableKey,
    };
  }

  // ── ① JS click（探针先于点击安装）──
  await installProbe();
  const jsResult = (await executeJavaScript(
    `${buildObserveBootstrap()}; window.__stoBrowserAutomation.act(${JSON.stringify({ ...payload, action: 'click' })})`,
  )) as PageClickActResult | null;

  if (jsResult?.staleRef) {
    return {
      success: false,
      action: payload.action,
      via: 'js',
      ref: payload.ref,
      stableKey: payload.stableKey,
      error: jsResult.error ?? 'Stale element reference: re-observe required',
      errorCode: 'STALE_REF',
    };
  }
  if (!jsResult?.success) {
    return {
      success: false,
      action: payload.action,
      via: 'js',
      ref: jsResult?.ref ?? payload.ref,
      stableKey: jsResult?.stableKey ?? payload.stableKey,
      error: jsResult?.error ?? 'Element not found',
    };
  }

  if (probeWindowMs > 0) await delay(probeWindowMs);
  const probeAfterJs = await readProbe();
  const jsDelivered = probeAfterJs ? probeAfterJs.delivered && probeAfterJs.targetMatched : true;
  if (!jsResult.occluded && jsDelivered) {
    return {
      success: true,
      action: payload.action,
      via: 'js',
      probeDelivered: probeAfterJs ? true : undefined,
      ref: jsResult.ref ?? payload.ref,
      stableKey: jsResult.stableKey ?? payload.stableKey,
    };
  }

  // ── ② 被遮挡或未投递 → CDP 坐标三连（真实输入前过页内可见性守卫）──
  const resolved = await resolveTargetForInput(executeJavaScript, payload);
  if (!resolved.found || resolved.centerX == null || resolved.centerY == null) {
    if (jsResult.occluded) {
      // 被遮挡且坐标不可达 → 降级失败
      return {
        success: false,
        action: payload.action,
        via: 'js',
        occluded: true,
        occluder: jsResult.occluder,
        ref: jsResult.ref ?? payload.ref,
        stableKey: jsResult.stableKey ?? payload.stableKey,
        error: `Click target is occluded and CDP fallback coordinates are unavailable${jsResult.occluder ? ` (occluder: ${jsResult.occluder})` : ''}`,
        errorCode: 'CLICK_OCCLUDED',
      };
    }
    return clickGuardFailure(payload.action, resolved);
  }

  await installProbe(); // 探针为一次性：JS click 已消费 → CDP 投递前重挂
  await dispatchMouseClick(cdp, resolved.centerX, resolved.centerY);
  if (probeWindowMs > 0) await delay(probeWindowMs);
  const probeAfterCdp = await readProbe();

  // ── ③ 探针终验：事件目标链不含目标（链覆盖交互祖先）→ CLICK_NOT_DELIVERED ──
  if (probeAfterCdp && (!probeAfterCdp.delivered || !probeAfterCdp.targetMatched)) {
    return {
      success: false,
      action: payload.action,
      via: 'cdp',
      probeDelivered: false,
      occluded: jsResult.occluded === true ? true : undefined,
      occluder: jsResult.occluder,
      ref: resolved.ref ?? jsResult.ref ?? payload.ref,
      stableKey: resolved.stableKey ?? jsResult.stableKey ?? payload.stableKey,
      error: `Click not delivered to target${jsResult.occluder ? ` (occluder: ${jsResult.occluder})` : ''}`,
      errorCode: 'CLICK_NOT_DELIVERED',
    };
  }

  return {
    success: true,
    action: payload.action,
    via: 'cdp',
    probeDelivered: probeAfterCdp ? true : undefined,
    occluded: jsResult.occluded === true ? true : undefined,
    occluder: jsResult.occluder,
    ref: resolved.ref ?? jsResult.ref ?? payload.ref,
    stableKey: resolved.stableKey ?? jsResult.stableKey ?? payload.stableKey,
  };
}

export function getOrCreateCdpSession(
  webContents: WebContents,
  cache: Map<number, BrowserAutomationCdpSession>,
): BrowserAutomationCdpSession {
  let cdp = cache.get(webContents.id);
  if (!cdp) {
    cdp = new BrowserAutomationCdpSession(webContents);
    cache.set(webContents.id, cdp);
  }
  return cdp;
}

export { valuesMatch };
