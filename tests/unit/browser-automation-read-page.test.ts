// @vitest-environment node
/**
 * 波次 2a · B4 readPage（计划 §七 browser-automation-read-page.test.ts）：
 * - appendReadPageChunk 三层去重（整页相同 / 前缀增量 / 虚拟列表交界重叠 ≤100 行）；
 * - collectReadPageText：滚动收集、冻结检测（scrollTop 停滞 / rAF renderFrozen）、恢复 scrollTop；
 * - paginateReadPageText：complete/nextStart 分页语义；
 * - service.readPage：串行队列 + 超长文本 artifact 落盘（writeBaArtifact mock）。
 */
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendReadPageChunk,
  collectReadPageText,
  paginateReadPageText,
} from '../../electron/services/browser-automation/read-page';
import { BrowserAutomationService } from '../../electron/services/browser-automation/service';

// ── appendReadPageChunk 三层去重 ─────────────────────────────────────────────

describe('readPage 三层去重（appendReadPageChunk）', () => {
  it('层 1：整页文本与上一屏相同 → 不追加', () => {
    const state = { text: '', lastChunk: '' };
    expect(appendReadPageChunk(state, 'A\nB\nC')).toBeGreaterThan(0);
    expect(appendReadPageChunk(state, 'A\nB\nC')).toBe(0);
    expect(state.text).toBe('A\nB\nC');
  });

  it('层 2：容器返回全量文本且增长 → 只加增量尾', () => {
    const state = { text: '', lastChunk: '' };
    appendReadPageChunk(state, 'line1\nline2');
    const added = appendReadPageChunk(state, 'line1\nline2\nline3');
    expect(added).toBe('\nline3'.length);
    expect(state.text).toBe('line1\nline2\nline3');
    // 无增长 → 不追加
    expect(appendReadPageChunk(state, 'line1\nline2\nline3')).toBe(0);
  });

  it('层 3：虚拟列表相邻批交界重叠（≤100 行）只去交界重叠', () => {
    const state = { text: '', lastChunk: '' };
    appendReadPageChunk(state, 'L1\nL2\nL3\nL4\nL5');
    // 下一屏与上一屏交界重叠 2 行（L4/L5）
    const added = appendReadPageChunk(state, 'L4\nL5\nL6\nL7');
    expect(state.text).toBe('L1\nL2\nL3\nL4\nL5\nL6\nL7');
    expect(added).toBe('L6\nL7'.length);
  });

  it('层 3 边界：完全无重叠时整段追加（以换行分隔）', () => {
    const state = { text: '', lastChunk: '' };
    appendReadPageChunk(state, 'A');
    appendReadPageChunk(state, 'B');
    expect(state.text).toBe('A\nB');
  });
});

// ── collectReadPageText 滚动收集 ────────────────────────────────────────────

interface FakePageOptions {
  totalLines: number;
  linesPerScreen: number;
  /** 模拟无法滚动的容器（scrollTop 钉死）。 */
  pinnedScroll?: boolean;
  /** 模拟渲染冻结（rAF 探针超时）。 */
  renderFrozen?: boolean;
}

/** 假页面：按 scrollTop 返回当前屏可见文本；记录恢复调用。 */
function createFakePage(opts: FakePageOptions) {
  const lineHeight = 20;
  const viewportH = opts.linesPerScreen * lineHeight;
  const lines = Array.from({ length: opts.totalLines }, (_, i) => `L${i}`);
  const scrollHeight = opts.totalLines * lineHeight;
  const page = { scrollTop: 0, restoredTo: null as number | null };

  const exec = vi.fn(async (script: string): Promise<unknown> => {
    const op = (script.match(/"(init|probe|scroll|restore)"/) ?? [])[1];
    const visibleText = () => {
      const first = Math.floor(page.scrollTop / lineHeight);
      return lines.slice(first, first + opts.linesPerScreen + 1).join('\n');
    };
    const metrics = () => ({
      found: true,
      text: visibleText(),
      scrollTop: page.scrollTop,
      viewportH,
      scrollHeight,
      atBottom: page.scrollTop + viewportH >= scrollHeight - 4,
      renderFrozen: opts.renderFrozen === true,
    });
    if (op === 'init') return metrics();
    if (op === 'probe') return metrics();
    if (op === 'scroll') {
      if (!opts.pinnedScroll) {
        const delta = Number((script.match(/"deltaY":(\d+)/) ?? [])[1] ?? 0);
        page.scrollTop = Math.min(page.scrollTop + delta, Math.max(0, scrollHeight - viewportH));
      }
      return metrics();
    }
    if (op === 'restore') {
      const top = Number((script.match(/"top":(\d+)/) ?? [])[1] ?? 0);
      page.scrollTop = top;
      page.restoredTo = top;
      return metrics();
    }
    throw new Error(`unexpected script: ${script.slice(0, 80)}`);
  });

  return { exec, page };
}

