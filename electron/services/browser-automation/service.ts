import type {
  BrowserAutomationAction,
  BrowserAutomationActPayload,
  BrowserAutomationActResult,
  BrowserAutomationArtifactRef,
  BrowserAutomationDialogRecord,
  BrowserAutomationErrorCode,
  BrowserAutomationFindMatch,
  BrowserAutomationFindQuery,
  BrowserAutomationFindResult,
  BrowserAutomationNetworkCaptureOptions,
  BrowserAutomationNetworkCaptureStartResult,
  BrowserAutomationNetworkCaptureStopResult,
  BrowserAutomationObserveOptions,
  BrowserAutomationPageObservation,
  BrowserAutomationPrintPdfOptions,
  BrowserAutomationReadPageOptions,
  BrowserAutomationReadPageResult,
  BrowserAutomationRunStatus,
  BrowserAutomationScreenshotOptions,
  BrowserAutomationSession,
  BrowserAutomationValidatorResult,
  BrowserAutomationValidatorSpec,
  BrowserAutomationWaitCondition,
} from '../../../shared/browser-automation/types';
import { BROWSER_AUTOMATION_MAX_ELEMENTS, BROWSER_AUTOMATION_POST_ACTION_SNAPSHOT_MS } from '../../../shared/browser-automation/types';
import { isBrowserAutomationAxEnabled } from '../../../shared/browser-automation/feature-flag';
import { cdpMethodTimeoutMs, isCdpMethodAllowed } from '../../../shared/browser-automation/cdp-allowlist';
import { buildObserveScript } from '../../../shared/browser-automation/observe-script';
import { browserAutomationRepository } from '../../db/repositories/browser-automation-repository';
import { BrowserAutomationCdpSession } from './cdp-session';
import { observePage } from './observer';
import { actOnPage, validateOnPage } from './actor';
import { actClickWithFallback, actFillOrType, actPressKey } from './input';
import { attachDialogGuard, type DialogGuardHandle } from './dialog-guard';
import { searchAxSnapshot, type AxSnapshot, type RefTable } from './ax-observer';
import { collectReadPageText, paginateReadPageText } from './read-page';
import { writeBaArtifact } from './artifact-writer';
import { getNetworkInflightCounter, startNetworkRecorder, type NetworkCaptureHandle } from './network-recorder';
import { waitAfterAction, waitForCondition, type WaitEngineDeps } from './wait-engine';
import {
  buildEmbedSessionId,
  closeOwnedSession,
  createManagedSession,
  getManagedWindowVisibility,
  isSessionExpired,
  logSessionEvent,
  navigateWebContents,
  parseEmbedRuntimeId,
  resolveEmbedWebContents,
  resolveSessionWebContents,
} from './session-manager';
import {
  getSclawEmbedBrowserRuntime,
} from '../../main/services/sclaw-embed-browser-runtime';
import { logger } from '../../utils/logger';
import { sendSclawEmbedAutomationMark } from '../../main/services/sclaw-embed-automation-mark';

interface LiveSession extends BrowserAutomationSession {
  webContentsId: number | null;
  /**
   * showManaged:false 的离屏 managed 窗口属"预期不可见"，创建时打标豁免可见性守卫（B7）。
   * embed 会话不打标（可见性由渲染层 D1 上报）。
   */
  headless?: boolean;
}

/** 真实输入类动作：页面不可见时 fail-fast PAGE_NOT_VISIBLE（读取/导航/滚动类不拦截）。 */
const REAL_INPUT_ACTIONS: ReadonlySet<BrowserAutomationAction> = new Set([
  'click',
  'mouse_click',
  'fill',
  'select',
  'press',
]);

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 构造带 BrowserAutomationErrorCode 错误码的 Error（闸门抛出 → act 捕获转失败结果）。 */
function baError(code: BrowserAutomationErrorCode, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function errorCodeOf(error: unknown): BrowserAutomationErrorCode | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? (code as BrowserAutomationErrorCode) : undefined;
}

/**
 * 步级落库的 observation 摘要（§六 R8：不再全量存 before+after，防 ba_step_run 表膨胀）。
 * AX 模式全量树落盘后的 observationArtifactId 引用由波次 2 填充。
 */
function summarizeObservationForStep(
  observation?: BrowserAutomationPageObservation,
): Record<string, unknown> | null {
  if (!observation) return null;
  return {
    url: observation.url,
    title: observation.title,
    fingerprint: observation.fingerprint,
    elementCount: observation.elements.length,
    documentGeneration: observation.documentGeneration,
    truncated: observation.truncated === true,
  };
}

