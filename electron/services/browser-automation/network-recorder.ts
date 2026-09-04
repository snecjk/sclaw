/**
 * CDP Network 域有界抓包（计划 §四 B10 / P1-10）：
 * - requestWillBeSent / responseReceived / loadingFinished / loadingFailed 四事件计数与记录；
 * - 有界：环形缓冲 maxEntries（默认 500，超限摘最旧并置 truncated）、body 合计预算
 *   maxTotalBodyBytes（默认 2MB，超预算停止收集新 body）、单 body 上限 256KB
 *   （超出经 bodyArtifactSink 落盘，仅留 bodyArtifactId）；
 * - `Network.getResponseBody` 仅对显式开启 includeBodies 的抓取拉取；
 * - inflight 计数器（getNetworkInflightCounter）与抓包解耦、按 cdp 会话共享，
 *   供 wait-engine 的 networkIdle 作统一数据源（embed/managed 一致，B8/B4.2）。
 */
import { randomUUID } from 'node:crypto';
import {
  BROWSER_AUTOMATION_NETWORK_MAX_BODY_BYTES,
  BROWSER_AUTOMATION_NETWORK_RING_MAX_ENTRIES,
  BROWSER_AUTOMATION_NETWORK_SINGLE_BODY_MAX_BYTES,
  type BrowserAutomationNetworkCaptureOptions,
} from '../../../shared/browser-automation/types';
import type { BrowserAutomationCdpSession } from './cdp-session';
import { logger } from '../../utils/logger';

/** 抓包明细条目（含可选 body，stop 产物落盘用）。 */
export interface NetworkEntry {
  requestId: string;
  url: string;
  method: string;
  status?: number;
  mimeType?: string;
  startTs: number;
  endTs?: number;
  durationMs?: number;
  /** 响应字节数（loadingFinished 的 encodedDataLength）。 */
  encodedBytes?: number;
  /** 仅 includeBodies 时采集；超单条上限时落盘，仅留 bodyArtifactId。 */
  body?: string;
  bodyBytes?: number;
  bodyArtifactId?: string;
  /** body 因预算/异常未收集时为 true。 */
  bodySkipped?: boolean;
  /** 加载失败（loadingFailed）时的错误文案。 */
  errorText?: string;
}

/** 对外摘要条目（不含 body 正文）。 */
export type NetworkEntrySummary = Omit<NetworkEntry, 'body'>;

export interface NetworkCaptureHandle {
  readonly captureId: string;
  /** 供 wait-engine networkIdle 的实时在途计数（共享计数器）。 */
  inflightCount(): number;
  /** 结束抓取：摘除订阅、等待在途 body 拉取收尾，返回全量明细（含 body）与截断标记。 */
  stop(): Promise<{ entries: NetworkEntry[]; truncated: boolean }>;
  /** 同步摘除（disposeSession 清理用）：不等 body 收尾。 */
  detach(): void;
}

export interface NetworkRecorderOptions extends BrowserAutomationNetworkCaptureOptions {
  /** 单条超 256KB 的 body 落盘回调（返回 artifactId）；缺省时超长 body 截断内联。 */
  bodyArtifactSink?: (body: { requestId: string; bytes: Buffer; mimeType?: string }) => Promise<string>;
}

// ── 共享 inflight 计数器（per cdp 会话，WeakMap 幂等）─────────────────────────

export interface NetworkInflightCounter {
  count(): number;
  /** Network 域启用结果：false 表示域不可用，调用方回退 webRequest 日志。 */
  ready: Promise<boolean>;
}

const inflightCounters = new WeakMap<BrowserAutomationCdpSession, NetworkInflightCounter>();

/**
 * 挂共享 inflight 计数器（requestWillBeSent +1 / loadingFinished|loadingFailed -1）。
 * 幂等：同一 cdp 会话复用同一计数器。
 * ⚠️ cdp.detach() 会摘除全部事件订阅（波次 0 设计），此后计数冻结——
 * detach 通常伴随会话销毁，调用方按会话生命周期重建即可。
 */