describe('readPage 滚动收集（collectReadPageText）', () => {
  it('长页面：0.85 屏步进收集到底，三层去重后每行恰好一次', async () => {
    const { exec, page } = createFakePage({ totalLines: 100, linesPerScreen: 10 });
    const collected = await collectReadPageText({ executeJavaScript: exec }, { settleMs: 0 });

    expect(collected.reachedBottom).toBe(true);
    expect(collected.frozen).toBe(false);
    const resultLines = collected.fullText.split('\n');
    expect(resultLines[0]).toBe('L0');
    expect(resultLines[resultLines.length - 1]).toBe('L99');
    expect(new Set(resultLines).size).toBe(resultLines.length); // 无重复行
    expect(resultLines).toHaveLength(100);
    // 结束后恢复 scrollTop（init 时为 0）
    expect(page.restoredTo).toBe(0);
  });

  it('冻结检测：scrollTop 钉死且无新增文本，连续 2 屏 → frozen 提前终止', async () => {
    const { exec } = createFakePage({ totalLines: 500, linesPerScreen: 10, pinnedScroll: true });
    const collected = await collectReadPageText({ executeJavaScript: exec }, { settleMs: 0 });

    expect(collected.frozen).toBe(true);
    expect(collected.reachedBottom).toBe(false);
    expect(collected.pages).toBeLessThanOrEqual(4); // 首屏 + 停滞 2 屏即终止
    expect(collected.fullText).toContain('L0');
    expect(collected.fullText).not.toContain('L499');
  });

  it('rAF 冻结探针：renderFrozen → 立即停止并上报', async () => {
    const { exec } = createFakePage({ totalLines: 100, linesPerScreen: 10, renderFrozen: true });
    const collected = await collectReadPageText({ executeJavaScript: exec }, { settleMs: 0 });

    expect(collected.renderFrozen).toBe(true);
    expect(collected.pages).toBeLessThanOrEqual(2);
  });

  it('屏数上限：maxPages 截断收集，complete=false', async () => {
    const { exec } = createFakePage({ totalLines: 500, linesPerScreen: 10 });
    const collected = await collectReadPageText(
      { executeJavaScript: exec },
      { settleMs: 0, maxPages: 3 },
    );
    expect(collected.pages).toBe(3);
    expect(collected.reachedBottom).toBe(false);

    const page = paginateReadPageText(collected);
    expect(page.complete).toBe(false); // 未读到底
    expect(page.truncated).toBe(false); // 但字符窗口覆盖已收集全文
  });
});

describe('readPage 分页语义（paginateReadPageText）', () => {
  it('超 MAX_CHARS → truncated + nextStart；续读 startOffset → complete', () => {
    const collected = {
      fullText: 'x'.repeat(24_000) + 'y'.repeat(6_000),
      pages: 10,
      frozen: false,
      renderFrozen: false,
      reachedBottom: true,
    };
    const first = paginateReadPageText(collected);
    expect(first.truncated).toBe(true);
    expect(first.complete).toBe(false);
    expect(first.text).toHaveLength(24_000);
    expect(first.nextStart).toBe(24_000);

    const second = paginateReadPageText(collected, { startOffset: first.nextStart });
    expect(second.truncated).toBe(false);
    expect(second.complete).toBe(true);
    expect(second.text).toHaveLength(6_000);
    expect(second.text.startsWith('y')).toBe(true);
  });
});

