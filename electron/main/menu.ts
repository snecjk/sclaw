/**
 * Application Menu Configuration
 * Creates the native application menu for macOS/Windows/Linux
 */
import { Menu, app, BrowserWindow } from 'electron';
import type { LanguageCode } from '../../shared/language';
import { resolveSupportedLanguage } from '../../shared/language';
import { getSetting } from '../utils/store';

type MenuStrings = {
  preferences: string;
  file: string;
  newChat: string;
  edit: string;
  view: string;
  window: string;
  // Role overrides so labels follow app language (not only OS locale)
  about: string;
  services: string;
  hide: string;
  hideOthers: string;
  unhide: string;
  quit: string;
  close: string;
  undo: string;
  redo: string;
  cut: string;
  copy: string;
  paste: string;
  pasteAndMatchStyle: string;
  delete: string;
  selectAll: string;
  reload: string;
  forceReload: string;
  toggleDevTools: string;
  resetZoom: string;
  zoomIn: string;
  zoomOut: string;
  togglefullscreen: string;
  minimize: string;
  zoom: string;
  front: string;
};

const MENU_STRINGS: Record<LanguageCode, MenuStrings> = {
  en: {
    preferences: 'Preferences...',
    file: 'File',
    newChat: 'New Chat',
    edit: 'Edit',
    view: 'View',
    window: 'Window',
    about: 'About',
    services: 'Services',
    hide: 'Hide',
    hideOthers: 'Hide Others',
    unhide: 'Show All',
    quit: 'Quit',
    close: 'Close Window',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    pasteAndMatchStyle: 'Paste and Match Style',
    delete: 'Delete',
    selectAll: 'Select All',
    reload: 'Reload',
    forceReload: 'Force Reload',
    toggleDevTools: 'Toggle Developer Tools',
    resetZoom: 'Actual Size',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    togglefullscreen: 'Toggle Full Screen',
    minimize: 'Minimize',
    zoom: 'Zoom',
    front: 'Bring All to Front',
  },
  zh: {
    preferences: '偏好设置...',
    file: '文件',
    newChat: '新对话',
    edit: '编辑',
    view: '显示',
    window: '窗口',
    about: '关于',
    services: '服务',
    hide: '隐藏',
    hideOthers: '隐藏其他',
    unhide: '显示全部',
    quit: '退出',
    close: '关闭窗口',
    undo: '撤销',
    redo: '重做',
    cut: '剪切',
    copy: '复制',
    paste: '粘贴',
    pasteAndMatchStyle: '粘贴并匹配样式',
    delete: '删除',
    selectAll: '全选',
    reload: '重新加载',
    forceReload: '强制重新加载',
    toggleDevTools: '切换开发者工具',
    resetZoom: '实际大小',
    zoomIn: '放大',
    zoomOut: '缩小',
    togglefullscreen: '切换全屏幕',
    minimize: '最小化',
    zoom: '缩放',
    front: '前置全部窗口',
  },
  ja: {
    preferences: '環境設定...',
    file: 'ファイル',
    newChat: '新しいチャット',
    edit: '編集',
    view: '表示',
    window: 'ウィンドウ',
    about: 'について',
    services: 'サービス',
    hide: '隠す',
    hideOthers: 'ほかを隠す',
    unhide: 'すべてを表示',
    quit: '終了',
    close: 'ウィンドウを閉じる',
    undo: '取り消す',
    redo: 'やり直す',
    cut: 'カット',
    copy: 'コピー',
    paste: 'ペースト',
    pasteAndMatchStyle: 'ペーストしてスタイルを合わせる',
    delete: '削除',
    selectAll: 'すべてを選択',
    reload: '再読み込み',
    forceReload: '強制的に再読み込み',
    toggleDevTools: 'デベロッパーツールを表示',
    resetZoom: '実際のサイズ',
    zoomIn: '拡大',
    zoomOut: '縮小',
    togglefullscreen: 'フルスクリーン切替',
    minimize: '最小化',
    zoom: 'ズーム',
    front: 'すべてを手前に移動',
  },
};

