// @vitest-environment node
/**
 * 波次 2 · B4 截图 / PDF 产物（计划 §七 browser-automation-screenshot-pdf.test.ts）：
 * clip 换算、format/quality 透传、artifact ref 完整字段。
 */
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const artifactMock = vi.hoisted(() => ({
  writeBaArtifact: vi.fn(async (input: { bytes: Buffer; kind: string; ext: string; sessionId: string }) => ({
    artifactId: `art-${input.kind}`,
    path: `/tmp/${input.kind}${input.ext}`,
    sha256: 'sha256-deadbeef',
    bytes: input.bytes.byteLength,
    mimeType: input.ext === '.pdf' ? 'application/pdf' : input.ext === '.jpg' ? 'image/jpeg' : 'image/png',
    createdAt: '2026-09-04T00:00:00+08:00',
  })),
}));

const state = vi.hoisted(() => ({
  webContentsByRuntime: new Map<string, unknown>(),
}));

vi.mock('../../electron/services/browser-automation/artifact-writer', () => artifactMock);

vi.mock('../../electron/db/repositories/browser-automation-repository', () => ({
  browserAutomationRepository: {
    upsertSession: vi.fn(async () => undefined),
    createRun: vi.fn(async () => 'run-1'),
    upsertStepRun: vi.fn(async () => undefined),
    listStepRuns: vi.fn(async () => []),
    completeRun: vi.fn(async () => undefined),
    insertArtifact: vi.fn(async () => undefined),
  },
}));

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
    throw new Error('not used');
  }),
  closeManagedSession: vi.fn(),
  closeOwnedSession: vi.fn(),
  navigateWebContents: vi.fn(async () => undefined),
  getManagedWindowVisibility: vi.fn(() => null),
}));

vi.mock('../../electron/main/services/sclaw-embed-browser-runtime', () => ({
  getSclawEmbedBrowserNetworkLog: () => [],
  getSclawEmbedBrowserRuntime: () => ({ visible: true }),
}));

import { BrowserAutomationService } from '../../electron/services/browser-automation/service';

function createFakeWebContents() {
  const emitter = new EventEmitter();
  const dbgState = { attached: false };
  const sendCommand = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === 'Page.captureScreenshot') {
      return { data: Buffer.from(`shot:${JSON.stringify(params ?? {})}`).toString('base64') };
    }
    return {};
  });
  const fakeDebugger = Object.assign(emitter, {
    isAttached: vi.fn(() => dbgState.attached),
    attach: vi.fn(async () => {
      dbgState.attached = true;
    }),
    detach: vi.fn(() => {
      dbgState.attached = false;
    }),
    sendCommand,
  });
  const executeJavaScript = vi.fn(async (script: string): Promise<unknown> => {
    if (script.includes('document.readyState')) return 'complete';
    if (script.includes('getElementPageRect')) {
      return { found: true, rect: { x: 10, y: 20, width: 100, height: 50 }, stableKey: 'k1' };
    }
    if (script.includes('window.devicePixelRatio')) return 2;
    return {
      url: 'https://example.com/',
      title: 'Example',
      timestamp: Date.now(),
      elements: [],
      fingerprint: 'fp',
      navEpoch: 'epochA',
    };
  });
  const wc = {
    id: 7,
    isDestroyed: vi.fn(() => false),
    isLoading: vi.fn(() => false),
    getURL: vi.fn(() => 'https://example.com/'),
    getTitle: vi.fn(() => 'Example'),
    executeJavaScript,
    debugger: fakeDebugger,
    getZoomFactor: vi.fn(() => 1),
    capturePage: vi.fn(async () => ({
      toPNG: () => Buffer.from('fallback-png'),
      toJPEG: () => Buffer.from('fallback-jpeg'),
    })),
    printToPDF: vi.fn(async (opts: Record<string, unknown>) => Buffer.from(`pdf:${JSON.stringify(opts)}`)),
  };
  return { wc, sendCommand, executeJavaScript };
}

describe('B4 captureScreenshot / printToPdf 产物', () => {
  beforeEach(() => {
    state.webContentsByRuntime.clear();
    artifactMock.writeBaArtifact.mockClear();
  });

  it('整页截图走 CDP format/quality 并返回完整 artifact ref', async () => {
    const { wc, sendCommand } = createFakeWebContents();
    state.webContentsByRuntime.set('shot', wc);
    const service = new BrowserAutomationService();
    await service.createSession({ embedRuntimeId: 'shot' });

    const artifact = await service.captureScreenshot('embed-shot', { format: 'jpeg', quality: 80 });

    expect(sendCommand).toHaveBeenCalledWith('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
    expect(artifact).toMatchObject({
      artifactId: 'art-screenshot',
      path: '/tmp/screenshot.jpg',
      sha256: 'sha256-deadbeef',
      mimeType: 'image/jpeg',
      createdAt: '2026-09-04T00:00:00+08:00',
    });
    expect(artifact.bytes).toBeGreaterThan(0);
    expect(artifactMock.writeBaArtifact.mock.calls[0][0]).toMatchObject({ kind: 'screenshot', ext: '.jpg' });
  });

  it('ref clip：页内 getElementPageRect 后按 CSS px×DPR×zoom 换算', async () => {
    const { wc, sendCommand } = createFakeWebContents();
    state.webContentsByRuntime.set('clip', wc);
    const service = new BrowserAutomationService();
    await service.createSession({ embedRuntimeId: 'clip' });

    await service.captureScreenshot('embed-clip', { ref: '@e1', format: 'png' });

    const shotCall = sendCommand.mock.calls.find((call) => call[0] === 'Page.captureScreenshot');
    expect(shotCall?.[1]).toMatchObject({
      format: 'png',
      clip: { x: 20, y: 40, width: 200, height: 100, scale: 1 },
    });
  });

  it('printToPdf 走 webContents.printToPDF 并落盘 pdf artifact', async () => {
    const { wc } = createFakeWebContents();
    state.webContentsByRuntime.set('pdf', wc);
    const service = new BrowserAutomationService();
    await service.createSession({ embedRuntimeId: 'pdf' });

    const artifact = await service.printToPdf('embed-pdf', { landscape: true, pageRanges: '1-2', scale: 0.8 });
    expect(artifact).toMatchObject({
      artifactId: 'art-pdf',
      path: '/tmp/pdf.pdf',
      mimeType: 'application/pdf',
    });
    expect(wc.printToPDF).toHaveBeenCalledWith({
      printBackground: true,
      landscape: true,
      pageRanges: '1-2',
      scale: 0.8,
    });
    expect(artifactMock.writeBaArtifact.mock.calls[0][0]).toMatchObject({ kind: 'pdf', ext: '.pdf' });
  });

  it('act(screenshot) 把 artifact 挂到结果上，不回 base64', async () => {
    const { wc } = createFakeWebContents();
    state.webContentsByRuntime.set('act', wc);
    const service = new BrowserAutomationService();
    await service.createSession({ embedRuntimeId: 'act' });

    const result = await service.act('embed-act', { action: 'screenshot', snapshot: false });
    expect(result.success).toBe(true);
    expect(result.artifact?.artifactId).toBe('art-screenshot');
    expect(JSON.stringify(result)).not.toMatch(/base64/);
  });
});