// ── service.readPage（串行队列 + artifact 落盘）──

const state = vi.hoisted(() => ({
  webContentsByRuntime: new Map<string, unknown>(),
  runtimeMeta: new Map<string, { visible?: boolean }>(),
}));

const repoMock = vi.hoisted(() => ({
  upsertSession: vi.fn(async () => undefined),
  createRun: vi.fn(async () => 'run-1'),
  upsertStepRun: vi.fn(async () => undefined),
  listStepRuns: vi.fn(async () => [] as Array<Record<string, unknown>>),
  completeRun: vi.fn(async () => undefined),
}));

const artifactMock = vi.hoisted(() => ({
  writeBaArtifact: vi.fn(async (input: { bytes: Buffer; kind: string }) => ({
    artifactId: 'art-1',
    path: '/tmp/browser-artifacts/read-page.md',
    sha256: 'deadbeef',
    bytes: input.bytes.byteLength,
    mimeType: 'text/markdown; charset=utf-8',
    createdAt: '2026-09-05T00:00:00+08:00',
  })),
}));

vi.mock('../../electron/db/repositories/browser-automation-repository', () => ({
  browserAutomationRepository: repoMock,
}));

vi.mock('../../electron/services/browser-automation/artifact-writer', () => artifactMock);

vi.mock('../../electron/services/browser-automation/session-manager', () => ({
  buildEmbedSessionId: (runtimeId: string) => `embed-${runtimeId}`,
  parseEmbedRuntimeId: (sessionId: string) =>
    sessionId.startsWith('embed-') ? sessionId.slice('embed-'.length) || null : null,
  isSessionExpired: () => false,
  logSessionEvent: vi.fn(),
  resolveEmbedWebContents: (runtimeId: string) => state.webContentsByRuntime.get(runtimeId) ?? null,
  resolveSessionWebContents: (session: { source: string; embedRuntimeId?: string }) =>
    session.source === 'embed' && session.embedRuntimeId
      ? state.webContentsByRuntime.get(session.embedRuntimeId) ?? null
      : null,
  createManagedSession: vi.fn(async () => {
    throw new Error('not used in this test file');
  }),
  closeManagedSession: vi.fn(),
  closeOwnedSession: vi.fn(),
  navigateWebContents: vi.fn(async () => undefined),
  getManagedWindowVisibility: vi.fn(() => null),
}));

vi.mock('../../electron/main/services/sclaw-embed-browser-runtime', () => ({
  getSclawEmbedBrowserNetworkLog: () => [],
  getSclawEmbedBrowserRuntime: (runtimeId: string) => state.runtimeMeta.get(runtimeId) ?? null,
}));

function createFakeWebContents(id: number, exec: (script: string) => Promise<unknown>) {
  const emitter = new EventEmitter();
  const dbgState = { attached: false };
  const fakeDebugger = Object.assign(emitter, {
    isAttached: vi.fn(() => dbgState.attached),
    attach: vi.fn(async () => {
      dbgState.attached = true;
    }),
    detach: vi.fn(() => {
      dbgState.attached = false;
    }),
    sendCommand: vi.fn(async () => ({})),
  });
  const wc = {
    id,
    isDestroyed: vi.fn(() => false),
    isLoading: vi.fn(() => false),
    getURL: vi.fn(() => 'https://read.test/'),
    getTitle: vi.fn(() => '长文'),
    executeJavaScript: vi.fn(exec),
    debugger: fakeDebugger,
    getZoomFactor: vi.fn(() => 1),
  } as unknown as import('electron').WebContents;
  return wc;
}

