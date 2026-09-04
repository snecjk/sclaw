import type {
  BrowserAutomationPageObservation,
} from '../../../shared/browser-automation/types';
import { BROWSER_AUTOMATION_MAX_ELEMENTS } from '../../../shared/browser-automation/types';
import { buildObserveScript } from '../../../shared/browser-automation/observe-script';
import { logger } from '../../utils/logger';
import { captureAxTree, type AxSnapshot, type RefTable } from './ax-observer';
import type { BrowserAutomationCdpSession } from './cdp-session';

interface RawObservation {
  url?: string;
  title?: string;
  timestamp?: number;
  elements?: BrowserAutomationPageObservation['elements'];
  fingerprint?: string;
  navEpoch?: string;
}

/**
 * observer 内部返回类型：navEpoch 是页内换代检测信号（A2）、axSnapshot 是 AX 模式
 * 的主进程留存（B4 find 检索 / collapsed 下钻依据），两者均不属于对外 observation
 * 契约（service 返回前摘除）。
 */
export interface ObservedPage extends BrowserAutomationPageObservation {
  navEpoch?: string;
  axSnapshot?: AxSnapshot;
}

export interface ObservePageOptions {
  /** 注入页内做 resolveTarget 兜底校验的代际号（仅 DOM 模式使用）。 */
  generation?: number;
  /** 感知模式：dom=注入脚本遍历；ax=CDP Accessibility 树（异常自动回退 dom）。 */
  mode?: 'dom' | 'ax';
  /** AX 模式：只保留交互节点（子树含交互节点的祖先链保留）。 */
  interactiveOnly?: boolean;
  /** AX 模式：对该 ref（collapsed 子树）下钻抓取。 */
  ref?: string;
  /** 解析 opts.ref 所需的上一代际 RefTable。 */
  refTable?: RefTable;
  /** 本次观察将颁发的代际号（AX RefTable 归属，由 service 预知传入）。 */
  refGeneration?: number;
}

function simpleHash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (`0000000${(h >>> 0).toString(16)}`).slice(-8);
}

/** AX 模式观察（B6 委托）：任何异常由调用方回退 DOM。 */
async function observePageAx(
  sessionId: string,
  cdp: BrowserAutomationCdpSession,
  networkState: { networkState: 'idle' | 'loading'; pendingRequests: number },
  opts: ObservePageOptions,
): Promise<ObservedPage> {
  const capture = await captureAxTree(cdp, opts.refGeneration ?? opts.generation ?? 0, {
    interactiveOnly: opts.interactiveOnly,
    ref: opts.ref,
    refTable: opts.refTable,
  });
  const url = cdp.isDestroyed ? '' : cdp.rawWebContents.getURL();
  const title = cdp.isDestroyed ? '' : cdp.rawWebContents.getTitle();
  const textSample = capture.elements
    .slice(0, 20)
    .map((el) => el.name)
    .join('|')
    .slice(0, 500);
  return {
    sessionId,
    url,
    title,
    timestamp: Date.now(),
    elements: capture.elements,
    fingerprint: simpleHash(`${url}|${title}|${capture.elements.length}|${textSample}`),
    networkState: networkState.networkState,
    pendingRequests: networkState.pendingRequests,
    // 代际号由 service 层颁发并在返回前覆写（B4）
    documentGeneration: 0,
    observationMode: 'ax',
    truncated: capture.truncated,
    axSnapshot: capture.snapshot,
  };
}

export async function observePage(
  sessionId: string,
  cdp: BrowserAutomationCdpSession,
  executeJavaScript: (script: string) => Promise<unknown>,
  networkState: { networkState: 'idle' | 'loading'; pendingRequests: number },
  opts?: ObservePageOptions,
): Promise<ObservedPage> {
  // AX 主路径：域不支持/无数据等任何异常 → warn + 回退 DOM 注入观察（§六 R1，接口不变）
  if (opts?.mode === 'ax') {
    try {
      return await observePageAx(sessionId, cdp, networkState, opts);
    } catch (error) {
      logger.warn(
        `[browser-automation] AX observation failed (session=${sessionId}), falling back to DOM:`,
        error,
      );
    }
  }

  // generation 注入页内（resolveTarget 的 STALE_REF 兜底校验基准）；act/wait 链路不传。
  const raw = await executeJavaScript(
    buildObserveScript(BROWSER_AUTOMATION_MAX_ELEMENTS, opts?.generation),
  ) as RawObservation;

  const elements = Array.isArray(raw?.elements)
    ? raw.elements.slice(0, BROWSER_AUTOMATION_MAX_ELEMENTS)
    : [];

  let url = typeof raw?.url === 'string' ? raw.url : '';
  let title = typeof raw?.title === 'string' ? raw.title : '';

  if (!url && !cdp.isDestroyed) {
    url = cdp.rawWebContents.getURL();
    title = cdp.rawWebContents.getTitle();
  }

  return {
    sessionId,
    url,
    title,
    timestamp: typeof raw?.timestamp === 'number' ? raw.timestamp : Date.now(),
    elements,
    fingerprint: typeof raw?.fingerprint === 'string' ? raw.fingerprint : '',
    networkState: networkState.networkState,
    pendingRequests: networkState.pendingRequests,
    // 代际号由 service 层颁发并在返回前覆写（B4）
    documentGeneration: 0,
    observationMode: 'dom',
    navEpoch: typeof raw?.navEpoch === 'string' ? raw.navEpoch : undefined,
  };
}
