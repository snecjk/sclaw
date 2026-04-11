/**
 * Electron Main Process Entry
 * Manages window creation, system tray, and IPC handlers
 */

// ── Startup timing (first executable line) ──────────────────────
const _startupT0 = Date.now();
function _ts(label: string): void {
  console.log(`[STARTUP] ${label}: +${Date.now() - _startupT0}ms`);
}

import { app, BrowserWindow, nativeImage, session, shell } from 'electron';
import type { Server } from 'node:http';
import { join } from 'path';

// Type-only imports for lazy-loaded modules (zero runtime cost).
// The actual classes are loaded dynamically in initialize() to avoid
// blocking process startup with heavy dependency chains.
import type { GatewayManager } from '../gateway/manager';
import type { ClawHubService } from '../gateway/clawhub';
import type { HostEventBus } from '../api/event-bus';

// Lightweight modules needed before window creation
import { createMenu } from './menu';
import { logger } from '../utils/logger';
import { warmupNetworkOptimization } from '../utils/uv-env';
import { isQuitting, setQuitting } from './app-state';
import { applyProxySettings } from './proxy';
import { syncLaunchAtStartupSettingFromStore } from './launch-at-startup';
import {
  clearPendingSecondInstanceFocus,
  consumeMainWindowReady,
  createMainWindowFocusState,
  requestSecondInstanceFocus,
} from './main-window-focus';
import {
  createQuitLifecycleState,
  markQuitCleanupCompleted,
  requestQuitLifecycleAction,
} from './quit-lifecycle';
import { createSignalQuitHandler } from './signal-quit';
import { acquireProcessInstanceFileLock } from './process-instance-lock';
import { getSetting } from '../utils/store';
import { getCurrentEnvConfig } from '../../shared/env-config';

_ts('static imports loaded');

const WINDOWS_APP_USER_MODEL_ID = 'app.stoclaw.desktop';

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
      });
      gotFileLock = fileLock.acquired;
      releaseProcessInstanceFileLock = fileLock.release;
      if (!fileLock.acquired) {
        const ownerDescriptor = fileLock.ownerPid
          ? `${fileLock.ownerFormat ?? 'legacy'} pid=${fileLock.ownerPid}`
          : fileLock.ownerFormat === 'unknown'
            ? 'unknown lock format/content'
            : 'unknown owner';
        console.info(
          `[StoClaw] Another instance already holds process lock (${fileLock.lockPath}, ${ownerDescriptor}); exiting duplicate process`,
        );
        app.exit(0);
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
let clawHubService: ClawHubService | null = null;
let hostEventBus: HostEventBus | null = null;
let hostApiServer: Server | null = null;
const mainWindowFocusState = createMainWindowFocusState();
const quitLifecycleState = createQuitLifecycleState();

/**
 * Resolve the icons directory path (works in both dev and packaged mode)
 */
function getIconsDir(): string {
  if (app.isPackaged) {
    // Packaged: icons are in extraResources -> process.resourcesPath/resources/icons
    return join(process.resourcesPath, 'resources', 'icons');
  }
  // Development: relative to dist-electron/main/
  return join(__dirname, '../../resources/icons');
}

/**
 * Get the app icon for the current platform
 */
function getAppIcon(): Electron.NativeImage | undefined {
  if (process.platform === 'darwin') return undefined; // macOS uses the app bundle icon

  const iconsDir = getIconsDir();
  const iconPath =
    process.platform === 'win32'
      ? join(iconsDir, 'icon.ico')
      : join(iconsDir, 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  return icon.isEmpty() ? undefined : icon;
}

/**
 * Create the main application window
 */
function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';
  const useCustomTitleBar = isWindows;

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    icon: getAppIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webviewTag: true, // Enable <webview> for embedding OpenClaw Control UI
    },
    titleBarStyle: isMac ? 'hiddenInset' : useCustomTitleBar ? 'hidden' : 'default',
    trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
    frame: isMac || !useCustomTitleBar,
    show: false,  // We call show() manually below — before loading content
    backgroundColor: '#0f1525',  // Match splash screen background
  });

  // Show the window IMMEDIATELY — before loading content.
  // On first run, ready-to-show can take 5-10s because the renderer process
  // must cold-start (V8 init, preload script, HTML parse, first paint).
  // By showing now, the user sees a dark window instantly (matching the splash
  // background), and the splash screen content appears as soon as the renderer
  // finishes its first paint. This is much better UX than a blank desktop.
  win.show();
  _ts('window shown (dark bg)');

  // Set window title with environment suffix for non-production builds
  const envCfg = getCurrentEnvConfig();
  if (envCfg.displaySuffix) {
    win.setTitle(`STO Claw ${envCfg.displaySuffix}`);
  }

  // Log when the renderer actually finishes first paint (diagnostic).
  win.once('ready-to-show', () => {
    _ts('ready-to-show (splash rendered)');
  });

  // Handle external links
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
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