export class BrowserAutomationService {
  private readonly sessions = new Map<string, LiveSession>();
  private readonly cdpByWebContentsId = new Map<number, BrowserAutomationCdpSession>();
  /** per-session promise 链尾（P0-6 同会话串行化）。 */
  private readonly sessionChains = new Map<string, Promise<unknown>>();
  private readonly embedMarkDepth = new Map<string, number>();
  /** per-session @e 引用代际号（P0-1）：observe 成功时 +1，act 携带校验。 */
  private readonly generations = new Map<string, number>();
  /** per-session 最近一次 observe 上报的 navEpoch（A2）：换代检测信号。 */
  private readonly navEpochs = new Map<string, string>();
  private readonly dialogGuards = new Map<string, DialogGuardHandle>();
  /** AX 模式 ref ↔ backendNodeId 映射（per session+generation，B6；DOM 模式继续用页内 refMap）。 */
  private readonly refTables = new Map<string, RefTable>();
  /** AX 模式最近一次观察的主进程留存（find 树内检索 / collapsed 下钻依据）。 */
  private readonly axSnapshots = new Map<string, AxSnapshot>();
  /** DOM 模式最近一次观察（find 的 DOM 回退检索面）。 */
  private readonly lastDomObservations = new Map<string, BrowserAutomationPageObservation>();
  /** per-session 有界抓包（同时只允许一路；start 会停掉上一路）。 */
  private readonly networkCaptures = new Map<string, NetworkCaptureHandle>();

  async createSession(input: {
    embedRuntimeId?: string;
    url?: string;
    showManaged?: boolean;
  }): Promise<BrowserAutomationSession> {
    if (input.embedRuntimeId) {
      const sessionId = buildEmbedSessionId(input.embedRuntimeId);
      const wc = resolveEmbedWebContents(input.embedRuntimeId);
      if (!wc || wc.isDestroyed()) {
        throw new Error(`Embed browser runtime is not ready: ${input.embedRuntimeId}`);
      }
      const session = this.registerLiveSession({
        sessionId,
        source: 'embed',
        embedRuntimeId: input.embedRuntimeId,
        url: wc.getURL(),
        title: wc.getTitle(),
        webContentsId: wc.id,
        automationPinned: true,
        ownership: 'borrowed',
      });
      await browserAutomationRepository.upsertSession({
        sessionId,
        source: 'embed',
        embedRuntimeId: input.embedRuntimeId,
        url: session.url,
        title: session.title,
        webContentsId: wc.id,
        automationPinned: true,
      });
      return session;
    }

    if (!input.url) {
      throw new Error('url is required when embedRuntimeId is not provided');
    }

    const { sessionId, webContents: wc } = await createManagedSession({
      url: input.url,
      show: input.showManaged,
    });
    const session = this.registerLiveSession({
      sessionId,
      source: 'managed',
      url: wc.getURL(),
      title: wc.getTitle(),
      webContentsId: wc.id,
      automationPinned: true,
      ownership: 'owned',
      // 离屏窗口属预期不可见，豁免 B7 可见性守卫
      headless: input.showManaged !== true,
    });
    await browserAutomationRepository.upsertSession({
      sessionId,
      source: 'managed',
      url: session.url,
      title: session.title,
      webContentsId: wc.id,
      automationPinned: true,
    });
    logSessionEvent('managed session created', { sessionId, url: input.url });
    return session;
  }

  listSessions(): BrowserAutomationSession[] {
    this.pruneExpiredSessions();
    return Array.from(this.sessions.values()).map((session) => this.publicSession(session));
  }

