/**
 * JS dialog 守卫（计划 §四 B2 / P0-2）：
 * CDP `Page.javascriptDialogOpening/Closed` 监听 + 策略化应答 + 风暴熔断。
 *
 * - 主路径：cdp.enableDomains('Page') → onCdpEvent 订阅（波次 0 的事件设施，detach 时摘除，§六 R2）；
 * - 降级路径：Page 域抛 CDP_DOMAIN_UNSUPPORTED → 页内 `installDialogHooks`（A2）接管，
 *   记录经 pullPageDialogs() 异步并入 ring buffer；
 * - 风暴熔断：滑动窗口（默认 10 次/5s）达阈 → storming 期间一律 dismiss，
 *   service 层 act 前置检查 isStorming() → DIALOG_STORM 不再向页面投递输入；
 * - beforeunload 不触发 javascriptDialogOpening：managed 窗口在 session-manager 挂
 *   will-prevent-unload，embed webview 在 sclaw-embed-browser-runtime 绑定时挂载。
 */
import {
  BROWSER_AUTOMATION_DIALOG_STORM_LIMIT,
  BROWSER_AUTOMATION_DIALOG_STORM_WINDOW_MS,
  BROWSER_AUTOMATION_MAX_ELEMENTS,
  type BrowserAutomationDialogRecord,
} from '../../../shared/browser-automation/types';
import { buildObserveScript } from '../../../shared/browser-automation/observe-script';
import type { BrowserAutomationCdpSession } from './cdp-session';
import { logger } from '../../utils/logger';

export type DialogPolicy = 'auto-accept' | 'auto-dismiss' | 'record-only';

export interface DialogGuardHandle {
  /** 取走并清空 buffer 内的 dialog 记录（observe/act 返回时附带）。 */
  drain(): BrowserAutomationDialogRecord[];
  /** 风暴熔断状态：触发后在窗口期内保持 true，窗口滑过且无新 dialog 后自动解除。 */
  isStorming(): boolean;
  /**
   * page-hooks 降级模式下从页内 drainDialogs() 拉取记录并入 buffer（幂等、best-effort）。
   * CDP 模式下为空操作。service 在 drain 前调用，保证同周期可见。
   */
  pullPageDialogs(): Promise<void>;
  /** 初始化完成（CDP 订阅就绪或页内 fallback 安装完毕）；service 不阻塞等待，测试可等。 */
  readonly ready: Promise<void>;
  /** 摘除事件订阅与标志位；buffer 中已记录的 dialog 保留供最后一次 drain。 */
  detach(): void;
}

interface CdpDialogOpeningParams {
  type?: string;
  message?: string;
  defaultPrompt?: string;
  hasBrowserHandler?: boolean;
}

const PAGE_DIALOG_RECORD_LIMIT = 50;