function createMainWindow(): BrowserWindow {
  const win = createWindow();

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
      win.hide();
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

  // Create the main window as early as possible.
  // Window shows immediately with dark background (see createWindow).
  const window = createMainWindow();
  _ts('mainWindow created');

  // Set application menu (fast, no I/O — can happen after window show)
  createMenu();

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
    { ensureBuiltinSkillsInstalled, ensurePreinstalledSkillsInstalled },
    { ensureAllBundledPluginsInstalledAsync },
    { startHostApiServer },
    stoSkillMod,
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
    import('../utils/skill-config'),
    import('../utils/plugin-install'),
    import('../api/server'),
    import('../services/sto-skill-service'),
    import('./sprite-window'),
    import('./float-icon-window'),
  ]);
  _ts('dynamic imports resolved');

  // Construct core service instances (now that modules are loaded).
  // Use local references (guaranteed non-null) for subsequent setup calls.
  const gm = new gatewayMod.GatewayManager();
  const chs = new clawhubMod.ClawHubService();
  const sss = new stoSkillMod.StoSkillService();
  const heb = new eventBusMod.HostEventBus();
  gatewayManager = gm;
  clawHubService = chs;
  hostEventBus = heb;

  // Initialize Telemetry (non-blocking)
  // Note: Telemetry is disabled by default for faster cold starts
  void initTelemetry().catch((error) => {
    logger.warn('Telemetry initialization failed:', error);
  });

  // Apply persisted proxy settings before network requests.
  sendStartupProgress('Loading settings...');
  const proxyPromise = applyProxySettings().catch((error) => {
    logger.warn('Failed to apply proxy settings:', error);
  });

  // Sync launch-at-startup setting (fast, uses electron-store)
  void syncLaunchAtStartupSettingFromStore();

  // Wait for critical initialization (proxy affects network calls)
  await proxyPromise;

  // Create sprite window (hidden by default, toggled via tray)
  spriteWindowMod.createSpriteWindow();

  // Create float icon window (visible by default, acts as sprite launcher)
  floatIconMod.createFloatIconWindow();

  // Create system tray (with sprite and float icon toggle support)
  createTray(window, spriteWindowMod.toggleSprite, floatIconMod.toggleFloatIcon);

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
  registerIpcHandlers(gm, chs, window, spriteWindowMod.getSpriteWindow, floatIconMod.getFloatIconWindow);

  hostApiServer = startHostApiServer({
    gatewayManager: gm,
    clawHubService: chs,
    stoSkillService: sss,
    eventBus: heb,
    mainWindow: window,
  });

  // Register update handlers
  registerUpdateHandlers(appUpdater, window);

  // Note: Auto-check for updates is driven by the renderer (update store init)
  // so it respects the user's "Auto-check for updates" setting.

  // Repair any bootstrap files that only contain StoClaw markers (no OpenClaw
  // template content). This fixes a race condition where ensureClawXContext()
  // previously created the file before the gateway could seed the full template.
  void repairClawXOnlyBootstrapFiles().catch((error) => {
    logger.warn('Failed to repair bootstrap files:', error);
  });

  // Defer heavy file-copy maintenance until after first paint so first-launch
  // startup is responsive on Windows and avoids blank/unresponsive cold starts.
  schedulePostFirstPaintWork(window, async () => {
    logger.info('Running deferred startup maintenance tasks');

    await ensureBuiltinSkillsInstalled().catch((error) => {
      logger.warn('Failed to install built-in skills:', error);
    });

    await ensurePreinstalledSkillsInstalled().catch((error) => {
      logger.warn('Failed to install preinstalled skills:', error);
    });

    await ensureAllBundledPluginsInstalledAsync().catch((error) => {
      logger.warn('Failed to install/upgrade bundled plugins:', error);
    });

    await autoInstallCliIfNeeded((installedPath) => {
      mainWindow?.webContents.send('openclaw:cli-installed', installedPath);
    }).then(() => {
      generateCompletionCache();
      installCompletionToProfile();
    }).catch((error) => {
      logger.warn('CLI auto-install failed:', error);
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

  gm.on('notification', (notification) => {
    heb.emit('gateway:notification', notification);
  });

  gm.on('chat:message', (data) => {
    heb.emit('gateway:chat-message', data);
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

  // Start Gateway automatically (this seeds missing bootstrap files with full templates)
  const gatewayAutoStart = await getSetting('gatewayAutoStart');
  if (gatewayAutoStart) {
    try {
      sendStartupProgress('Starting Gateway...');
      await syncAllProviderAuthToRuntime();
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

  // Start STO model sync if user is already authenticated
  void (async () => {
    try {
      const { getAuthState, getStoToken } = await import('../utils/auth-store');
      const { getStoModelSyncService } = await import('../services/providers/sto-model-sync');
      const authState = await getAuthState();
      const token = await getStoToken();
      if (authState.isAuthenticated && token) {
        const stoSync = getStoModelSyncService();
        stoSync.setGatewayManager(gm);
        void stoSync.syncModels().catch((err) =>
          logger.warn('Startup STO model sync failed:', err),
        );
        stoSync.startPeriodicSync();

        // Auto-create department biz agents on startup (fire-and-forget)
        const { getStoBizAgentSyncService } = await import('../services/sto-biz-agent-sync');
        const bizAgentSync = getStoBizAgentSyncService();
        bizAgentSync.setGatewayManager(gm);
        void bizAgentSync.syncAgents().catch((err) =>
          logger.warn('Startup STO biz-agent sync failed:', err),
        );
      }
    } catch (err) {
      logger.warn('STO model sync startup check failed:', err);
    }
  })();
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

  if (process.platform === 'win32') {
    app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID);
  }

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
  app.whenReady().then(() => {
    _ts('app.whenReady() resolved');
    void import('../services/client-update-platform').then(({ runPendingInstallReport }) =>
      runPendingInstallReport(app.getVersion(), process.platform),
    );
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
      markQuitCleanupCompleted(quitLifecycleState);
      app.quit();
      return;
    }

    const stopPromise = gatewayManager.stop().catch((err) => {
      logger.warn('gatewayManager.stop() error during quit:', err);
    });
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), 5000);
    });

    void Promise.race([stopPromise.then(() => 'stopped' as const), timeoutPromise]).then((result) => {
      if (result === 'timeout') {
        logger.warn('Gateway shutdown timed out during app quit; proceeding with forced quit');
        void gatewayManager?.forceTerminateOwnedProcessForQuit().then((terminated) => {
          if (terminated) {
            logger.warn('Forced gateway process termination completed after quit timeout');
          }
        }).catch((err) => {
          logger.warn('Forced gateway termination failed after quit timeout:', err);
        });
      }
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