export function getNetworkInflightCounter(cdp: BrowserAutomationCdpSession): NetworkInflightCounter {
  const existing = inflightCounters.get(cdp);
  if (existing) return existing;

  let inflight = 0;
  const onRequest = (): void => {
    inflight += 1;
  };
  const onSettle = (): void => {
    inflight = Math.max(0, inflight - 1);
  };

  const ready = (async (): Promise<boolean> => {
    try {
      await cdp.enableDomains('Network');
      cdp.onCdpEvent('Network.requestWillBeSent', onRequest);
      cdp.onCdpEvent('Network.loadingFinished', onSettle);
      cdp.onCdpEvent('Network.loadingFailed', onSettle);
      return true;
    } catch (error) {
      logger.warn('[browser-automation] Network domain unavailable for inflight counter:', error);
      return false;
    }
  })();

  const counter: NetworkInflightCounter = { count: () => inflight, ready };
  inflightCounters.set(cdp, counter);
  return counter;
}

// ── 有界抓包 ────────────────────────────────────────────────────────────────

interface CdpRequestWillBeSentParams {
  requestId?: string;
  request?: { url?: string; method?: string };
}

interface CdpResponseReceivedParams {
  requestId?: string;
  response?: { status?: number; mimeType?: string };
}

interface CdpLoadingFinishedParams {
  requestId?: string;
  encodedDataLength?: number;
}

interface CdpLoadingFailedParams {
  requestId?: string;
  errorText?: string;
}

