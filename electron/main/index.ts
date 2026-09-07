/**
 * Electron Main Process Entry
 * Manages window creation, system tray, and IPC handlers
 */

// ── Startup timing (first executable line) ──────────────────────
const _startupT0 = Date.now();
function _ts(label: string): void {
  console.log(`[STARTUP] ${label}: +${Date.now() - _startupT0}ms`);
}

import { app, BrowserWindow, dialog, nativeTheme, session, shell } from 'electron';
import type { Server } from 'node:http';
import { basename, dirname, join, resolve } from 'path';
import { existsSync } from 'node:fs';
import { rename } from 'node:fs/promises';

// Type-only imports for lazy-loaded modules (zero runtime cost).
// The actual classes are loaded dynamically in initialize() to avoid
// blocking process startup with heavy dependency chains.
import type { GatewayManager } from '../gateway/manager';
import type { HostEventBus } from '../api/event-bus';

// Lightweight modules needed before window creation
import { syncApplicationMenuFromStore } from './menu';
import { getWindowState, trackWindowState } from './window';
import { logger } from '../utils/logger';
import { warmupNetworkOptimization } from '../utils/uv-env';
import { applySaiClientIdEnv } from '../utils/sai-client-id';
import { isQuitting, setQuitting } from './app-state';
import { applyProxySettings } from './proxy';
import { syncLaunchAtStartupSettingFromStore } from './launch-at-startup';
import { releasePreventSystemSleepOnQuit, syncPreventSystemSleepSettingFromStore } from './prevent-sleep';
import {
  clearPendingSecondInstanceFocus,
  consumeMainWindowReady,
  createMainWindowFocusState,
  requestSecondInstanceFocus,
} from './main-window-focus';

applySaiClientIdEnv(process.env as Record<string, string | undefined>);
import {
  createQuitLifecycleState,
  markQuitCleanupCompleted,
  requestQuitLifecycleAction,
} from './quit-lifecycle';
import { createSignalQuitHandler } from './signal-quit';
import {
  acquireProcessInstanceFileLock,
  shouldContinueWithElectronLock,
} from './process-instance-lock';
import { getSetting } from '../utils/store';
import { getCurrentEnvConfig } from '../../shared/env-config';
import { getSqliteDatabaseInfo, initializeSqliteDatabase } from '../db';
import {
  isLegacyMacAppBundleName,
  LEGACY_MAC_APP_BUNDLE_NAMES,
  registerMacAppBundle,
  RENAMED_MAC_APP_BUNDLE_NAME,
  scheduleMacAppBundleMoveAndRelaunch,
  scheduleMacAppBundleRelaunch,
  shouldPreserveCanonicalMacApp,
  stageExistingMacAppTarget,
  unregisterMacAppBundle,
} from '../utils/cleanup-old-app-bundles';
import { CLIENT_APP_NAME } from '../../shared/app-branding';
import { getClientAppIcon } from './app-icon';
import { configureWindowsNotificationIdentity } from './windows-notification-identity';
import {
  observeNativeAppearanceUpdates,
  resolveWindowBackgroundColor,
  syncNativeAppearanceFromStore,
} from './appearance';
import { attachAppearanceReplay } from './appearance-replay';

_ts('static imports loaded');

const LEGACY_USER_DATA_DIR_NAME = 'stoclaw';

function pinLegacyUserDataPath(): void {
  app.setPath('userData', join(app.getPath('appData'), LEGACY_USER_DATA_DIR_NAME));
}

pinLegacyUserDataPath();

function getCurrentMacAppBundlePath(): string | null {
  const bundlePath = resolve(process.execPath, '..', '..', '..');
  return bundlePath.endsWith('.app') ? bundlePath : null;
}

async function promptRemoveLegacyMacAppIfNeeded(win: BrowserWindow): Promise<void> {
  if (process.platform !== 'darwin' || !app.isPackaged) return;

  const currentAppPath = getCurrentMacAppBundlePath();
  if (!currentAppPath || basename(currentAppPath) !== RENAMED_MAC_APP_BUNDLE_NAME) return;

  const legacyAppPaths = LEGACY_MAC_APP_BUNDLE_NAMES
    .map((name) => join(dirname(currentAppPath), name))
    .filter((candidate) => resolve(currentAppPath) !== resolve(candidate) && existsSync(candidate));
  if (legacyAppPaths.length === 0) return;
  const legacyNames = legacyAppPaths.map((legacyPath) => basename(legacyPath)).join('、');

  const result = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['移到废纸篓', '稍后处理'],
    defaultId: 0,
    cancelId: 1,
    title: '移除旧版 SClaw？',
    message: `检测到旧版应用：${legacyNames}`,
    detail: '当前正在运行 SClaw。为避免 Dock 或 Launchpad 中出现多个应用，建议将旧版应用移到废纸篓。此操作不会删除 SClaw 的用户数据。',
  });

  if (result.response !== 0) return;

  for (const legacyAppPath of legacyAppPaths) {
    try {
      await unregisterMacAppBundle(legacyAppPath);
      await shell.trashItem(legacyAppPath);
      logger.info(`[rename] moved legacy macOS app to Trash: ${legacyAppPath}`);
    } catch (error) {
      logger.warn(`[rename] failed to move legacy macOS app to Trash: ${legacyAppPath}`, error);
      await registerMacAppBundle(legacyAppPath);
      await shell.showItemInFolder(legacyAppPath);
    }
  }
}

