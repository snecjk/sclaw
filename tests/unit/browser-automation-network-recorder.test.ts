import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { BrowserAutomationCdpSession } from '../../electron/services/browser-automation/cdp-session';
import { getNetworkInflightCounter, startNetworkRecorder } from '../../electron/services/browser-automation/network-recorder';

function createFakeWebContents() {
  const emitter = new EventEmitter();
  const state = { attached: false };
  const sendCommand = vi.fn(async () => ({}));
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
  return {
    wc: {
      id: 1,
      isDestroyed: vi.fn(() => false),
      debugger: fakeDebugger,
      getZoomFactor: vi.fn(() => 1),
      executeJavaScript: vi.fn(async () => 1),
    } as unknown as import('electron').WebContents,
    fakeDebugger,
    sendCommand,
  };
}

describe('network recorder', () => {
  it('caps entries, sets truncated, and drops the oldest request', async () => {
    const { wc, fakeDebugger, sendCommand } = createFakeWebContents();
    const cdp = new BrowserAutomationCdpSession(wc);
    const handle = startNetworkRecorder(cdp, { maxEntries: 2 });

    await vi.waitFor(() => {
      expect(sendCommand.mock.calls.some((call) => call[0] === 'Network.enable')).toBe(true);
    });
    // subscribe() 在 enableDomains 成功后的 microtask 里挂上
    await Promise.resolve();

    fakeDebugger.emit('message', {}, 'Network.requestWillBeSent', {
      requestId: 'r1',
      request: { url: 'https://example.com/a', method: 'GET' },
    });
    fakeDebugger.emit('message', {}, 'Network.requestWillBeSent', {
      requestId: 'r2',
      request: { url: 'https://example.com/b', method: 'GET' },
    });
    fakeDebugger.emit('message', {}, 'Network.requestWillBeSent', {
      requestId: 'r3',
      request: { url: 'https://example.com/c', method: 'GET' },
    });

    const stopped = await handle.stop();
    expect(stopped.entries).toHaveLength(2);
    expect(stopped.truncated).toBe(true);
    expect(stopped.entries.map((entry) => entry.requestId)).toEqual(['r2', 'r3']);
  });

  it('inflight 计数随 request 生命周期更新，可供 networkIdle 实时读取', async () => {
    const { wc, fakeDebugger, sendCommand } = createFakeWebContents();
    const cdp = new BrowserAutomationCdpSession(wc);
    const counter = getNetworkInflightCounter(cdp);

    await vi.waitFor(() => {
      expect(sendCommand.mock.calls.some((call) => call[0] === 'Network.enable')).toBe(true);
    });
    await Promise.resolve();

    expect(counter.count()).toBe(0);
    fakeDebugger.emit('message', {}, 'Network.requestWillBeSent', { requestId: 'r1' });
    expect(counter.count()).toBe(1);
    fakeDebugger.emit('message', {}, 'Network.loadingFinished', { requestId: 'r1' });
    expect(counter.count()).toBe(0);
  });
});
