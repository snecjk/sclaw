/**
 * Attach a "Inspect Element" context-menu item to embed webview guests
 * so testers / developers can open DevTools on right-click.
 */
import { Menu, webContents } from 'electron';

type ContextMenuHandler = (event: Electron.Event, params: Electron.ContextMenuParams) => void;

const handlers = new Map<number, ContextMenuHandler>();

export function attachSclawEmbedBrowserDevToolsMenu(webContentsId: number): void {
  detachSclawEmbedBrowserDevToolsMenu(webContentsId);

  const wc = webContents.fromId(webContentsId);
  if (!wc || wc.isDestroyed()) return;

  const handler: ContextMenuHandler = (_event, params) => {
    if (wc.isDestroyed()) return;

    const menu = Menu.buildFromTemplate([
      {
        label: '检查元素 (Inspect Element)',
        click: () => {
          if (wc.isDestroyed()) return;
          wc.inspectElement(params.x, params.y);
        },
      },
      { type: 'separator' },
      { label: '打开 DevTools', click: () => { if (!wc.isDestroyed()) wc.openDevTools({ mode: 'detach' }); } },
      { label: '刷新页面', click: () => { if (!wc.isDestroyed()) wc.reload(); } },
      { type: 'separator' },
      { label: '复制页面 URL', click: () => { if (!wc.isDestroyed()) { require('electron').clipboard.writeText(wc.getURL()); } } },
    ]);

    menu.popup();
  };

  wc.on('context-menu', handler);
  handlers.set(webContentsId, handler);
}

export function detachSclawEmbedBrowserDevToolsMenu(webContentsId: number): void {
  const handler = handlers.get(webContentsId);
  if (!handler) return;

  const wc = webContents.fromId(webContentsId);
  if (wc && !wc.isDestroyed()) {
    wc.removeListener('context-menu', handler);
  }
  handlers.delete(webContentsId);
}