async function migrateLegacyMacAppBundleIfNeeded(): Promise<boolean> {
  if (process.platform !== 'darwin' || !app.isPackaged) return false;

  const currentAppPath = getCurrentMacAppBundlePath();
  if (!currentAppPath || !isLegacyMacAppBundleName(basename(currentAppPath))) {
    return false;
  }

  const targetAppPath = join(dirname(currentAppPath), RENAMED_MAC_APP_BUNDLE_NAME);
  let stagedTargetPath: string | null = null;

  try {
    if (
      existsSync(targetAppPath)
      && await shouldPreserveCanonicalMacApp(currentAppPath, targetAppPath)
    ) {
      logger.info(
        `[rename] preserving existing canonical macOS app ${targetAppPath}; `
        + `historical app remains at ${currentAppPath} for post-launch cleanup`,
      );
      await registerMacAppBundle(targetAppPath);
      scheduleMacAppBundleRelaunch(targetAppPath);
      setQuitting();
      app.quit();
      return true;
    }

    if (existsSync(targetAppPath)) {
      await unregisterMacAppBundle(targetAppPath);
    }
    stagedTargetPath = await stageExistingMacAppTarget(currentAppPath, targetAppPath);
    if (stagedTargetPath) {
      logger.info(`[rename] staged existing renamed macOS app ${targetAppPath} to ${stagedTargetPath}`);
    }

    await unregisterMacAppBundle(currentAppPath);
    logger.info(`[rename] scheduling legacy macOS app bundle migration ${currentAppPath} to ${targetAppPath}`);
    scheduleMacAppBundleMoveAndRelaunch(currentAppPath, targetAppPath, stagedTargetPath);
    setQuitting();
    app.quit();
    return true;
  } catch (error) {
    logger.warn(`[rename] failed to migrate legacy macOS app bundle ${currentAppPath} to ${targetAppPath}`, error);
    if (stagedTargetPath && existsSync(stagedTargetPath) && !existsSync(targetAppPath)) {
      try {
        await rename(stagedTargetPath, targetAppPath);
        await registerMacAppBundle(targetAppPath);
        logger.info(`[rename] restored staged renamed macOS app ${stagedTargetPath}`);
      } catch (restoreError) {
        logger.warn(`[rename] failed to restore staged renamed macOS app ${stagedTargetPath}`, restoreError);
      }
    }
    if (existsSync(currentAppPath)) {
      await registerMacAppBundle(currentAppPath);
    }
    if (existsSync(targetAppPath)) {
      await registerMacAppBundle(targetAppPath);
    }
    return false;
  }
}

/**
 * Send startup progress message to the splash screen
 * This provides visual feedback during the critical first-launch period
 */
function sendStartupProgress(message: string): void {
  // Send to main window (will be received by splash screen before React loads)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('startup-progress', message);
  }
}

function schedulePostFirstPaintWork(
  win: BrowserWindow,
  task: () => Promise<void> | void,
): void {
  let scheduled = false;
  const runOnce = () => {
    if (scheduled) return;
    scheduled = true;
    const timer = setTimeout(() => {
      if (win.isDestroyed()) return;
      void Promise.resolve(task()).catch((error) => {
        logger.warn('Deferred startup maintenance failed:', error);
      });
    }, 1500);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  };

  // Primary trigger: after first paint.
  win.once('ready-to-show', runOnce);
  // Fallback trigger: avoid missing the work when ready-to-show was emitted
  // before we registered the listener.
  const fallbackTimer = setTimeout(runOnce, 8000);
  if (typeof fallbackTimer.unref === 'function') {
    fallbackTimer.unref();
  }
}

// Disable GPU hardware acceleration globally for maximum stability across
// all GPU configurations (no GPU, integrated, discrete).
//
// Rationale (following VS Code's philosophy):
// - Page/file loading is async data fetching - zero GPU dependency.
// - The original per-platform GPU branching was added to avoid CPU rendering
//   competing with sync I/O on Windows, but all file I/O is now async
//   (fs/promises), so that concern no longer applies.
// - Software rendering is deterministic across all hardware; GPU compositing
//   behaviour varies between vendors (Intel, AMD, NVIDIA, Apple Silicon) and
//   driver versions, making it the #1 source of rendering bugs in Electron.
//
// GPU acceleration is now enabled by default to support glassmorphism
// backdrop-filter effects. Users who hit GPU driver issues can pass
// `--disable-gpu` on the CLI to fall back to software rendering.
// app.disableHardwareAcceleration();

// ── Chromium startup optimisation flags ─────────────────────────
// These must be set before app.whenReady() to take effect.
if (process.platform === 'win32') {
  // Skip the expensive native window occlusion calculation that delays
  // BrowserWindow creation on Windows.
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}
// Disable the spare renderer process that Chromium pre-spawns for
// site-per-process isolation — we only ever have one renderer.
app.commandLine.appendSwitch('renderer-process-limit', '1');

_ts('app flags set');

// Dock / menu bar display name (Launchpad permanent name still comes from
// electron-builder productName → CFBundleName after rebuild+reinstall).
app.setName(CLIENT_APP_NAME);
configureWindowsNotificationIdentity();

// On Linux, set CHROME_DESKTOP so Chromium can find the correct .desktop file.
// On Wayland this maps the running window to stoclaw.desktop (icon + app grouping);
// on X11 it supplements the StartupWMClass matching.
// Must be called before app.whenReady() / before any window is created.
if (process.platform === 'linux') {
  app.setDesktopName('stoclaw.desktop');
}

