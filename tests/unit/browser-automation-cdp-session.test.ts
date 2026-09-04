import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { BrowserAutomationCdpSession } from '../../electron/services/browser-automation/cdp-session';

type FakeWebContents = import('electron').WebContents;

/**
 * 手工假 WebContents：debugger 用真 EventEmitter 以覆盖事件分发；
 * attach/detach 状态由 state.attached 模拟（sendCommand 不校验 attach 状态）。
 */
function createFakeWebContents() {
  const emitter = new EventEmitter();
  const state = { attached: false };
  const sendCommand = vi.fn();
  const fakeDebugger = Object.assign(emitter, {
    isAttached: vi.fn(() => state.attached),
    attach: vi.fn(async () => {
      state.attached = true;
    }),
    detach: vi.fn(() => {
      state.attached = false;
    }),
    sendCommand,
  });
  const webContents = {
    id: 1,
    isDestroyed: vi.fn(() => false),
    debugger: fakeDebugger,
    capturePage: vi.fn(async () => ({
      toPNG: () => Buffer.from('fallback-png'),
      toJPEG: () => Buffer.from('fallback-jpeg'),
    })),
    printToPDF: vi.fn(async () => Buffer.from('pdf-bytes')),
    getZoomFactor: vi.fn(() => 1),
    executeJavaScript: vi.fn(async () => 1),
  } as unknown as FakeWebContents;
  return { webContents, fakeDebugger, sendCommand, state };
}

describe('BrowserAutomationCdpSession send', () => {
  it('attaches lazily and passes command result through', async () => {
    const { webContents, fakeDebugger, sendCommand } = createFakeWebContents();
    sendCommand.mockResolvedValue({ ok: 1 });

    const session = new BrowserAutomationCdpSession(webContents);
    const result = await session.send<{ ok: number }>('Runtime.evaluate', { expression: '1' });

    expect(result).toEqual({ ok: 1 });
    expect(fakeDebugger.attach).toHaveBeenCalledTimes(1);
    expect(sendCommand).toHaveBeenCalledWith('Runtime.evaluate', { expression: '1' });
  });

  it('rejects with CDP_TIMEOUT when the command never settles', async () => {
    const { webContents, sendCommand } = createFakeWebContents();
    sendCommand.mockReturnValue(new Promise(() => undefined));

    const session = new BrowserAutomationCdpSession(webContents);
    await expect(session.send('Runtime.evaluate', {}, { timeoutMs: 50 })).rejects.toMatchObject({
      code: 'CDP_TIMEOUT',
    });
  });

  it('re-attaches and retries once on stale debugger session', async () => {
    const { webContents, fakeDebugger, sendCommand } = createFakeWebContents();
    sendCommand
      .mockRejectedValueOnce(new Error('Debugger is not attached'))
      .mockResolvedValueOnce('recovered');

    const session = new BrowserAutomationCdpSession(webContents);
    await expect(session.send('Runtime.evaluate')).resolves.toBe('recovered');

    // 首次 attach + 失效后 resetIfStale detach + 重试时重新 attach
    expect(fakeDebugger.attach).toHaveBeenCalledTimes(2);
    expect(fakeDebugger.detach).toHaveBeenCalledTimes(1);
    expect(sendCommand).toHaveBeenCalledTimes(2);
  });

  it('throws the second failure when the retry also fails', async () => {
    const { webContents, fakeDebugger, sendCommand } = createFakeWebContents();
    sendCommand.mockRejectedValue(new Error('Target closed'));

    const session = new BrowserAutomationCdpSession(webContents);
    await expect(session.send('Runtime.evaluate')).rejects.toThrow('Target closed');
    expect(fakeDebugger.attach).toHaveBeenCalledTimes(2);
    expect(sendCommand).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-stale errors (resetIfStale returns false)', async () => {
    const { webContents, fakeDebugger, sendCommand } = createFakeWebContents();
    sendCommand.mockRejectedValue(new Error('Invalid parameters'));

    const session = new BrowserAutomationCdpSession(webContents);
    await expect(session.send('Runtime.evaluate')).rejects.toThrow('Invalid parameters');
    expect(session.resetIfStale(new Error('Invalid parameters'))).toBe(false);
    expect(fakeDebugger.attach).toHaveBeenCalledTimes(1);
  });
});