function normalizeDialogType(type: unknown): BrowserAutomationDialogRecord['type'] {
  return type === 'confirm' || type === 'prompt' || type === 'beforeunload' ? type : 'alert';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function attachDialogGuard(
  cdp: BrowserAutomationCdpSession,
  opts?: {
    /** 默认 'auto-dismiss'（自动化场景保守，不解 confirm 的"确定"）。 */
    policy?: DialogPolicy;
    /** 默认 BROWSER_AUTOMATION_DIALOG_STORM_LIMIT。 */
    stormLimit?: number;
    /** 默认 BROWSER_AUTOMATION_DIALOG_STORM_WINDOW_MS。 */
    stormWindowMs?: number;
  },
): DialogGuardHandle {
  const policy = opts?.policy ?? 'auto-dismiss';
  const stormLimit = opts?.stormLimit ?? BROWSER_AUTOMATION_DIALOG_STORM_LIMIT;
  const stormWindowMs = opts?.stormWindowMs ?? BROWSER_AUTOMATION_DIALOG_STORM_WINDOW_MS;

  const records: BrowserAutomationDialogRecord[] = [];
  const dialogTimestamps: number[] = [];
  let storming = false;
  let lastDialogAt = 0;
  let detached = false;
  let mode: 'pending' | 'cdp' | 'page-hooks' = 'pending';

  function pushRecord(record: BrowserAutomationDialogRecord): void {
    records.push(record);
    while (records.length > PAGE_DIALOG_RECORD_LIMIT) records.shift();
  }

  function respondToDialog(accept: boolean, promptText?: string): void {
    cdp.send('Page.handleJavaScriptDialog', {
      accept,
      ...(promptText !== undefined ? { promptText } : {}),
    }).catch((error) => {
      logger.warn('[browser-automation] Page.handleJavaScriptDialog failed:', messageOf(error));
    });
  }

  function onDialogOpening(params: unknown): void {
    const p = (params ?? {}) as CdpDialogOpeningParams;
    const type = normalizeDialogType(p.type);
    const now = Date.now();
    lastDialogAt = now;
    dialogTimestamps.push(now);
    while (dialogTimestamps.length > 0 && now - dialogTimestamps[0] > stormWindowMs) {
      dialogTimestamps.shift();
    }
    // 滑动窗口达阈（含本数）即熔断：storming 期间一律 dismiss，不再按 policy 应答
    if (!storming && dialogTimestamps.length >= stormLimit) {
      storming = true;
      logger.warn(
        `[browser-automation] JS dialog storm detected (${dialogTimestamps.length} dialogs in ${stormWindowMs}ms); dismissing all`,
      );
    }

    let handled: BrowserAutomationDialogRecord['handled'];
    if (storming) {
      respondToDialog(false);
      handled = 'dismissed';
    } else if (policy === 'auto-accept') {
      respondToDialog(true, type === 'prompt' ? p.defaultPrompt : undefined);
      handled = 'accepted';
    } else if (policy === 'record-only') {
      // 不接管（不调用 handleJavaScriptDialog），仅记录，留给用户处理
      handled = 'auto';
    } else {
      respondToDialog(false);
      handled = 'dismissed';
    }
    pushRecord({
      type,
      message: String(p.message ?? ''),
      defaultValue: p.defaultPrompt,
      handled,
      at: now,
    });
  }

  function onDialogClosed(_params: unknown): void {
    // 目前仅订阅以便未来扩展（如 dialog 阻塞检测）；记录已在 opening 时完成。
  }

  async function installPageHookFallback(): Promise<void> {
    if (cdp.isDestroyed || detached) return;
    const script = `${buildObserveScript(BROWSER_AUTOMATION_MAX_ELEMENTS)}; window.__stoBrowserAutomation.installDialogHooks(${JSON.stringify(policy)})`;
    await cdp.rawWebContents.executeJavaScript(script, true);
    mode = 'page-hooks';
    logger.warn('[browser-automation] CDP Page domain unavailable; dialog guard degraded to in-page hooks');
  }

  const ready = (async () => {
    try {
      await cdp.enableDomains('Page');
      if (detached) return;
      cdp.onCdpEvent('Page.javascriptDialogOpening', onDialogOpening);
      cdp.onCdpEvent('Page.javascriptDialogClosed', onDialogClosed);
      mode = 'cdp';
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === 'CDP_DOMAIN_UNSUPPORTED') {
        try {
          await installPageHookFallback();
        } catch (fallbackError) {
          logger.warn('[browser-automation] in-page dialog hook fallback failed:', messageOf(fallbackError));
        }
        return;
      }
      // CDP_TIMEOUT 等已带码错误不做页内降级（域存在但链路异常，注入大概率同样失败）
      logger.warn('[browser-automation] dialog guard attach failed:', messageOf(error));
    }
  })();

  return {
    drain(): BrowserAutomationDialogRecord[] {
      const out = records.slice();
      records.length = 0;
      return out;
    },
    isStorming(): boolean {
      // 窗口滑过且无新 dialog 后自动解除熔断，会话可恢复
      return storming && Date.now() - lastDialogAt < stormWindowMs;
    },
    async pullPageDialogs(): Promise<void> {
      if (mode !== 'page-hooks' || detached || cdp.isDestroyed) return;
      try {
        const script = `${buildObserveScript(BROWSER_AUTOMATION_MAX_ELEMENTS)}; window.__stoBrowserAutomation.drainDialogs()`;
        const value: unknown = await cdp.rawWebContents.executeJavaScript(script, true);
        if (!Array.isArray(value)) return;
        for (const item of value) {
          const raw = item as Partial<BrowserAutomationDialogRecord> | null;
          if (!raw || typeof raw !== 'object') continue;
          pushRecord({
            type: normalizeDialogType(raw.type),
            message: typeof raw.message === 'string' ? raw.message : '',
            defaultValue: typeof raw.defaultValue === 'string' ? raw.defaultValue : undefined,
            handled: raw.handled === 'accepted' || raw.handled === 'dismissed' ? raw.handled : 'auto',
            at: typeof raw.at === 'number' ? raw.at : Date.now(),
          });
        }
      } catch (error) {
        logger.warn('[browser-automation] pullPageDialogs failed:', messageOf(error));
      }
    },
    ready,
    detach(): void {
      detached = true;
      cdp.offCdpEvent('Page.javascriptDialogOpening', onDialogOpening);
      cdp.offCdpEvent('Page.javascriptDialogClosed', onDialogClosed);
    },
  };
}
