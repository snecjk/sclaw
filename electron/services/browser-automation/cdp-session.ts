import type { WebContents } from 'electron';
import {
  BROWSER_AUTOMATION_CDP_TIMEOUT_MS,
  type BrowserAutomationBoundingBox,
  type BrowserAutomationErrorCode,
} from '../../../shared/browser-automation/types';
import { logger } from '../../utils/logger';

const CDP_VERSION = '1.3';

/** enableDomains 允许幂等启用的 CDP 域。 */
export type BrowserAutomationCdpDomain = 'Page' | 'Network' | 'DOM' | 'Runtime' | 'Emulation';

/** 构造带 BrowserAutomationErrorCode 错误码的 Error（上层按 code 分流降级）。 */
function cdpError(code: BrowserAutomationErrorCode, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function hasErrorCode(error: unknown): boolean {
  return typeof (error as { code?: unknown } | null)?.code === 'string';
}

/**
 * 识别 debugger 会话失效类错误（site isolation 换进程后 webContents.id 不变但会话已死）。
 */
function isStaleDebuggerError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not attached|detached|target (closed|crashed|destroyed)|session (closed|destroyed)|no session with given id/i
    .test(message);
}

export class BrowserAutomationCdpSession {
  private attached = false;
  private readonly enabledDomains = new Set<string>();
  /** method → handler 集合；debugger 'message' 事件只挂一个分发器，detach 时全量摘除（§六 R2）。 */
  private readonly cdpEventHandlers = new Map<string, Set<(params: unknown) => void>>();
  private debuggerMessageListener: ((event: unknown, method: string, params: unknown) => void) | null = null;

  constructor(private readonly webContents: WebContents) {}

  get isDestroyed(): boolean {
    return this.webContents.isDestroyed();
  }

  get rawWebContents(): WebContents {
    return this.webContents;
  }

  async attach(): Promise<void> {
    if (this.isDestroyed) throw new Error('WebContents destroyed');
    // 以 debugger.isAttached() 为准校正内部标志：外部 detach（target 崩溃、DevTools 抢占）
    // 后 attached 可能为陈旧 true，这里自愈，保证后续 send 真的能投递。
    if (this.webContents.debugger.isAttached()) {
      this.attached = true;
      return;
    }
    this.attached = false;
    await this.webContents.debugger.attach(CDP_VERSION);
    this.attached = true;
  }

  async detach(): Promise<void> {
    // 无论 attached 状态如何都先摘除事件订阅，防多 session 并存时串扰/泄漏。
    this.removeDebuggerMessageListener();
    this.cdpEventHandlers.clear();
    this.enabledDomains.clear();
    if (!this.attached || this.isDestroyed) return;
    if (this.webContents.debugger.isAttached()) {
      try {
        this.webContents.debugger.detach();
      } catch (error) {
        logger.warn('[browser-automation] CDP detach failed:', error);
      }
    }
    this.attached = false;
  }