describe('BrowserAutomationCdpSession CDP events', () => {
  it('dispatches debugger message events to registered handlers', async () => {
    const { webContents, fakeDebugger } = createFakeWebContents();
    const session = new BrowserAutomationCdpSession(webContents);
    const first = vi.fn();
    const second = vi.fn();

    session.onCdpEvent('Page.frameNavigated', first);
    session.onCdpEvent('Page.frameNavigated', second);
    fakeDebugger.emit('message', {}, 'Page.frameNavigated', { frameId: 'f1' });

    expect(first).toHaveBeenCalledWith({ frameId: 'f1' });
    expect(second).toHaveBeenCalledWith({ frameId: 'f1' });
    expect(fakeDebugger.listenerCount('message')).toBe(1);
  });

  it('offCdpEvent removes only the given handler and unlistens when empty', () => {
    const { webContents, fakeDebugger } = createFakeWebContents();
    const session = new BrowserAutomationCdpSession(webContents);
    const first = vi.fn();
    const second = vi.fn();

    session.onCdpEvent('Page.frameNavigated', first);
    session.onCdpEvent('Page.frameNavigated', second);
    session.offCdpEvent('Page.frameNavigated', first);
    fakeDebugger.emit('message', {}, 'Page.frameNavigated', {});
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(fakeDebugger.listenerCount('message')).toBe(1);

    session.offCdpEvent('Page.frameNavigated', second);
    expect(fakeDebugger.listenerCount('message')).toBe(0);
  });

  it('a throwing handler does not break other subscribers', () => {
    const { webContents, fakeDebugger } = createFakeWebContents();
    const session = new BrowserAutomationCdpSession(webContents);
    const good = vi.fn();
    session.onCdpEvent('Page.loadEventFired', () => {
      throw new Error('handler boom');
    });
    session.onCdpEvent('Page.loadEventFired', good);

    expect(() => fakeDebugger.emit('message', {}, 'Page.loadEventFired', {})).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('detach() removes all registered handlers (no leak across sessions)', async () => {
    const { webContents, fakeDebugger } = createFakeWebContents();
    const session = new BrowserAutomationCdpSession(webContents);
    const handler = vi.fn();

    session.onCdpEvent('Page.frameNavigated', handler);
    await session.attach();
    await session.detach();

    expect(fakeDebugger.listenerCount('message')).toBe(0);
    fakeDebugger.emit('message', {}, 'Page.frameNavigated', {});
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('BrowserAutomationCdpSession enableDomains', () => {
  it('is idempotent per domain', async () => {
    const { webContents, sendCommand } = createFakeWebContents();
    sendCommand.mockResolvedValue({});
    const session = new BrowserAutomationCdpSession(webContents);

    await session.enableDomains('Page', 'Network');
    await session.enableDomains('Page', 'Network');

    expect(sendCommand).toHaveBeenCalledTimes(2);
    expect(sendCommand).toHaveBeenNthCalledWith(1, 'Page.enable', {});
    expect(sendCommand).toHaveBeenNthCalledWith(2, 'Network.enable', {});
  });

  it('wraps unknown-domain failures as CDP_DOMAIN_UNSUPPORTED', async () => {
    const { webContents, sendCommand } = createFakeWebContents();
    sendCommand.mockRejectedValue(new Error("'Accessibility.enable' wasn't found"));
    const session = new BrowserAutomationCdpSession(webContents);

    await expect(session.enableDomains('Page')).rejects.toMatchObject({
      code: 'CDP_DOMAIN_UNSUPPORTED',
    });
  });

  it('rethrows coded errors (e.g. CDP_TIMEOUT) without disguising them', async () => {
    const { webContents, sendCommand } = createFakeWebContents();
    sendCommand.mockRejectedValue(Object.assign(new Error('slow'), { code: 'CDP_TIMEOUT' }));
    const session = new BrowserAutomationCdpSession(webContents);

    await expect(session.enableDomains('Network')).rejects.toMatchObject({ code: 'CDP_TIMEOUT' });
  });
});

describe('BrowserAutomationCdpSession captureScreenshot / printToPdf', () => {
  it('uses CDP Page.captureScreenshot with format/quality passthrough', async () => {
    const { webContents, sendCommand } = createFakeWebContents();
    const png = Buffer.from('cdp-png');
    sendCommand.mockResolvedValue({ data: png.toString('base64') });
    const session = new BrowserAutomationCdpSession(webContents);

    const result = await session.captureScreenshot({ format: 'jpeg', quality: 80 });

    expect(result.equals(png)).toBe(true);
    expect(sendCommand).toHaveBeenCalledWith('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
  });

  it('scales clip by devicePixelRatio × zoomFactor (plan §四 B1)', async () => {
    const { webContents, sendCommand } = createFakeWebContents();
    (webContents.executeJavaScript as ReturnType<typeof vi.fn>).mockResolvedValue(2);
    (webContents.getZoomFactor as ReturnType<typeof vi.fn>).mockReturnValue(1.5);
    sendCommand.mockResolvedValue({ data: Buffer.from('x').toString('base64') });
    const session = new BrowserAutomationCdpSession(webContents);

    await session.captureScreenshot({ clip: { x: 10, y: 20, width: 100, height: 50 } });

    expect(sendCommand).toHaveBeenCalledWith('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 30, y: 60, width: 300, height: 150, scale: 1 },
    });
  });

  it('falls back to webContents.capturePage when the CDP path fails', async () => {
    const { webContents, sendCommand } = createFakeWebContents();
    sendCommand.mockRejectedValue(new Error("'Page.captureScreenshot' wasn't found"));
    const session = new BrowserAutomationCdpSession(webContents);

    const result = await session.captureScreenshot();

    expect(result.toString()).toBe('fallback-png');
    expect(webContents.capturePage).toHaveBeenCalledTimes(1);
  });

  it('falls back to JPEG capturePage honoring format', async () => {
    const { webContents, sendCommand } = createFakeWebContents();
    sendCommand.mockRejectedValue(new Error('domain unsupported'));
    const session = new BrowserAutomationCdpSession(webContents);

    const result = await session.captureScreenshot({ format: 'jpeg' });
    expect(result.toString()).toBe('fallback-jpeg');
  });

  it('printToPdf goes through webContents.printToPDF with printBackground default true', async () => {
    const { webContents } = createFakeWebContents();
    const session = new BrowserAutomationCdpSession(webContents);

    const result = await session.printToPdf();

    expect(result.toString()).toBe('pdf-bytes');
    expect(webContents.printToPDF).toHaveBeenCalledWith({ printBackground: true });
  });

  it('printToPdf forwards landscape/pageRanges/scale', async () => {
    const { webContents } = createFakeWebContents();
    const session = new BrowserAutomationCdpSession(webContents);

    await session.printToPdf({ printBackground: false, landscape: true, pageRanges: '1-2', scale: 0.8 });

    expect(webContents.printToPDF).toHaveBeenCalledWith({
      printBackground: false,
      landscape: true,
      pageRanges: '1-2',
      scale: 0.8,
    });
  });
});