function getMenuStrings(language: LanguageCode): MenuStrings {
  return MENU_STRINGS[language] ?? MENU_STRINGS.en;
}

function navigate(path: string): void {
  const win = BrowserWindow.getFocusedWindow();
  win?.webContents.send('navigate', path);
}

function buildTemplate(t: MenuStrings): Electron.MenuItemConstructorOptions[] {
  const isMac = process.platform === 'darwin';
  const appName = app.name;

  return [
    ...(isMac
      ? [
          {
            label: appName,
            submenu: [
              { role: 'about' as const, label: `${t.about} ${appName}` },
              { type: 'separator' as const },
              {
                label: t.preferences,
                accelerator: 'Cmd+,',
                click: () => navigate('/settings'),
              },
              { type: 'separator' as const },
              { role: 'services' as const, label: t.services },
              { type: 'separator' as const },
              { role: 'hide' as const, label: `${t.hide} ${appName}` },
              { role: 'hideOthers' as const, label: t.hideOthers },
              { role: 'unhide' as const, label: t.unhide },
              { type: 'separator' as const },
              { role: 'quit' as const, label: `${t.quit} ${appName}` },
            ],
          },
        ]
      : []),

    {
      label: t.file,
      submenu: [
        {
          label: t.newChat,
          accelerator: 'CmdOrCtrl+N',
          click: () => navigate('/'),
        },
        ...(!isMac
          ? [
              {
                label: t.preferences,
                accelerator: 'Ctrl+,',
                click: () => navigate('/settings'),
              },
            ]
          : []),
        { type: 'separator' },
        isMac
          ? { role: 'close' as const, label: t.close }
          : { role: 'quit' as const, label: `${t.quit} ${appName}` },
      ],
    },

    {
      label: t.edit,
      submenu: [
        { role: 'undo', label: t.undo },
        { role: 'redo', label: t.redo },
        { type: 'separator' },
        { role: 'cut', label: t.cut },
        { role: 'copy', label: t.copy },
        { role: 'paste', label: t.paste },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' as const, label: t.pasteAndMatchStyle },
              { role: 'delete' as const, label: t.delete },
              { role: 'selectAll' as const, label: t.selectAll },
            ]
          : [
              { role: 'delete' as const, label: t.delete },
              { type: 'separator' as const },
              { role: 'selectAll' as const, label: t.selectAll },
            ]),
      ],
    },

    {
      label: t.view,
      submenu: [
        { role: 'reload', label: t.reload },
        { role: 'forceReload', label: t.forceReload },
        { role: 'toggleDevTools', label: t.toggleDevTools },
        { type: 'separator' },
        { role: 'resetZoom', label: t.resetZoom },
        { role: 'zoomIn', label: t.zoomIn },
        { role: 'zoomOut', label: t.zoomOut },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t.togglefullscreen },
      ],
    },

    {
      label: t.window,
      submenu: [
        { role: 'minimize', label: t.minimize },
        { role: 'zoom', label: t.zoom },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const, label: t.front },
              { type: 'separator' as const },
              { role: 'window' as const },
            ]
          : [{ role: 'close' as const, label: t.close }]),
      ],
    },
  ];
}

/**
 * Create / rebuild application menu using the given language.
 */
export function createMenu(language?: LanguageCode): void {
  const resolved = language ?? resolveSupportedLanguage(app.getLocale());
  const menu = Menu.buildFromTemplate(buildTemplate(getMenuStrings(resolved)));
  Menu.setApplicationMenu(menu);
}

/**
 * Rebuild menu from persisted settings language (call on language change).
 */
export async function syncApplicationMenuFromStore(): Promise<void> {
  const language = resolveSupportedLanguage(await getSetting('language'));
  createMenu(language);
}