  /**
   * 发送 CDP 命令。默认 30s 超时（BROWSER_AUTOMATION_CDP_TIMEOUT_MS），超时 reject
   * { code: 'CDP_TIMEOUT' } —— 串行化（B4）落地后无超时的 send 会堵死整会话队列（§六 R3）。
   * 捕获会话失效类错误时 resetIfStale() 重建后重试一次，第二次失败原样抛出。
   */
  async send<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    opts?: { timeoutMs?: number },
  ): Promise<T> {
    const timeoutMs = opts?.timeoutMs ?? BROWSER_AUTOMATION_CDP_TIMEOUT_MS;
    return this.sendWithRetry<T>(method, params, timeoutMs, true);
  }

  private async sendWithRetry<T>(
    method: string,
    params: Record<string, unknown> | undefined,
    timeoutMs: number,
    allowStaleRetry: boolean,
  ): Promise<T> {
    await this.attach();
    try {
      return await this.withTimeout<T>(this.webContents.debugger.sendCommand(method, params ?? {}), method, timeoutMs);
    } catch (error) {
      if (allowStaleRetry && this.resetIfStale(error)) {
        logger.warn(`[browser-automation] stale CDP session during ${method}, re-attaching once:`, error);
        return this.sendWithRetry<T>(method, params, timeoutMs, false);
      }
      throw error;
    }
  }

  private withTimeout<T>(command: Promise<unknown>, method: string, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(cdpError('CDP_TIMEOUT', `CDP command timed out after ${timeoutMs}ms: ${method}`));
      }, timeoutMs);
      // 超时后底层命令仍可能 settle，then 的两个分支都会兜底 clearTimeout，
      // reject 分支已处理错误，不会遗留 unhandled rejection。
      command.then(
        (result) => {
          clearTimeout(timer);
          resolve(result as T);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  /**
   * 识别 debugger 会话失效并重置内部状态；返回 true 表示已重置、可安全重试 attach/send。
   * webContents 已销毁时返回 false（不可恢复）。
   */
  resetIfStale(error: unknown): boolean {
    if (this.isDestroyed) return false;
    if (!isStaleDebuggerError(error)) return false;
    // 会话已死但 isAttached() 可能仍为 true：尽力 detach 一次，确保下次 attach 是全新会话。
    try {
      if (this.webContents.debugger.isAttached()) {
        this.webContents.debugger.detach();
      }
    } catch {
      // best-effort：死会话上 detach 失败可忽略
    }
    this.attached = false;
    this.enabledDomains.clear();
    return true;
  }

  /** 订阅 CDP 事件（包装 webContents.debugger.on('message')）。 */
  onCdpEvent(method: string, handler: (params: unknown) => void): void {
    let handlers = this.cdpEventHandlers.get(method);
    if (!handlers) {
      handlers = new Set();
      this.cdpEventHandlers.set(method, handlers);
    }
    handlers.add(handler);
    this.ensureDebuggerMessageListener();
  }

  offCdpEvent(method: string, handler: (params: unknown) => void): void {
    const handlers = this.cdpEventHandlers.get(method);
    if (!handlers) return;
    handlers.delete(handler);
    if (handlers.size === 0) {
      this.cdpEventHandlers.delete(method);
    }
    if (this.cdpEventHandlers.size === 0) {
      this.removeDebuggerMessageListener();
    }
  }

  private ensureDebuggerMessageListener(): void {
    if (this.debuggerMessageListener || this.isDestroyed) return;
    this.debuggerMessageListener = (_event: unknown, method: string, params: unknown) => {
      const handlers = this.cdpEventHandlers.get(method);
      if (!handlers) return;
      for (const handler of handlers) {
        try {
          handler(params);
        } catch (error) {
          // 单个 handler 异常不得影响其余订阅者
          logger.warn(`[browser-automation] CDP event handler failed for ${method}:`, error);
        }
      }
    };
    this.webContents.debugger.on('message', this.debuggerMessageListener);
  }

  private removeDebuggerMessageListener(): void {
    if (!this.debuggerMessageListener) return;
    if (!this.isDestroyed) {
      this.webContents.debugger.removeListener('message', this.debuggerMessageListener);
    }
    this.debuggerMessageListener = null;
  }

  /**
   * 幂等启用 CDP 域（内部记录已启用集合，重复调用零开销）。
   * 单域失败抛 { code: 'CDP_DOMAIN_UNSUPPORTED' } 供上层降级（如 AX→DOM 回退）；
   * 已带错误码的失败（如 CDP_TIMEOUT）原样上抛，不伪装成域不支持。
   */
  async enableDomains(...domains: BrowserAutomationCdpDomain[]): Promise<void> {
    for (const domain of domains) {
      if (this.enabledDomains.has(domain)) continue;
      try {
        await this.send(`${domain}.enable`);
      } catch (error) {
        if (hasErrorCode(error)) throw error;
        throw cdpError(
          'CDP_DOMAIN_UNSUPPORTED',
          `CDP domain unavailable: ${domain} (${error instanceof Error ? error.message : String(error)})`,
        );
      }
      this.enabledDomains.add(domain);
    }
  }

  /**
   * 截图：CDP Page.captureScreenshot 主路径（支持 format/quality/clip），
   * 失败（含域不支持）回退 webContents.capturePage（§六 R4）。
   * clip 为页面 CSS px；调用方负责先 scrollIntoView。
   */
  async captureScreenshot(opts?: {
    format?: 'png' | 'jpeg';
    quality?: number;
    clip?: BrowserAutomationBoundingBox;
  }): Promise<Buffer> {
    const format = opts?.format ?? 'png';
    try {
      const params: Record<string, unknown> = { format };
      if (format === 'jpeg' && typeof opts?.quality === 'number') {
        params.quality = opts.quality;
      }
      if (opts?.clip) {
        params.clip = await this.toCdpClip(opts.clip);
      }
      const result = await this.send<{ data?: string }>('Page.captureScreenshot', params);
      if (typeof result?.data === 'string' && result.data.length > 0) {
        return Buffer.from(result.data, 'base64');
      }
      throw new Error('Page.captureScreenshot returned empty data');
    } catch (error) {
      logger.warn('[browser-automation] CDP captureScreenshot failed, falling back to capturePage:', error);
      const image = await this.webContents.capturePage();
      return format === 'jpeg' ? image.toJPEG(opts?.quality ?? 85) : image.toPNG();
    }
  }

  /**
   * clip 坐标换算：页面 CSS px × devicePixelRatio × webContents.getZoomFactor()（计划 §四 B1）。
   * ⚠️ 待波次 2 PoC 实机验证（§六 R4 / §十.2）：若 Electron 转发的 Page.captureScreenshot
   * 的 clip 实按上游 CDP 语义（CSS px + scale 倍率）解释，需移除此换算改传 clip.scale。
   */
  private async toCdpClip(bbox: BrowserAutomationBoundingBox): Promise<Record<string, number>> {
    let devicePixelRatio = 1;
    try {
      const value: unknown = await this.webContents.executeJavaScript('window.devicePixelRatio', true);
      if (typeof value === 'number' && value > 0) {
        devicePixelRatio = value;
      }
    } catch {
      // 读不到 DPR 时按 1 处理
    }
    const scale = devicePixelRatio * this.webContents.getZoomFactor();
    return {
      x: bbox.x * scale,
      y: bbox.y * scale,
      width: bbox.width * scale,
      height: bbox.height * scale,
      scale: 1,
    };
  }

  /**
   * 导出 PDF。走 webContents.printToPDF()，不走 CDP Page.printToPDF
   * （headful Chromium 下不可靠，§六 R4）。
   */
  async printToPdf(opts?: {
    printBackground?: boolean;
    landscape?: boolean;
    pageRanges?: string;
    scale?: number;
  }): Promise<Buffer> {
    if (this.isDestroyed) throw new Error('WebContents destroyed');
    const data = await this.webContents.printToPDF({
      printBackground: opts?.printBackground ?? true,
      ...(opts?.landscape !== undefined ? { landscape: opts.landscape } : {}),
      ...(opts?.pageRanges !== undefined ? { pageRanges: opts.pageRanges } : {}),
      ...(opts?.scale !== undefined ? { scale: opts.scale } : {}),
    });
    // 主进程 typings 声明为 Buffer；webview 变体返回 Uint8Array，统一归一为 Buffer。
    return Buffer.isBuffer(data) ? data : Buffer.from(data);
  }
}