export function startNetworkRecorder(
  cdp: BrowserAutomationCdpSession,
  opts?: NetworkRecorderOptions,
): NetworkCaptureHandle {
  const captureId = `net-${randomUUID()}`;
  const maxEntries = Math.max(1, opts?.maxEntries ?? BROWSER_AUTOMATION_NETWORK_RING_MAX_ENTRIES);
  const maxTotalBodyBytes = Math.max(0, opts?.maxTotalBodyBytes ?? BROWSER_AUTOMATION_NETWORK_MAX_BODY_BYTES);
  const includeBodies = opts?.includeBodies === true;
  const urlFilter = opts?.urlFilter ? new RegExp(opts.urlFilter) : null;

  const counter = getNetworkInflightCounter(cdp);
  const entries: NetworkEntry[] = [];
  const indexByRequestId = new Map<string, number>();
  const pendingBodies = new Set<Promise<void>>();
  let truncated = false;
  let totalBodyBytes = 0;
  let detached = false;

  const matchesFilter = (url: string): boolean => !urlFilter || urlFilter.test(url);

  /** 环形缓冲追加：超上限摘最旧并置 truncated。 */
  const pushEntry = (entry: NetworkEntry): void => {
    entries.push(entry);
    indexByRequestId.set(entry.requestId, entries.length - 1);
    while (entries.length > maxEntries) {
      const dropped = entries.shift();
      if (dropped) indexByRequestId.delete(dropped.requestId);
      truncated = true;
      // shift 后全部下标前移一位：重建索引（500 上限内成本可忽略）
      indexByRequestId.clear();
      entries.forEach((item, index) => indexByRequestId.set(item.requestId, index));
    }
  };

  const fetchBody = (requestId: string, mimeType: string | undefined, entryIndex: number): void => {
    const task = (async (): Promise<void> => {
      try {
        const result = await cdp.send<{ body?: string; base64Encoded?: boolean }>(
          'Network.getResponseBody',
          { requestId },
        );
        if (typeof result?.body !== 'string') return;
        const bytes = result.base64Encoded ? Buffer.from(result.body, 'base64') : Buffer.from(result.body, 'utf8');
        const entry = entries[entryIndex];
        if (!entry || entry.requestId !== requestId) return;
        entry.bodyBytes = bytes.byteLength;
        if (bytes.byteLength > BROWSER_AUTOMATION_NETWORK_SINGLE_BODY_MAX_BYTES) {
          // 单条超 256KB → 走 artifact 落盘，仅留引用
          if (opts?.bodyArtifactSink) {
            try {
              entry.bodyArtifactId = await opts.bodyArtifactSink({ requestId, bytes, mimeType });
            } catch (error) {
              logger.warn('[browser-automation] network body artifact sink failed:', error);
              entry.bodySkipped = true;
            }
          } else {
            // 无 sink：截断内联（不丢主体信号）
            entry.body = bytes.subarray(0, BROWSER_AUTOMATION_NETWORK_SINGLE_BODY_MAX_BYTES).toString('utf8');
            entry.bodySkipped = true;
          }
          totalBodyBytes += Math.min(bytes.byteLength, BROWSER_AUTOMATION_NETWORK_SINGLE_BODY_MAX_BYTES);
          return;
        }
        if (totalBodyBytes + bytes.byteLength > maxTotalBodyBytes) {
          // 合计预算耗尽：停止收集新 body，条目本身继续记录
          entry.bodySkipped = true;
          truncated = true;
          return;
        }
        totalBodyBytes += bytes.byteLength;
        entry.body = bytes.toString('utf8');
      } catch (error) {
        // body 已被浏览器回收（导航/缓存清理）等：标 skipped，不影响其余条目
        const entry = entries[entryIndex];
        if (entry && entry.requestId === requestId) entry.bodySkipped = true;
        logger.warn(`[browser-automation] Network.getResponseBody failed for ${requestId}:`, error);
      }
    })();
    pendingBodies.add(task);
    void task.finally(() => pendingBodies.delete(task));
  };

  const onRequestWillBeSent = (params: unknown): void => {
    if (detached) return;
    const p = (params ?? {}) as CdpRequestWillBeSentParams;
    const requestId = typeof p.requestId === 'string' ? p.requestId : '';
    const url = typeof p.request?.url === 'string' ? p.request.url : '';
    if (!requestId || !url || !matchesFilter(url)) return;
    pushEntry({
      requestId,
      url,
      method: typeof p.request?.method === 'string' ? p.request.method : 'GET',
      startTs: Date.now(),
    });
  };

  const onResponseReceived = (params: unknown): void => {
    if (detached) return;
    const p = (params ?? {}) as CdpResponseReceivedParams;
    const index = typeof p.requestId === 'string' ? indexByRequestId.get(p.requestId) : undefined;
    if (index === undefined) return;
    const entry = entries[index];
    if (typeof p.response?.status === 'number') entry.status = p.response.status;
    if (typeof p.response?.mimeType === 'string') entry.mimeType = p.response.mimeType;
  };

  const settleEntry = (requestId: string): NetworkEntry | undefined => {
    const index = indexByRequestId.get(requestId);
    if (index === undefined) return undefined;
    const entry = entries[index];
    entry.endTs = Date.now();
    entry.durationMs = entry.endTs - entry.startTs;
    return entry;
  };

  const onLoadingFinished = (params: unknown): void => {
    if (detached) return;
    const p = (params ?? {}) as CdpLoadingFinishedParams;
    if (typeof p.requestId !== 'string') return;
    const entry = settleEntry(p.requestId);
    if (!entry) return;
    if (typeof p.encodedDataLength === 'number') entry.encodedBytes = p.encodedDataLength;
    // getResponseBody 仅对显式 includeBodies 的抓取拉取（计划 §四 B10）
    if (includeBodies) {
      const index = indexByRequestId.get(p.requestId);
      if (index !== undefined) fetchBody(p.requestId, entry.mimeType, index);
    }
  };

  const onLoadingFailed = (params: unknown): void => {
    if (detached) return;
    const p = (params ?? {}) as CdpLoadingFailedParams;
    if (typeof p.requestId !== 'string') return;
    const entry = settleEntry(p.requestId);
    if (entry && typeof p.errorText === 'string') entry.errorText = p.errorText;
  };

  const subscribe = (): void => {
    cdp.onCdpEvent('Network.requestWillBeSent', onRequestWillBeSent);
    cdp.onCdpEvent('Network.responseReceived', onResponseReceived);
    cdp.onCdpEvent('Network.loadingFinished', onLoadingFinished);
    cdp.onCdpEvent('Network.loadingFailed', onLoadingFailed);
  };

  const unsubscribe = (): void => {
    cdp.offCdpEvent('Network.requestWillBeSent', onRequestWillBeSent);
    cdp.offCdpEvent('Network.responseReceived', onResponseReceived);
    cdp.offCdpEvent('Network.loadingFinished', onLoadingFinished);
    cdp.offCdpEvent('Network.loadingFailed', onLoadingFailed);
  };

  // 订阅随计数器 ready 落地（Network 域不可用时保持空抓取，不炸会话）
  void counter.ready.then((ok) => {
    if (ok && !detached) subscribe();
  });

  return {
    captureId,
    inflightCount: () => counter.count(),
    async stop() {
      if (!detached) {
        detached = true;
        unsubscribe();
      }
      // body 拉取收尾（有界等待：单条 CDP 命令自带 30s 超时，这里再等一个宽限窗口）
      if (pendingBodies.size > 0) {
        await Promise.allSettled(Array.from(pendingBodies));
      }
      return { entries: entries.slice(), truncated };
    },
    detach(): void {
      if (detached) return;
      detached = true;
      unsubscribe();
    },
  };
}