describe('B4 service.readPage', () => {
  beforeEach(() => {
    state.webContentsByRuntime.clear();
    state.runtimeMeta.clear();
    vi.clearAllMocks();
  });

  it('读到底：complete=true、无 artifact；文本经三层去重', async () => {
    const { exec } = createFakePage({ totalLines: 60, linesPerScreen: 10 });
    state.webContentsByRuntime.set('r1', createFakeWebContents(1, exec));
    state.runtimeMeta.set('r1', { visible: true });

    const service = new BrowserAutomationService();
    await service.createSession({ embedRuntimeId: 'r1' });
    const result = await service.readPage('embed-r1', { settleMs: 0 } as never);

    expect(result.complete).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.frozen).toBe(false);
    expect(result.nextStart).toBeUndefined();
    expect(result.artifact).toBeUndefined();
    expect(artifactMock.writeBaArtifact).not.toHaveBeenCalled();
    const lines = result.text.split('\n');
    expect(lines).toHaveLength(60);
    expect(new Set(lines).size).toBe(60);
  });

  it('超长文本：truncated + nextStart，全量经 artifact-writer 落盘返回引用', async () => {
    // 40 字符/行 × 60 屏上限 × 每屏约 17 行 ≈ 41k chars > 24k MAX_CHARS
    const totalLines = 1300;
    const lines = Array.from({ length: totalLines }, (_, i) => `line-${i}-${'z'.repeat(30)}`);
    const lineHeight = 20;
    const viewportH = 400;
    let scrollTop = 0;
    const scrollHeight = totalLines * lineHeight;
    const exec = vi.fn(async (script: string): Promise<unknown> => {
      const op = (script.match(/"(init|probe|scroll|restore)"/) ?? [])[1];
      const metrics = () => ({
        found: true,
        text: lines.slice(Math.floor(scrollTop / lineHeight), Math.floor(scrollTop / lineHeight) + 21).join('\n'),
        scrollTop,
        viewportH,
        scrollHeight,
        atBottom: scrollTop + viewportH >= scrollHeight - 4,
        renderFrozen: false,
      });
      if (op === 'scroll') {
        const delta = Number((script.match(/"deltaY":(\d+)/) ?? [])[1] ?? 0);
        scrollTop = Math.min(scrollTop + delta, scrollHeight - viewportH);
      }
      if (op === 'restore') scrollTop = Number((script.match(/"top":(\d+)/) ?? [])[1] ?? 0);
      return metrics();
    });
    state.webContentsByRuntime.set('r1', createFakeWebContents(1, exec));
    state.runtimeMeta.set('r1', { visible: true });

    const service = new BrowserAutomationService();
    await service.createSession({ embedRuntimeId: 'r1' });
    const result = await service.readPage('embed-r1', { settleMs: 0 } as never);

    expect(result.truncated).toBe(true);
    expect(result.complete).toBe(false);
    expect(result.nextStart).toBe(24_000);
    expect(result.text).toHaveLength(24_000);
    expect(result.artifact).toMatchObject({ artifactId: 'art-1', sha256: 'deadbeef' });
    expect(artifactMock.writeBaArtifact).toHaveBeenCalledTimes(1);
    expect(artifactMock.writeBaArtifact.mock.calls[0][0]).toMatchObject({ kind: 'read_page', ext: '.md' });
    // artifact 内为全量文本（> 24k）
    const artifactBytes = artifactMock.writeBaArtifact.mock.calls[0][0].bytes as Buffer;
    expect(artifactBytes.toString('utf8').length).toBeGreaterThan(24_000);
  });

  it('includeArtifact=true 时即使未截断也落盘', async () => {
    const { exec } = createFakePage({ totalLines: 30, linesPerScreen: 10 });
    state.webContentsByRuntime.set('r1', createFakeWebContents(1, exec));
    state.runtimeMeta.set('r1', { visible: true });

    const service = new BrowserAutomationService();
    await service.createSession({ embedRuntimeId: 'r1' });
    const result = await service.readPage('embed-r1', { settleMs: 0, includeArtifact: true } as never);

    expect(result.complete).toBe(true);
    expect(result.artifact).toBeDefined();
    expect(artifactMock.writeBaArtifact).toHaveBeenCalledTimes(1);
  });
});