// Prevent multiple instances of the app from running simultaneously.
// Without this, two instances each spawn their own gateway process on the
// same port, then each treats the other's gateway as "orphaned" and kills
// it - creating an infinite kill/restart loop on Windows.
// The losing process must exit immediately so it never reaches Gateway startup.
const devSkipSingleInstance =
  !app.isPackaged && process.env.STOCLAW_DEV_SKIP_SINGLE_INSTANCE === '1';

let gotElectronLock = true;
if (!devSkipSingleInstance) {
  gotElectronLock = app.requestSingleInstanceLock();
} else {
  console.warn(
    '[StoClaw] STOCLAW_DEV_SKIP_SINGLE_INSTANCE=1 — 允许多开；多个实例可能争抢网关端口 18789，仅用于调试',
  );
}

if (!gotElectronLock) {
  console.info(
    [
      '[StoClaw] 已有实例占用单实例锁，本进程退出。',
      '若已关掉窗口仍如此：macOS 上主窗口可能只是隐藏到托盘，请在托盘退出或 Cmd+Q 完全退出；',
      '或执行 pkill -f "[Ee]lectron.*stoclaw" / 活动监视器结束 StoClaw；',
      '开发调试可设环境变量 STOCLAW_DEV_SKIP_SINGLE_INSTANCE=1 再 pnpm dev。',
    ].join(' '),
  );
  app.exit(0);
}
let releaseProcessInstanceFileLock: () => void = () => {};
let gotFileLock = true;
if (gotElectronLock) {
  if (devSkipSingleInstance) {
    gotFileLock = true;
  } else {
    try {
      const fileLock = acquireProcessInstanceFileLock({
        userDataDir: app.getPath('userData'),
        lockName: 'stoclaw',
        verifyOwnerExecutable: process.platform === 'win32',
        reclaimUnknownLock: process.platform === 'win32',
      });
      gotFileLock = fileLock.acquired;
      releaseProcessInstanceFileLock = fileLock.release;
      if (!fileLock.acquired) {
        const ownerDescriptor = fileLock.ownerPid
          ? `${fileLock.ownerFormat ?? 'legacy'} pid=${fileLock.ownerPid}${fileLock.ownerExecutableName ? ` executable=${fileLock.ownerExecutableName}` : ''}`
          : fileLock.ownerFormat === 'unknown'
            ? 'unknown lock format/content'
            : 'unknown owner';
        if (shouldContinueWithElectronLock(fileLock)) {
          gotFileLock = true;
          console.warn(
            `[StoClaw] Unable to verify or reclaim process lock (${fileLock.lockPath}, ${ownerDescriptor}, reason=${fileLock.failureReason}); continuing with Electron single-instance lock only`,
          );
        } else {
          console.info(
            `[StoClaw] Another SClaw instance holds process lock (${fileLock.lockPath}, ${ownerDescriptor}); exiting duplicate process`,
          );
          app.exit(0);
        }
      }
    } catch (error) {
      console.warn('[StoClaw] Failed to acquire process instance file lock; continuing with Electron single-instance lock only', error);
    }
  }
}
const gotTheLock = gotElectronLock && gotFileLock;

// Global references
let mainWindow: BrowserWindow | null = null;
let gatewayManager: GatewayManager | null = null;
let hostEventBus: HostEventBus | null = null;
let hostApiServer: Server | null = null;
const mainWindowFocusState = createMainWindowFocusState();
const quitLifecycleState = createQuitLifecycleState();

function isLikelyPreviewDownloadUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (/\.(xlsx?|xlsm|csv|tsv|pdf|zip|gz|tar|7z|rar|docx?|pptx?|html?|txt|json|xml|png|jpe?g|gif|webp)(?:\?|#|$)/i.test(parsed.pathname)) {
      return true;
    }
    return /(?:^|&)(?:download|attachment|export)=/i.test(parsed.search.slice(1));
  } catch {
    return false;
  }
}

/**
 * Create the main application window
 */
function createWindow(saved?: { width?: number; height?: number; x?: number; y?: number; isMaximized?: boolean }): BrowserWindow {
  const isMac = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';
  const useCustomTitleBar = isWindows;

  const win = new BrowserWindow({
    width: saved?.width ?? 1280,
    height: saved?.height ?? 860,
    x: saved?.x,
    y: saved?.y,
    minWidth: 960,
    minHeight: 640,
    icon: getClientAppIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webviewTag: true, // Enable <webview> for embedding OpenClaw Control UI
    },
    titleBarStyle: isMac ? 'hiddenInset' : useCustomTitleBar ? 'hidden' : 'default',
    trafficLightPosition: isMac
      ? {
          // 最新原生 chrome 光学基线：x=16 / y=20；不再从 ContentHeader centerY 反推。
          // 权威值：src/lib/content-header-metrics.ts → MACOS_TRAFFIC_LIGHT_POSITION
          x: 16,
          y: 20,
        }
      : undefined,
    frame: isMac || !useCustomTitleBar,
    show: false,  // We call show() manually below — before loading content
    backgroundColor: resolveWindowBackgroundColor(nativeTheme.shouldUseDarkColors),
  });
  attachAppearanceReplay(win);

  // Show the window IMMEDIATELY — before loading content.
  // On first run, ready-to-show can take 5-10s because the renderer process
  // must cold-start (V8 init, preload script, HTML parse, first paint).
  // By showing now, the user sees the active native appearance background
  // immediately, and the splash screen content appears as soon as the renderer
  // finishes its first paint. This is much better UX than a blank desktop.
  win.show();
  _ts('window shown (native appearance background)');

  // Set window title with environment suffix for non-production builds
  const envCfg = getCurrentEnvConfig();
  if (envCfg.displaySuffix) {
    win.setTitle(`SClaw ${envCfg.displaySuffix}`);
  } else {
    win.setTitle('SClaw');
  }

  if (saved?.isMaximized) {
    win.maximize();
  }

  // Log when the renderer actually finishes first paint (diagnostic).
  win.once('ready-to-show', () => {
    _ts('ready-to-show (splash rendered)');
  });

  // External tabs vs in-preview file downloads from nested iframes.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isLikelyPreviewDownloadUrl(url)) {
      win.webContents.downloadURL(url);
      return { action: 'deny' };
    }
    shell.openExternal(url).catch((err) => {
      console.error('Failed to open external URL:', url, err);
    });
    return { action: 'deny' };
  });

  // Load the app
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools();
  } else {
    win.loadFile(join(__dirname, '../../dist/index.html'));
  }

  return win;
}

function focusWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) {
    return;
  }

  if (win.isMinimized()) {
    win.restore();
  }

  win.show();
  win.focus();
}

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  clearPendingSecondInstanceFocus(mainWindowFocusState);
  focusWindow(mainWindow);
}

async function createMainWindow(): Promise<BrowserWindow> {
  const saved = await getWindowState();
  const win = createWindow(saved);
  trackWindowState(win);

  // Handle focus requests from second-instance launches
  win.once('ready-to-show', () => {
    if (mainWindow !== win) {
      return;
    }

    const action = consumeMainWindowReady(mainWindowFocusState);
    if (action === 'focus') {
      focusWindow(win);
    }
  });

  win.on('close', (event) => {
    // 开发包：关闭主窗口即退出进程，释放单实例锁；否则 macOS 上仅隐藏到托盘，
    // 再跑 pnpm dev 会误判为第二实例而无法启动。
    if (!app.isPackaged) {
      setQuitting();
      return;
    }
    if (!isQuitting()) {
      event.preventDefault();
      // macOS 全屏下直接 hide() 会导致空间切换动画异常而黑屏，
      // 需先退出全屏再隐藏。
      if (process.platform === 'darwin' && win.isFullScreen()) {
        win.once('leave-full-screen', () => {
          if (!win.isDestroyed()) {
            win.hide();
          }
        });
        win.setFullScreen(false);
      } else {
        win.hide();
      }
    }
  });

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
    if (!app.isPackaged) {
      app.quit();
    }
  });

  mainWindow = win;
  return win;
}

/**
 * Initialize the application
 */