  getSession(sessionId: string): BrowserAutomationSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (isSessionExpired(session.lastActiveAt, session.automationPinned)) {
      this.disposeSession(sessionId);
      return null;
    }
    return this.publicSession(session);
  }

  async startRun(sessionId: string, input?: { runId?: string; workflowRunId?: string | null }): Promise<string> {
    this.requireSession(sessionId);
    return browserAutomationRepository.createRun({
      runId: input?.runId,
      sessionId,
      workflowRunId: input?.workflowRunId ?? null,
    });
  }

  async observe(
    sessionId: string,
    opts?: BrowserAutomationObserveOptions,
  ): Promise<BrowserAutomationPageObservation> {
    return this.enqueue(sessionId, () => this.observeNow(sessionId, opts));
  }

  async find(
    sessionId: string,
    query: BrowserAutomationFindQuery,
  ): Promise<BrowserAutomationFindResult> {
    return this.enqueue(sessionId, () => this.findNow(sessionId, query));
  }

  async readPage(
    sessionId: string,
    opts?: BrowserAutomationReadPageOptions,
  ): Promise<BrowserAutomationReadPageResult> {
    return this.enqueue(sessionId, () => this.readPageNow(sessionId, opts));
  }

  async act(
    sessionId: string,
    payload: BrowserAutomationActPayload,
    runId?: string,
  ): Promise<BrowserAutomationActResult> {
    return this.enqueue(sessionId, () => this.actNow(sessionId, payload, runId));
  }

  async wait(
    sessionId: string,
    condition: BrowserAutomationWaitCondition,
  ): Promise<{ success: boolean; message: string }> {
    return this.enqueue(sessionId, async () => {
      const deps = this.requireDeps(sessionId);
      return waitForCondition(deps.waitDeps, condition);
    });
  }

  async drainDialogs(sessionId: string): Promise<BrowserAutomationDialogRecord[]> {
    return this.enqueue(sessionId, async () => {
      this.requireDeps(sessionId);
      const guard = this.dialogGuards.get(sessionId);
      if (!guard) return [];
      await guard.pullPageDialogs();
      return guard.drain();
    });
  }

  async validate(
    sessionId: string,
    spec: BrowserAutomationValidatorSpec,
    runId?: string,
  ): Promise<BrowserAutomationValidatorResult> {
    return this.enqueue(sessionId, () => this.validateNow(sessionId, spec, runId));
  }

  async completeRun(runId: string, status: BrowserAutomationRunStatus = 'SUCCEEDED'): Promise<void> {
    await browserAutomationRepository.completeRun(runId, status);
  }

  async captureScreenshot(
    sessionId: string,
    opts?: BrowserAutomationScreenshotOptions,
  ): Promise<BrowserAutomationArtifactRef> {
    return this.enqueue(sessionId, () => this.captureScreenshotNow(sessionId, opts));
  }

  async printToPdf(
    sessionId: string,
    opts?: BrowserAutomationPrintPdfOptions,
  ): Promise<BrowserAutomationArtifactRef> {
    return this.enqueue(sessionId, () => this.printToPdfNow(sessionId, opts));
  }

  async startNetworkCapture(
    sessionId: string,
    opts?: BrowserAutomationNetworkCaptureOptions,
  ): Promise<BrowserAutomationNetworkCaptureStartResult> {
    return this.enqueue(sessionId, () => this.startNetworkCaptureNow(sessionId, opts));
  }

  async stopNetworkCapture(
    sessionId: string,
    captureId?: string,
  ): Promise<BrowserAutomationNetworkCaptureStopResult> {
    return this.enqueue(sessionId, () => this.stopNetworkCaptureNow(sessionId, captureId));
  }

  async invokeCdp(
    sessionId: string,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    return this.enqueue(sessionId, () => this.invokeCdpNow(sessionId, method, params));
  }

  disposeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.source === 'managed' || session.ownership === 'owned') {
      closeOwnedSession(session);
    }
    if (session.webContentsId) {
      const cdp = this.cdpByWebContentsId.get(session.webContentsId);
      void cdp?.detach();
      this.cdpByWebContentsId.delete(session.webContentsId);
    }
    const guard = this.dialogGuards.get(sessionId);
    guard?.detach();
    this.dialogGuards.delete(sessionId);
    this.refTables.delete(sessionId);
    this.axSnapshots.delete(sessionId);
    this.lastDomObservations.delete(sessionId);
    this.generations.delete(sessionId);
    this.navEpochs.delete(sessionId);
    this.networkCaptures.get(sessionId)?.detach();
    this.networkCaptures.delete(sessionId);
    this.sessionChains.delete(sessionId);
    this.embedMarkDepth.delete(sessionId);
    this.sessions.delete(sessionId);
  }

  // ── B4 私有设施：串行化 / 代际校验 / 可见性守卫 ─────────────────────────────

  /**
   * per-session promise 链尾接（P0-6）。fn 抛错不断链：链上记 resolved，
   * 调用方拿到原错误。observe/act/wait/validate/captureScreenshot 全部入队。
   */
  private enqueue<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.sessionChains.get(sessionId) ?? Promise.resolve();
    const run = prev.then(async () => {
      this.bumpEmbedAutomationMark(sessionId, 1);
      try {
        return await fn();
      } finally {
        this.bumpEmbedAutomationMark(sessionId, -1);
      }
    });
    const tail: Promise<void> = run.then(
      () => undefined,
      () => undefined,
    );
    this.sessionChains.set(sessionId, tail);
    // 链尾 settle 后若无人再接，自清 entry（disposeSession 兜底删除）
    void tail.then(() => {
      if (this.sessionChains.get(sessionId) === tail) {
        this.sessionChains.delete(sessionId);
      }
    });
    return run;
  }

  private bumpEmbedAutomationMark(sessionId: string, delta: number): void {
    const runtimeId = parseEmbedRuntimeId(sessionId)
      ?? this.sessions.get(sessionId)?.embedRuntimeId;
    if (!runtimeId) return;
    const next = Math.max(0, (this.embedMarkDepth.get(sessionId) ?? 0) + delta);
    if (next === 0) this.embedMarkDepth.delete(sessionId);
    else this.embedMarkDepth.set(sessionId, next);
    const wc = resolveEmbedWebContents(runtimeId);
    if (!wc || wc.isDestroyed()) return;
    sendSclawEmbedAutomationMark(wc.id, runtimeId, next > 0);
  }

  private bumpGeneration(sessionId: string): number {
    const next = (this.generations.get(sessionId) ?? 0) + 1;
    this.generations.set(sessionId, next);
    return next;
  }

  /**
   * 代际闸门（计数比对）：generation === undefined → 灰度期放行 + warn（§八.3）；
   * 不匹配 → throw STALE_REF。
   */
  private assertGeneration(sessionId: string, generation?: number): void {
    if (generation === undefined) {
      logger.warn(`[browser-automation] act without generation, allowed in gray period (session=${sessionId})`);
      return;
    }
    const current = this.generations.get(sessionId) ?? 0;
    if (generation !== current) {
      throw baError('STALE_REF', '页面已变更，请重新 ba_observe');
    }
  }

  /**
   * 可见性守卫（P0-4/B7）：真实输入类动作在不可见页面 fail-fast PAGE_NOT_VISIBLE。
   * embed：读 D1 上报的 runtime meta.visible（未上报视为可见，灰度兼容旧渲染层）；
   * managed：win.isVisible() && !win.isMinimized()；headless 标记会话豁免。
   */
  private assertPageActionable(session: LiveSession, action: BrowserAutomationAction): void {
    if (!REAL_INPUT_ACTIONS.has(action)) return;
    if (session.headless) return;
    if (session.source === 'embed') {
      const runtimeId = session.embedRuntimeId ?? parseEmbedRuntimeId(session.sessionId);
      const meta = runtimeId ? getSclawEmbedBrowserRuntime(runtimeId) : null;
      if (meta && meta.visible === false) {
        throw baError('PAGE_NOT_VISIBLE', '页面当前不可见（embed 窗口被隐藏或切换），拒绝投递真实输入');
      }
      return;
    }
    const visibility = getManagedWindowVisibility(session.sessionId);
    if (visibility && (!visibility.visible || visibility.minimized)) {
      throw baError('PAGE_NOT_VISIBLE', 'managed 窗口不可见或已最小化，拒绝投递真实输入');
    }
  }

  /** observe 本体（调用方须已入队）。成功后颁发代际号并附带 dialog 记录。 */
  private async observeNow(
    sessionId: string,
    opts?: BrowserAutomationObserveOptions,
  ): Promise<BrowserAutomationPageObservation> {
    const deps = this.requireDeps(sessionId);
    const currentGeneration = this.generations.get(sessionId) ?? 0;
    // mode 缺省取 A3 的 level（§八.1 灰度：production 默认 dom，非 production 默认 ax）；
    // AX 异常时 observer 内回退 dom 并如实标注 observationMode。
    const mode = opts?.mode ?? (isBrowserAutomationAxEnabled() ? 'ax' : 'dom');
    const observed = await observePage(
      sessionId,
      deps.cdp,
      deps.executeJavaScript,
      { networkState: deps.networkState, pendingRequests: deps.pendingRequests },
      {
        // 注入当前代际号作为页内兜底校验基准（act 链路不注入，见 observe-script）
        generation: currentGeneration,
        mode,
        interactiveOnly: opts?.interactiveOnly,
        ref: opts?.ref,
        refTable: this.refTables.get(sessionId),
        refGeneration: currentGeneration + 1,
      },
    );
    const generation = this.bumpGeneration(sessionId);
    // navEpoch / axSnapshot 是内部信号，摘除后再返回（不属于对外 observation 契约）
    const { navEpoch, axSnapshot, ...observation } = observed;
    if (navEpoch) {
      this.navEpochs.set(sessionId, navEpoch);
    }
    observation.documentGeneration = generation;

    if (axSnapshot) {
      // AX 模式：ref 表随新代际轮换（旧 ref 即刻失效，act 靠代际闸门拦截）
      axSnapshot.generation = generation;
      this.axSnapshots.set(sessionId, axSnapshot);
      this.refTables.set(sessionId, axSnapshot.refTable);
      this.lastDomObservations.delete(sessionId);
    } else {
      // DOM 观察后 AX 快照失效（ref 命名空间不同，跨模式复用会错位）
      this.axSnapshots.delete(sessionId);
      this.refTables.delete(sessionId);
      this.lastDomObservations.set(sessionId, observation);
    }

    const guard = this.dialogGuards.get(sessionId);
    if (guard) {
      await guard.pullPageDialogs();
      const dialogs = guard.drain();
      if (dialogs.length > 0) {
        observation.dialogs = dialogs;
      }
    }
    return observation;
  }

  /**
   * find 本体（B4）：AX 模式在内存中的最近一棵 AX 树上检索（无树/换代则先 observe）；
   * AX 不可用（已回退 DOM）时退化为最近一次 DOM 观察的元素过滤。复用串行队列与代际机制。
   */
  private async findNow(
    sessionId: string,
    query: BrowserAutomationFindQuery,
  ): Promise<BrowserAutomationFindResult> {
    this.requireSession(sessionId);
    const maxResults = query.maxResults ?? 20;

    let snapshot = this.axSnapshots.get(sessionId);
    if (!snapshot || snapshot.generation !== (this.generations.get(sessionId) ?? 0)) {
      // 无可用 AX 快照：按默认 mode 重新观察一次（observer 内自动回退 DOM）
      await this.observeNow(sessionId);
      snapshot = this.axSnapshots.get(sessionId);
    }

    let all: BrowserAutomationFindMatch[];
    const generation = this.generations.get(sessionId) ?? 0;
    if (snapshot && snapshot.generation === generation) {
      all = searchAxSnapshot(snapshot, query);
    } else {
      all = this.findInDomObservation(sessionId, query, generation);
    }

    const matches = all.slice(0, maxResults);
    const truncated = all.length > matches.length;
    return {
      matches,
      documentGeneration: generation,
      truncated,
      totalMatches: all.length,
      hint: truncated
        ? `共 ${all.length} 条命中，仅返回前 ${maxResults} 条：请用更精确的 text/role/name 或 interactiveOnly 缩小范围`
        : undefined,
    };
  }

  /** DOM 回退检索：DOM 元素本就全是交互节点（页内 refMap 面），interactiveAncestorRef 不适用。 */
  private findInDomObservation(
    sessionId: string,
    query: BrowserAutomationFindQuery,
    generation: number,
  ): BrowserAutomationFindMatch[] {
    const observation = this.lastDomObservations.get(sessionId);
    if (!observation || observation.documentGeneration !== generation) return [];
    const text = query.text?.trim().toLowerCase();
    const role = query.role?.trim().toLowerCase();
    const name = query.name?.trim().toLowerCase();
    const interactiveOnly = query.interactiveOnly ?? true;
    return observation.elements
      .filter((el) => {
        if (text && !`${el.name}\n${el.value ?? ''}`.toLowerCase().includes(text)) return false;
        if (role && el.role.toLowerCase() !== role) return false;
        if (name && !el.name.toLowerCase().includes(name)) return false;
        if (interactiveOnly && !el.clickable && !el.editable) return false;
        return Boolean(text || role || name);
      })
      .map((el) => ({
        ref: el.ref,
        stableKey: el.stableKey,
        role: el.role,
        name: el.name,
        boundingBox: el.boundingBox,
      }));
  }

  /**
   * readPage 本体（B4）：页内滚动收集（真滚动容器、0.85 屏步进、400ms 增长观察、
   * 三层去重、冻结检测、恢复 scrollTop）；超长文本经 artifact-writer 落盘返回引用。
   */
  private async readPageNow(
    sessionId: string,
    opts?: BrowserAutomationReadPageOptions,
  ): Promise<BrowserAutomationReadPageResult> {
    const deps = this.requireDeps(sessionId);
    const collected = await collectReadPageText(
      { executeJavaScript: deps.executeJavaScript },
      opts,
    );
    const page = paginateReadPageText(collected, opts);

    let artifact: BrowserAutomationArtifactRef | undefined;
    if ((page.truncated || opts?.includeArtifact) && collected.fullText.length > 0) {
      artifact = await writeBaArtifact({
        bytes: Buffer.from(collected.fullText, 'utf8'),
        kind: 'read_page',
        ext: '.md',
        sessionId,
      });
    }

    this.touchSession(this.requireSession(sessionId));
    return {
      text: page.text,
      pages: collected.pages,
      frozen: collected.frozen || collected.renderFrozen,
      truncated: page.truncated,
      complete: page.complete,
      nextStart: page.nextStart,
      artifact,
    };
  }

  /** act 本体（调用方须已入队）。闸门：dialog 风暴 → 代际计数 → 可见性 → navEpoch 换代。 */
  private async actNow(
    sessionId: string,
    payload: BrowserAutomationActPayload,
    runId?: string,
  ): Promise<BrowserAutomationActResult> {
    const session = this.requireSession(sessionId);

    // 闸门 0：dialog 风暴熔断（B2）——不再向页面投递任何输入
    const guard = this.dialogGuards.get(sessionId);
    if (guard?.isStorming()) {
      return {
        success: false,
        action: payload.action,
        error: '检测到 JS dialog 风暴，会话已熔断降级（窗口期后自动恢复）',
        errorCode: 'DIALOG_STORM',
        dialogs: guard.drain(),
      };
    }

    // 闸门 1：代际计数比对（前置失败 STALE_REF，不计 step）
    try {
      this.assertGeneration(sessionId, payload.generation);
    } catch (error) {
      if (errorCodeOf(error) === 'STALE_REF') {
        return {
          success: false,
          action: payload.action,
          error: error instanceof Error ? error.message : String(error),
          errorCode: 'STALE_REF',
        };
      }
      throw error;
    }

    // 闸门 2：可见性守卫（真实输入类 fail-fast PAGE_NOT_VISIBLE，不计 step）
    try {
      this.assertPageActionable(session, payload.action);
    } catch (error) {
      if (errorCodeOf(error) === 'PAGE_NOT_VISIBLE') {
        return {
          success: false,
          action: payload.action,
          error: error instanceof Error ? error.message : String(error),
          errorCode: 'PAGE_NOT_VISIBLE',
        };
      }
      throw error;
    }

    const deps = this.requireDeps(sessionId);
    const stepIndex = runId ? await this.nextStepIndex(runId) : 0;
    const started = Date.now();
    const navEpochAtEntry = this.navEpochs.get(sessionId);
    // act 链路内部观察固定 DOM 模式：act 的 ref 解析走页内 refMap（AX ref→输入投递的接线属波次 2b B7）
    const observationBefore = await this.observeNow(sessionId, { mode: 'dom' });

    // 闸门 3：observationBefore 发现 navEpoch 换代（静默导航/crash 后页面已替换），
    // payload 携带的 @e 引用全部失效 → STALE_REF（附新 observation 供客户端直接续用，不计 step）
    if (
      payload.generation !== undefined
      && navEpochAtEntry !== undefined
      && this.navEpochs.get(sessionId) !== navEpochAtEntry
    ) {
      return {
        success: false,
        action: payload.action,
        error: '页面已发生导航或重载，请携带最新 documentGeneration 重试',
        errorCode: 'STALE_REF',
        observation: observationBefore,
      };
    }

    let result: BrowserAutomationActResult;
    if (payload.action === 'navigate' && payload.url) {
      await navigateWebContents(deps.webContents, payload.url);
      await waitAfterAction(deps.waitDeps, { source: session.source, action: 'navigate' });
      result = { success: true, action: 'navigate' };
    } else if (payload.action === 'fill') {
      result = await actFillOrType({
        cdp: deps.cdp,
        executeJavaScript: deps.executeJavaScript,
        payload,
      });
      if (result.success) {
        await waitAfterAction(deps.waitDeps, { source: session.source, action: payload.action });
      }
    } else if (payload.action === 'press') {
      result = await actPressKey({
        cdp: deps.cdp,
        executeJavaScript: deps.executeJavaScript,
        payload,
      });
      if (result.success) {
        await waitAfterAction(deps.waitDeps, { source: session.source, action: payload.action });
      }
    } else if (payload.action === 'click' || payload.action === 'mouse_click') {
      result = await actClickWithFallback({
        cdp: deps.cdp,
        executeJavaScript: deps.executeJavaScript,
        payload,
        forceCdp: payload.action === 'mouse_click',
      });
      if (result.success) {
        await waitAfterAction(deps.waitDeps, { source: session.source, action: payload.action });
      }
    } else if (payload.action === 'screenshot') {
      try {
        const artifact = await this.captureScreenshotNow(sessionId, {
          ref: payload.ref,
          format: payload.value === 'jpeg' || payload.value === 'jpg' ? 'jpeg' : 'png',
        });
        result = { success: true, action: 'screenshot', artifact, ref: payload.ref };
      } catch (error) {
        result = {
          success: false,
          action: 'screenshot',
          error: error instanceof Error ? error.message : String(error),
          errorCode: errorCodeOf(error),
        };
      }
    } else if (payload.action === 'print_pdf') {
      try {
        const artifact = await this.printToPdfNow(sessionId);
        result = { success: true, action: 'print_pdf', artifact };
      } catch (error) {
        result = {
          success: false,
          action: 'print_pdf',
          error: error instanceof Error ? error.message : String(error),
          errorCode: errorCodeOf(error),
        };
      }
    } else if (payload.action === 'read_page') {
      try {
        const page = await this.readPageNow(sessionId, { includeArtifact: true });
        result = { success: true, action: 'read_page', artifact: page.artifact };
      } catch (error) {
        result = {
          success: false,
          action: 'read_page',
          error: error instanceof Error ? error.message : String(error),
          errorCode: errorCodeOf(error),
        };
      }
    } else if (payload.action === 'network_capture') {
      try {
        const op = payload.value === 'stop'
          ? 'stop'
          : this.networkCaptures.has(sessionId) && payload.value !== 'start'
            ? 'stop'
            : 'start';
        if (op === 'start') {
          const started = await this.startNetworkCaptureNow(sessionId);
          result = { success: true, action: 'network_capture', captureId: started.captureId };
        } else {
          const stopped = await this.stopNetworkCaptureNow(sessionId);
          result = {
            success: true,
            action: 'network_capture',
            captureId: stopped.captureId,
            artifact: stopped.artifact,
          };
        }
      } catch (error) {
        result = {
          success: false,
          action: 'network_capture',
          error: error instanceof Error ? error.message : String(error),
          errorCode: errorCodeOf(error),
        };
      }
    } else {
      result = await actOnPage(deps.executeJavaScript, payload);
      if (result.success) {
        await waitAfterAction(deps.waitDeps, { source: session.source, action: payload.action });
      }
    }

    // 动作后自动快照：payload.snapshot === false 跳过；快照失败降级为动作前观察，不拖垮主动作
    let observationAfter = observationBefore;
    if (result.success && payload.snapshot !== false) {
      await delay(BROWSER_AUTOMATION_POST_ACTION_SNAPSHOT_MS);
      try {
        observationAfter = await this.observeNow(sessionId, { mode: 'dom' });
      } catch (error) {
        logger.warn('[browser-automation] post-action snapshot failed, degrading to pre-action observation:', error);
      }
    }
    result.observation = observationAfter;

    // act 结果附带 dialog 记录（B2）：快照已 drain 的不重复，此处兜住快照跳过/失败及快照后的尾部记录
    const guardAfter = this.dialogGuards.get(sessionId);
    if (guardAfter) {
      await guardAfter.pullPageDialogs();
      const dialogs = guardAfter.drain();
      if (dialogs.length > 0) {
        result.dialogs = dialogs;
      }
    }

    if (runId) {
      await browserAutomationRepository.upsertStepRun({
        runId,
        stepIndex,
        action: payload.action,
        status: result.success ? 'SUCCEEDED' : 'FAILED',
        payloadJson: JSON.stringify(payload),
        observationJson: JSON.stringify({
          before: summarizeObservationForStep(observationBefore),
          after: summarizeObservationForStep(result.observation),
        }),
        error: result.error ?? null,
        durationMs: Date.now() - started,
        completedAt: new Date().toISOString(),
      });
      if (!result.success) {
        await browserAutomationRepository.completeRun(runId, 'FAILED', result.error ?? 'act failed');
      }
    }

    this.touchSession(session);
    return result;
  }

  private async captureScreenshotNow(
    sessionId: string,
    opts?: BrowserAutomationScreenshotOptions,
  ): Promise<BrowserAutomationArtifactRef> {
    const deps = this.requireDeps(sessionId);
    let clip: { x: number; y: number; width: number; height: number } | undefined;
    if (opts?.ref) {
      const rectResult = await deps.executeJavaScript(
        `${buildObserveScript(BROWSER_AUTOMATION_MAX_ELEMENTS)}; window.__stoBrowserAutomation.getElementPageRect(${JSON.stringify({
          ref: opts.ref,
        })})`,
      ) as { found?: boolean; staleRef?: boolean; error?: string; rect?: { x: number; y: number; width: number; height: number } };
      if (rectResult?.staleRef) {
        throw baError('STALE_REF', rectResult.error ?? '页面已变更，请重新 ba_observe');
      }
      if (!rectResult?.found || !rectResult.rect) {
        throw baError('ELEMENT_NOT_FOUND', rectResult?.error ?? `Element not found: ${opts.ref}`);
      }
      clip = rectResult.rect;
    }
    const format = opts?.format ?? 'png';
    const bytes = await deps.cdp.captureScreenshot({
      format,
      quality: opts?.quality,
      clip,
    });
    return writeBaArtifact({
      bytes,
      kind: 'screenshot',
      ext: format === 'jpeg' ? '.jpg' : '.png',
      sessionId,
    });
  }

  private async printToPdfNow(
    sessionId: string,
    opts?: BrowserAutomationPrintPdfOptions,
  ): Promise<BrowserAutomationArtifactRef> {
    const deps = this.requireDeps(sessionId);
    const bytes = await deps.cdp.printToPdf(opts);
    return writeBaArtifact({
      bytes,
      kind: 'pdf',
      ext: '.pdf',
      sessionId,
    });
  }

  private async startNetworkCaptureNow(
    sessionId: string,
    opts?: BrowserAutomationNetworkCaptureOptions,
  ): Promise<BrowserAutomationNetworkCaptureStartResult> {
    const deps = this.requireDeps(sessionId);
    this.networkCaptures.get(sessionId)?.detach();
    const handle = startNetworkRecorder(deps.cdp, {
      ...opts,
      bodyArtifactSink: async ({ bytes }) => {
        const ref = await writeBaArtifact({
          bytes,
          kind: 'network_har',
          ext: '.json',
          sessionId,
        });
        return ref.artifactId;
      },
    });
    this.networkCaptures.set(sessionId, handle);
    return { captureId: handle.captureId };
  }

  private async stopNetworkCaptureNow(
    sessionId: string,
    captureId?: string,
  ): Promise<BrowserAutomationNetworkCaptureStopResult> {
    const handle = this.networkCaptures.get(sessionId);
    if (!handle) {
      throw baError('SESSION_NOT_FOUND', 'No active network capture for this session');
    }
    if (captureId && handle.captureId !== captureId) {
      throw baError('SESSION_NOT_FOUND', `Network capture mismatch: ${captureId}`);
    }
    this.networkCaptures.delete(sessionId);
    const stopped = await handle.stop();
    const summaries = stopped.entries.map((entry) => {
      const { body: _body, ...summary } = entry;
      return summary;
    });
    const artifact = await writeBaArtifact({
      bytes: Buffer.from(JSON.stringify({ entries: stopped.entries, truncated: stopped.truncated }, null, 2)),
      kind: 'network_har',
      ext: '.json',
      sessionId,
    });
    return {
      captureId: handle.captureId,
      entries: summaries,
      truncated: stopped.truncated,
      artifact,
    };
  }

  private async invokeCdpNow(
    sessionId: string,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    if (!isCdpMethodAllowed(method)) {
      throw baError('CDP_METHOD_NOT_ALLOWED', `CDP method is not allowlisted: ${method}`);
    }
    const deps = this.requireDeps(sessionId);
    return deps.cdp.send(method, params, { timeoutMs: cdpMethodTimeoutMs(method) });
  }

  private async validateNow(
    sessionId: string,
    spec: BrowserAutomationValidatorSpec,
    runId?: string,
  ): Promise<BrowserAutomationValidatorResult> {
    const session = this.requireSession(sessionId);
    const deps = this.requireDeps(sessionId);
    const result = await validateOnPage(deps.executeJavaScript, spec);

    if (runId) {
      const stepIndex = await this.nextStepIndex(runId);
      await browserAutomationRepository.upsertStepRun({
        runId,
        stepIndex,
        action: 'validate',
        status: result.passed ? 'SUCCEEDED' : 'FAILED',
        validatorJson: JSON.stringify({ spec, result }),
        error: result.passed ? null : result.message,
        completedAt: new Date().toISOString(),
      });
      if (!result.passed) {
        await browserAutomationRepository.completeRun(runId, 'FAILED', result.message);
      }
    }

    this.touchSession(session);
    return result;
  }

  private registerLiveSession(input: Omit<LiveSession, 'createdAt' | 'lastActiveAt'>): LiveSession {
    const now = Date.now();
    const session: LiveSession = {
      ...input,
      createdAt: now,
      lastActiveAt: now,
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  private publicSession(session: LiveSession): BrowserAutomationSession {
    return {
      sessionId: session.sessionId,
      source: session.source,
      embedRuntimeId: session.embedRuntimeId,
      url: session.url,
      title: session.title,
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt,
      automationPinned: session.automationPinned,
      ownership: session.ownership ?? (session.source === 'embed' ? 'borrowed' : 'owned'),
    };
  }

  private touchSession(session: LiveSession): void {
    session.lastActiveAt = Date.now();
    const wc = resolveSessionWebContents(session);
    if (wc && !wc.isDestroyed()) {
      session.url = wc.getURL();
      session.title = wc.getTitle();
      session.webContentsId = wc.id;
    }
  }

  private pruneExpiredSessions(): void {
    for (const [sessionId, session] of this.sessions.entries()) {
      if (isSessionExpired(session.lastActiveAt, session.automationPinned)) {
        this.disposeSession(sessionId);
      }
    }
  }

  private requireSession(sessionId: string): LiveSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Browser automation session not found: ${sessionId}`);
    }
    if (isSessionExpired(session.lastActiveAt, session.automationPinned)) {
      this.disposeSession(sessionId);
      throw new Error(`Browser automation session expired: ${sessionId}`);
    }
    return session;
  }

  private requireDeps(sessionId: string) {
    const session = this.requireSession(sessionId);
    const wc = resolveSessionWebContents(session);
    if (!wc || wc.isDestroyed()) {
      throw new Error(`Browser webContents is not ready for session: ${sessionId}`);
    }

    let cdp = this.cdpByWebContentsId.get(wc.id);
    if (!cdp) {
      cdp = new BrowserAutomationCdpSession(wc);
      this.cdpByWebContentsId.set(wc.id, cdp);
      // 首次建 cdp 时挂 dialog 守卫（B2）；fire-and-forget 初始化，不阻塞链路。
      // 注：两个 session 共享同一 webContents 时，守卫只随 cdp 的首个创建者挂载一次。
      this.dialogGuards.set(sessionId, attachDialogGuard(cdp));
    }

    const inflight = getNetworkInflightCounter(cdp);
    void inflight.ready;

    const executeJavaScript = async (script: string) => wc.executeJavaScript(script, true);
    const waitDeps: WaitEngineDeps = {
      webContents: wc,
      executeJavaScript,
      getPendingRequestCount: () => inflight.count(),
    };

    const pendingRequests = inflight.count();
    return {
      webContents: wc,
      cdp,
      executeJavaScript,
      waitDeps,
      pendingRequests,
      networkState: wc.isLoading() || pendingRequests > 0 ? 'loading' as const : 'idle' as const,
    };
  }

  private async nextStepIndex(runId: string): Promise<number> {
    const steps = await browserAutomationRepository.listStepRuns(runId);
    if (steps.length === 0) return 0;
    const max = Math.max(...steps.map((step) => Number(step.step_index ?? 0)));
    return max + 1;
  }
}

export const browserAutomationService = new BrowserAutomationService();
