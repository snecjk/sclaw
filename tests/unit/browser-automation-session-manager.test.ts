// @vitest-environment node
/**
 * 波次 1 · B9 session-manager 增量（配合计划 §七 dialog-guard 行的 beforeunload 补丁覆盖点）：
 * - createManagedSession 挂 will-prevent-unload 并 preventDefault
 *   （beforeunload 不触发 CDP javascriptDialogOpening，须窗口侧拦截）；
 * - getManagedWindowVisibility 上报可见/最小化状态（B7 assertPageActionable 数据源）。
 */
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => {
  class FakeBrowserWindow {
    static last: FakeBrowserWindow | null = null;
    webContents: EventEmitter & { isDestroyed: () => boolean; id: number };
    private title = '';
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    private closed = false;

    constructor(public options: { show?: boolean }) {
      this.webContents = Object.assign(new EventEmitter(), {
        isDestroyed: () => false,
        id: Math.floor(Math.random() * 100_000) + 1,
      });
      FakeBrowserWindow.last = this;
    }

    on(event: string, handler: (...args: unknown[]) => void) {
      const list = this.listeners.get(event) ?? [];
      list.push(handler);
      this.listeners.set(event, list);
      return this;
    }

    emitTitleUpdated(title: string) {
      const event = { preventDefault: vi.fn() };
      for (const handler of this.listeners.get('page-title-updated') ?? []) {
        handler(event, title);
      }
      return event;
    }

    getTitle() {
      return this.title;
    }

    setTitle(next: string) {
      this.title = next;
    }

    isDestroyed() {
      return this.closed;
    }

    isVisible() {
      return this.options.show === true && !this.closed;
    }

    isMinimized() {
      return false;
    }

    async loadURL() {
      return undefined;
    }

    close() {
      this.closed = true;
    }
  }
  return {
    BrowserWindow: FakeBrowserWindow,
    webContents: { fromId: vi.fn(() => null) },
    app: { getPath: vi.fn(() => '/tmp/stoclaw-test'), isPackaged: false },
  };
});

vi.mock('electron', () => electronMock);
vi.mock('../../electron/main/services/sclaw-embed-browser-session', () => ({
  prepareSclawEmbedBrowserSession: vi.fn(async () => undefined),
}));
vi.mock('../../electron/main/services/sclaw-embed-browser-runtime', () => ({
  ensureSclawEmbedBridgeForRuntime: vi.fn(() => true),
  getSclawEmbedBrowserRuntime: vi.fn(() => null),
}));

import {
  closeManagedSession,
  closeOwnedSession,
  createManagedSession,
  getManagedWindowVisibility,
} from '../../electron/services/browser-automation/session-manager';

describe('session-manager managed 窗口增量（B9/B7）', () => {
  it('createManagedSession 挂 will-prevent-unload 并 preventDefault', async () => {
    const { webContents } = await createManagedSession({ url: 'https://example.com/', show: true });

    const preventDefault = vi.fn();
    (webContents as unknown as EventEmitter).emit('will-prevent-unload', { preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('getManagedWindowVisibility 反映 show 状态；close 后返回 null', async () => {
    const shown = await createManagedSession({ url: 'https://example.com/', show: true });
    expect(getManagedWindowVisibility(shown.sessionId)).toEqual({ visible: true, minimized: false });

    const hidden = await createManagedSession({ url: 'https://example.com/', show: false });
    expect(getManagedWindowVisibility(hidden.sessionId)).toEqual({ visible: false, minimized: false });

    expect(getManagedWindowVisibility('managed-unknown')).toBeNull();

    closeManagedSession(hidden.sessionId);
    expect(getManagedWindowVisibility(hidden.sessionId)).toBeNull();
  });

  it('prefixes managed window titles with [自动操作]', async () => {
    await createManagedSession({ url: 'https://example.com/', show: true });
    const win = (electronMock.BrowserWindow as unknown as { last: { getTitle: () => string; emitTitleUpdated: (title: string) => { preventDefault: ReturnType<typeof vi.fn> } } }).last;
    expect(win.getTitle().startsWith('[自动操作] ')).toBe(true);
    const event = win.emitTitleUpdated('新标题');
    expect(event.preventDefault).toHaveBeenCalled();
    expect(win.getTitle()).toBe('[自动操作] 新标题');
  });

  it('closeOwnedSession skips borrowed sessions', async () => {
    const owned = await createManagedSession({ url: 'https://example.com/', show: true });
    closeOwnedSession({ sessionId: owned.sessionId, ownership: 'borrowed', source: 'managed' });
    expect(getManagedWindowVisibility(owned.sessionId)).not.toBeNull();
    closeOwnedSession({ sessionId: owned.sessionId, ownership: 'owned', source: 'managed' });
    expect(getManagedWindowVisibility(owned.sessionId)).toBeNull();
  });
});