async function initialize(): Promise<void> {
  _ts('initialize() start');

  await syncNativeAppearanceFromStore();
  observeNativeAppearanceUpdates();

  initializeSqliteDatabase();
  const sqliteInfo = getSqliteDatabaseInfo();
  console.info(
    `[sqlite] initialized file=${sqliteInfo.filePath} journal=${sqliteInfo.journalMode} foreignKeys=${sqliteInfo.foreignKeysEnabled}`,
  );
  const { ensureSessionCatalogBootstrapped } = await import('../services/session-catalog-service');
  await ensureSessionCatalogBootstrapped();
  console.info('[main] Session catalog bootstrapped; running OpenClaw session store migration...');
  const { importOpenClawSessionStoreIfNeeded } = await import('../services/openclaw-session-store-migration');
  await importOpenClawSessionStoreIfNeeded();
  console.info('[main] OpenClaw session store migration complete');
  const { registerSessionCatalogHandlers } = await import('./ipc/session-catalog-handlers');
  registerSessionCatalogHandlers();
  const { registerDialogHandlers } = await import('./ipc/dialog-handlers');
  registerDialogHandlers();

  // Create the main window as early as possible.
  // Window shows immediately with the active native appearance background (see createWindow).
  const window = await createMainWindow();
  _ts('mainWindow created');

  // Set application menu from persisted language (macOS menu bar is always visible)
  void syncApplicationMenuFromStore();

  // Initialize logger AFTER window creation so its sync I/O runs in parallel
  // with the renderer loading HTML. Calls before init() safely go to console
  // + in-memory ring buffer; file writing begins after init().
  logger.init();
  logger.info('=== StoClaw Application Starting ===');
  logger.debug(
    `Runtime: platform=${process.platform}/${process.arch}, electron=${process.versions.electron}, node=${process.versions.node}, packaged=${app.isPackaged}, pid=${process.pid}, ppid=${process.ppid}`
  );

  // Warm up network optimization (non-blocking)
  void warmupNetworkOptimization();

  // Apply persisted proxy settings in parallel with heavy module loading.
  // Proxy affects network calls but does not depend on those modules.
  sendStartupProgress('Loading settings...');
  const proxyPromise = applyProxySettings().catch((error) => {
    logger.warn('Failed to apply proxy settings:', error);
  });

  // Sync launch-at-startup setting (fast, uses electron-store)
  void syncLaunchAtStartupSettingFromStore();
  void syncPreventSystemSleepSettingFromStore();

  // ── Lazy-load heavy modules in parallel while splash screen is displayed ──
  // These were previously static imports that blocked process startup with
  // heavy dependency chains (Baileys, posthog-node, electron-updater, etc.).
  // React has MIN_SPLASH_DISPLAY_MS = 800ms, giving ample time for these
  // imports to resolve + IPC handlers to register before the first IPC call.
  const [
    gatewayMod,
    clawhubMod,
    eventBusMod,
    { registerIpcHandlers },
    { appUpdater, registerUpdateHandlers },
    { initTelemetry },
    { createTray },
    { deviceOAuthManager },
    { browserOAuthManager },
    { whatsAppLoginManager },
    { syncAllProviderAuthToRuntime },
    { ensureClawXContext, repairClawXOnlyBootstrapFiles },
    { autoInstallCliIfNeeded, generateCompletionCache, installCompletionToProfile },
    { autoInstallSaiCliIfNeeded },
    { ensureBuiltinSkillsInstalled, ensurePreinstalledSkillsInstalled, watchLocalSkillsForDev },
    { cleanupRetiredSkillsAndPlugins },
    { ensureLongOutputConstraint, ensureChineseThinkingConstraint, getAgentWorkspacePath },
    { ensureAllBundledPluginsInstalledAsync },
    { startHostApiServer },
    stoSkillMod,
    skillPlazaMod,
    spriteWindowMod,
    floatIconMod,
  ] = await Promise.all([
    import('../gateway/manager'),
    import('../gateway/clawhub'),
    import('../api/event-bus'),
    import('./ipc-handlers'),
    import('./updater'),
    import('../utils/telemetry'),
    import('./tray'),
    import('../utils/device-oauth'),
    import('../utils/browser-oauth'),
    import('../utils/whatsapp-login'),
    import('../services/providers/provider-runtime-sync'),
    import('../utils/openclaw-workspace'),
    import('../utils/openclaw-cli'),
    import('../utils/sai-cli'),
    import('../utils/skill-config'),
    import('../utils/retired-skills-cleanup'),
    import('../utils/agent-config'),
    import('../utils/plugin-install'),
    import('../api/server'),
    import('../services/sto-skill-service'),
    import('../services/skill-plaza-service'),
    import('./sprite-window'),
    import('./float-icon-window'),
  ]);
  _ts('dynamic imports resolved');

  // Construct core service instances (now that modules are loaded).
  // Use local references (guaranteed non-null) for subsequent setup calls.
  const gm = new gatewayMod.GatewayManager();
  const chs = new clawhubMod.ClawHubService();
  const sss = new stoSkillMod.StoSkillService();
  const sps = new skillPlazaMod.SkillPlazaService();
  const heb = new eventBusMod.HostEventBus();
  gatewayManager = gm;
  // clawHubService instance is passed directly to startHostApiServer below.
  hostEventBus = heb;

  // Wire Gateway reload into OpenClaw skill adapter batches.
  void import('../services/skills/adapters/engine-skill-adapter').then(({ setGatewayReloaderForSkills }) => {
    setGatewayReloaderForSkills(gm);
  }).catch(() => undefined);

  // Initialize Telemetry (non-blocking)
  // Note: Telemetry is disabled by default for faster cold starts
  void initTelemetry().catch((error) => {
    logger.warn('Telemetry initialization failed:', error);
  });

  // Wait for proxy settings (already started earlier, likely finished during imports)
  await proxyPromise;

  // Create sprite window (hidden by default, toggled via tray)
  spriteWindowMod.createSpriteWindow();

  // Create float icon window (hidden by default, toggled via tray)
  floatIconMod.createFloatIconWindow();

  // Create system tray (with sprite and float icon toggle support)
  createTray(window, spriteWindowMod.toggleSprite, floatIconMod.toggleFloatIcon);

  session.defaultSession.on('will-download', (_event, item) => {
    logger.info(`[Download] ${item.getFilename()} ← ${item.getURL().slice(0, 200)}`);
  });

  // Override security headers ONLY for the OpenClaw Gateway Control UI.
  // The URL filter ensures this callback only fires for gateway requests,
  // avoiding unnecessary overhead on every other HTTP response.
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['http://127.0.0.1:18789/*', 'http://localhost:18789/*'] },
    (details, callback) => {
      const headers = { ...details.responseHeaders };
      delete headers['X-Frame-Options'];
      delete headers['x-frame-options'];
      if (headers['Content-Security-Policy']) {
        headers['Content-Security-Policy'] = headers['Content-Security-Policy'].map(
          (csp) => csp.replace(/frame-ancestors\s+'none'/g, "frame-ancestors 'self' *")
        );
      }
      if (headers['content-security-policy']) {
        headers['content-security-policy'] = headers['content-security-policy'].map(
          (csp) => csp.replace(/frame-ancestors\s+'none'/g, "frame-ancestors 'self' *")
        );
      }
      callback({ responseHeaders: headers });
    },
  );

  // Register IPC handlers
  registerIpcHandlers(
    gm,
    chs,
    window,
    spriteWindowMod.getSpriteWindow,
    floatIconMod.getFloatIconWindow,
    () => mainWindow,
  );

  // Register the canonical chat observer before workflow/scheduled runtimes can
  // start background work, so even an immediate terminal event is notified.
  const [
    { getChatRuntimeSupervisor },
    { createChatResultNotificationObserver },
  ] = await Promise.all([
    import('../services/chat-runtime-supervisor'),
    import('../services/chat-result-notification'),
  ]);
  const observeChatResult = createChatResultNotificationObserver(() => mainWindow);
  getChatRuntimeSupervisor(gm).on('event', (event) => {
    heb.emit('chat-runtime:event', event);
    observeChatResult(event);
  });

  // Workflow runtime（客户端执行下沉）：收口在途 run + 起 outbox flushLoop
  const { startWorkflowRuntimeOnLaunch } = await import('../services/workflow-runtime/bootstrap');
  startWorkflowRuntimeOnLaunch();

  // Register form IPC handlers
  const { registerFormHandlers } = await import('./ipc/form-handlers');
  registerFormHandlers();

  // 引擎无关通用定时任务：setGatewayManager 注入 dispatcher + eventSink →
  // 一次性迁移遗留 claude definitions.json + openclaw jobs.json → schedule_tasks →
  // 列→segments。startScheduler 挪到已认证入口（认领后），未登录不跑 cron / 出队。
  const { getScheduledTaskService } = await import('../scheduled-tasks/scheduled-task-service');
  const { runScheduledTasksMigration } = await import('../scripts/migrate-scheduled-tasks');
  const { runComposerColumnsToSegmentsMigration } = await import(
    '../scripts/migrate-composer-columns-to-segments'
  );
  const scheduledTaskService = getScheduledTaskService();
  scheduledTaskService.setGatewayManager(gm);
  await runScheduledTasksMigration(gm, scheduledTaskService);
  await runComposerColumnsToSegmentsMigration(scheduledTaskService).catch((error) => {
    logger.warn('[scheduled-task] columns→composerSegments migration failed:', error);
  });
  try {
    const { getAuthState } = await import('../utils/auth-store');
    const authState = await getAuthState();
    const userCode = authState.isAuthenticated ? authState.user?.code?.trim() : '';
    if (userCode) {
      scheduledTaskService.onUserAuthenticated(userCode);
    }
  } catch (error) {
    logger.warn('[scheduled-task] cold-start auth check failed:', error);
  }
  app.on('before-quit', () => {
    scheduledTaskService.stopScheduler();
  });

  hostApiServer = startHostApiServer({
    gatewayManager: gm,
    clawHubService: chs,
    stoSkillService: sss,
    skillPlazaService: sps,
    eventBus: heb,
    mainWindow: window,
  });

  // Channel Hub：已绑定则用 refreshToken 重连 WS，并挂入站执行（失败不阻塞启动）
  void import('../channels/startup')
    .then(({ maybeConnectSclawHubOnStartup }) => maybeConnectSclawHubOnStartup(gm))
    .catch((error) => {
      logger.warn('[SclawHub] startup import/connect failed:', error);
    });

  // Register update handlers
  registerUpdateHandlers(appUpdater, window);

  // Auto-check for updates: main process schedules resolve + electron-updater on an interval
  // (server check_interval_seconds, default 6h; first run ~10s after launch when enabled).

  // Repair any bootstrap files that only contain StoClaw markers (no OpenClaw
  // template content). This fixes a race condition where ensureClawXContext()
  // previously created the file before the gateway could seed the full template.
  void repairClawXOnlyBootstrapFiles().catch((error) => {
    logger.warn('Failed to repair bootstrap files:', error);
  });

  // Defer heavy file-copy maintenance until after first paint so first-launch
  // startup is responsive on Windows and avoids blank/unresponsive cold starts.
  schedulePostFirstPaintWork(window, async () => {
    void promptRemoveLegacyMacAppIfNeeded(window).catch((error) => {
      logger.warn('Failed to prompt for legacy macOS app cleanup:', error);
    });

    logger.info('Running deferred startup maintenance tasks');

    await cleanupRetiredSkillsAndPlugins({ skipPluginDirs: true }).catch((error) => {
      logger.warn('Failed to cleanup retired skills/plugins:', error);
    });

    // One-time migration into neutral skills-store, then full-engine reconcile.
    try {
      const { migrateSkillsStoreIfNeeded } = await import('../services/skills/migration');
      const migration = await migrateSkillsStoreIfNeeded();
      if (migration.migrated) {
        logger.info('Migrated skills into neutral skills-store');
      }
      if (migration.deduped) {
        logger.info('Deduped skills-store global/user duplicates');
      }
    } catch (error) {
      logger.warn('Failed to migrate skills store:', error);
    }

    await ensureBuiltinSkillsInstalled().catch((error) => {
      logger.warn('Failed to install built-in skills:', error);
    });

    await ensurePreinstalledSkillsInstalled().catch((error) => {
      logger.warn('Failed to install preinstalled skills:', error);
    });

    watchLocalSkillsForDev();

    try {
      sss.backfillLockVersions();
    } catch (error) {
      logger.warn('Failed to backfill skill lock versions:', error);
    }

    // Ensure Main Agent's AGENTS.md includes the long-output constraint
    // TEMP: ensure* 函数体内已暂时停用英文注入（见 agent-config.ts）
    try {
      const mainWorkspace = await getAgentWorkspacePath('main');
      if (mainWorkspace) {
        await ensureLongOutputConstraint(mainWorkspace);
        await ensureChineseThinkingConstraint(mainWorkspace);
        logger.info('Ensured long-output and chinese-thinking constraints in Main Agent AGENTS.md');
      }
    } catch (error) {
      logger.warn('Failed to ensure long-output constraint for Main Agent:', error);
    }

    await autoInstallCliIfNeeded((installedPath) => {
      mainWindow?.webContents.send('openclaw:cli-installed', installedPath);
    }).then(() => {
      generateCompletionCache();
      installCompletionToProfile();
    }).catch((error) => {
      logger.warn('CLI auto-install failed:', error);
    });
    logger.warn('autoInstallSaiCliIfNeeded start');
    await autoInstallSaiCliIfNeeded((installedPath) => {
      mainWindow?.webContents.send('sai:cli-installed', installedPath);
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('SAI CLI auto-install failed:', message);
      mainWindow?.webContents.send('sai:cli-install-failed', message);
    });
    // dws 静默强装已取消：改为用户在应用广场「链接器」一键连接时安装。
    // 启动时仅同步已安装/已授权状态到 connectors state，重建 Gateway 白名单。
    void import('../connectors')
      .then(({ getConnectorService }) => getConnectorService().syncProbes())
      .catch((error) => {
        logger.warn(
          'connectors syncProbes failed:',
          error instanceof Error ? error.message : String(error),
        );
      });
  });

  // Bridge gateway and host-side events before any auto-start logic runs, so
  // renderer subscribers observe the full startup lifecycle.
  gm.on('status', (status: { state: string }) => {
    heb.emit('gateway:status', status);
    if (status.state === 'running') {
      void ensureClawXContext().catch((error) => {
        logger.warn('Failed to re-merge StoClaw context after gateway reconnect:', error);
      });
    }
  });

  gm.on('error', (error) => {
    heb.emit('gateway:error', { message: error.message });
  });

  gm.on('channel:status', (data) => {
    heb.emit('gateway:channel-status', data);
  });

  gm.on('exit', (code) => {
    heb.emit('gateway:exit', { code });
  });

  deviceOAuthManager.on('oauth:code', (payload) => {
    heb.emit('oauth:code', payload);
  });

  deviceOAuthManager.on('oauth:start', (payload) => {
    heb.emit('oauth:start', payload);
  });

  deviceOAuthManager.on('oauth:success', (payload) => {
    heb.emit('oauth:success', { ...payload, success: true });
  });

  deviceOAuthManager.on('oauth:error', (error) => {
    heb.emit('oauth:error', error);
  });

  browserOAuthManager.on('oauth:start', (payload) => {
    heb.emit('oauth:start', payload);
  });

  browserOAuthManager.on('oauth:code', (payload) => {
    heb.emit('oauth:code', payload);
  });

  browserOAuthManager.on('oauth:success', (payload) => {
    heb.emit('oauth:success', { ...payload, success: true });
  });

  browserOAuthManager.on('oauth:error', (error) => {
    heb.emit('oauth:error', error);
  });

  whatsAppLoginManager.on('qr', (data) => {
    heb.emit('channel:whatsapp-qr', data);
  });

  whatsAppLoginManager.on('success', (data) => {
    heb.emit('channel:whatsapp-success', data);
  });

  whatsAppLoginManager.on('error', (error) => {
    heb.emit('channel:whatsapp-error', error);
  });

  // Install bundled plugins before Gateway so the first agent run uses the latest mirror.
  sendStartupProgress('Preparing workspace...');
  try {
    const { ensureWorkspaceLayoutMigrated } = await import('../utils/workspace-migration');
    await ensureWorkspaceLayoutMigrated();
  } catch (error) {
    logger.warn('Workspace layout migration failed:', error);
  }

  sendStartupProgress('Installing plugins...');
  await cleanupRetiredSkillsAndPlugins().catch((error) => {
    logger.warn('Failed to cleanup retired skills/plugins before plugin install:', error);
  });
  await ensureAllBundledPluginsInstalledAsync().catch((error) => {
    logger.warn('Failed to install/upgrade bundled plugins:', error);
  });
  try {
    const { ensureStoBrowserBridgePluginInOpenClaw, ensureStoBrowserAutomationPluginInOpenClaw } = await import('../utils/openclaw-auth');
    const bridgeModified = await ensureStoBrowserBridgePluginInOpenClaw();
    if (bridgeModified) {
      logger.info('[plugin] Enabled sto-browser-bridge in openclaw.json');
    }
    const automationModified = await ensureStoBrowserAutomationPluginInOpenClaw();
    if (automationModified) {
      logger.info('[plugin] Enabled sto-browser-automation in openclaw.json');
    }
  } catch (error) {
    logger.warn('Failed to enable browser plugins in openclaw.json:', error);
  }

  // Start Gateway automatically (this seeds missing bootstrap files with full templates)
  const gatewayAutoStart = await getSetting('gatewayAutoStart');
  if (gatewayAutoStart) {
    try {
      sendStartupProgress('Starting Gateway...');
      await syncAllProviderAuthToRuntime();

      try {
        const { getAuthState, getStoToken } = await import('../utils/auth-store');
        const { getStoModelSyncService } = await import('../services/providers/sto-model-sync');
        const authState = await getAuthState();
        const token = await getStoToken();
        if (authState.isAuthenticated && token) {
          const stoSync = getStoModelSyncService();
          stoSync.setGatewayManager(gm);
          stoSync.startPeriodicSync();
        }
      } catch (err) {
        logger.warn('STO periodic sync startup check failed:', err);
      }

      logger.debug('Auto-starting Gateway...');
      await gm.start();
      logger.info('Gateway auto-start succeeded');
    } catch (error) {
      logger.error('Gateway auto-start failed:', error);
      mainWindow?.webContents.send('gateway:error', String(error));
    }
  } else {
    logger.info('Gateway auto-start disabled in settings');
  }

  // Merge StoClaw context snippets into the workspace bootstrap files.
  // The gateway seeds workspace files asynchronously after its HTTP server
  // is ready, so ensureClawXContext will retry until the target files appear.
  sendStartupProgress('Finalizing...');
  void ensureClawXContext().catch((error) => {
    logger.warn('Failed to merge StoClaw context into workspace:', error);
  });
}

if (gotTheLock) {
  const requestQuitOnSignal = createSignalQuitHandler({
    logInfo: (message) => logger.info(message),
    requestQuit: () => app.quit(),
  });

  process.on('exit', () => {
    releaseProcessInstanceFileLock();
  });

  process.once('SIGINT', () => requestQuitOnSignal('SIGINT'));
  process.once('SIGTERM', () => requestQuitOnSignal('SIGTERM'));

  app.on('will-quit', () => {
    releaseProcessInstanceFileLock();
  });

  // Note: gatewayManager, clawHubService, hostEventBus are constructed lazily
  // inside initialize() after dynamic imports resolve. Lifecycle handlers below
  // use null-safe access since they may fire before initialize() completes.

  // When a second instance is launched, focus the existing window instead.
  app.on('second-instance', () => {
    logger.info('Second StoClaw instance detected; redirecting to the existing window');

    const focusRequest = requestSecondInstanceFocus(
      mainWindowFocusState,
      Boolean(mainWindow && !mainWindow.isDestroyed()),
    );

    if (focusRequest === 'focus-now') {
      focusMainWindow();
      return;
    }

    logger.debug('Main window is not ready yet; deferring second-instance focus until ready-to-show');
  });

  // Application lifecycle
  app.whenReady().then(async () => {
    _ts('app.whenReady() resolved');
    void import('../services/pi-runtime-service').then(({ getPiRuntimeService }) =>
      getPiRuntimeService().warmup().catch((error) => {
        logger.warn('Pi runtime warmup failed; it will retry on first use:', error);
      }),
    );
    if (await migrateLegacyMacAppBundleIfNeeded()) {
      return;
    }
    void import('../utils/cleanup-old-app-bundles').then(({ scheduleOldAppBackupCleanup }) =>
      scheduleOldAppBackupCleanup(),
    );
    try {
      const { runPendingInstallReport } = await import('../services/client-update-platform');
      await runPendingInstallReport(app.getVersion(), process.platform);
    } catch (error) {
      logger.warn('Post-update install report / re-auth hook failed:', error);
    }
    try {
      const { ensureSsoCodeFieldReloginOnce } = await import('../utils/auth-store');
      await ensureSsoCodeFieldReloginOnce();
    } catch (error) {
      logger.warn('[auth] SSO code-field relogin hook failed:', error);
    }
    void initialize().catch((error) => {
      logger.error('Application initialization failed:', error);
    });

    // Register activate handler AFTER app is ready to prevent
    // "Cannot create BrowserWindow before app is ready" on macOS.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      } else {
        focusMainWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', (event) => {
    setQuitting();
    releasePreventSystemSleepOnQuit();

    // Reset sprite and float icon visibility so they don't auto-show on next launch
    void import('./sprite-window').then(({ resetSpriteVisibilityOnQuit }) =>
      resetSpriteVisibilityOnQuit().catch(() => { /* ignore */ }),
    );
    void import('./float-icon-window').then(({ resetFloatIconVisibilityOnQuit }) =>
      resetFloatIconVisibilityOnQuit().catch(() => { /* ignore */ }),
    );

    const action = requestQuitLifecycleAction(quitLifecycleState);

    if (action === 'allow-quit') {
      return;
    }

    event.preventDefault();

    if (action === 'cleanup-in-progress') {
      logger.debug('Quit requested while cleanup already in progress; waiting for shutdown task to finish');
      return;
    }

    hostEventBus?.closeAll();
    hostApiServer?.close();

    if (!gatewayManager) {
      // Gateway never initialized (quit during early startup); nothing to clean up.
      void import('../services/pi-runtime-service').then(({ getPiRuntimeService }) =>
        getPiRuntimeService().shutdown(),
      ).catch(() => {}).finally(() => {
        markQuitCleanupCompleted(quitLifecycleState);
        app.quit();
      });
      return;
    }

    void Promise.all([
      import('./gateway-quit-cleanup').then(({ shutdownGatewayForQuit }) => shutdownGatewayForQuit(gatewayManager!)),
      import('../services/pi-runtime-service').then(({ getPiRuntimeService }) => getPiRuntimeService().shutdown()),
    ])
        .catch((err) => {
          logger.warn('Runtime quit cleanup failed:', err);
        })
        .finally(() => {
          markQuitCleanupCompleted(quitLifecycleState);
          app.quit();
        });
  });

  // Best-effort Gateway cleanup on unexpected crashes.
  // These handlers attempt to terminate the Gateway child process within a
  // short timeout before force-exiting, preventing orphaned processes.
  const emergencyGatewayCleanup = (reason: string, error: unknown): void => {
    logger.error(`${reason}:`, error);
    try {
      void gatewayManager?.stop().catch(() => { /* ignore */ });
    } catch {
      // ignore - stop() may not be callable if state is corrupted
    }
    // Give Gateway stop a brief window, then force-exit.
    setTimeout(() => {
      process.exit(1);
    }, 3000).unref();
  };

  process.on('uncaughtException', (error) => {
    emergencyGatewayCleanup('Uncaught exception in main process', error);
  });

  process.on('unhandledRejection', (reason) => {
    emergencyGatewayCleanup('Unhandled promise rejection in main process', reason);
  });
}

// Export for testing
export { mainWindow, gatewayManager };
