import OpenIMSDKMain from '@openim/electron-client-sdk';
import type { WebContents } from 'electron';
import { BrowserWindow, ipcMain } from 'electron';
import { logger } from '../utils/logger';
import { resolveOpenIMLibPath } from './lib-path';
import { ensureOpenIMPaths, registerOpenIMIpcHandlers } from './paths';

let sdkInstance: OpenIMSDKMain | null = null;
let initError: string | null = null;
let handlersRegistered = false;
let bootstrappedUserID: string | null = null;
let bootstrappedToken: string | null = null;
let sessionEventHookInstalled = false;

type OpenIMSDKInternal = {
  initSDK: (param: Record<string, unknown>, opid?: string) => Promise<boolean>;
  login: (param: { userID: string; token: string }) => Promise<unknown>;
  getLoginStatus: (opid?: string) => Promise<{ data?: number | string }>;
  logout: () => Promise<unknown>;
  unInitSDK: () => Promise<unknown>;
  emit?: (event: string, data: unknown) => unknown;
};

type OpenIMSDKMainInternal = OpenIMSDKMain & {
  sdk: OpenIMSDKInternal;
  webContents?: WebContents[];
};

const SESSION_INVALID_EVENTS = new Set([
  'OnUserTokenInvalid',
  'OnUserTokenExpired',
  'OnKickedOffline',
]);

const LoginStatusLogged = 3;

export interface OpenIMBootstrapPayload {
  userID: string;
  token: string;
  apiAddr: string;
  wsAddr: string;
  platformID: number;
  dataDir: string;
  logFilePath: string;
}

export interface OpenIMBootstrapState {
  ready: boolean;
  inProgress: boolean;
  userID: string | null;
  status: number | null;
  error: string | null;
}

let bootstrapState: OpenIMBootstrapState = {
  ready: false,
  inProgress: false,
  userID: null,
  status: null,
  error: null,
};

let bootstrapInFlight: Promise<OpenIMBootstrapState> | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isOpenIMMainSDKReady(): boolean {
  return sdkInstance !== null;
}

export function getOpenIMMainInitError(): string | null {
  return initError;
}

function getSdk(): OpenIMSDKInternal | null {
  if (!sdkInstance) return null;
  return (sdkInstance as OpenIMSDKMainInternal).sdk;
}

function readLoginStatusSync(): number | null {
  const sdk = getSdk();
  if (!sdk) return null;
  try {
    // Prefer sync native int: async getLoginStatus can hang when koffi callbacks stall.
    const internal = sdk as OpenIMSDKInternal & {
      libOpenIMSDK?: { get_login_status?: (opid: string) => number };
    };
    const native = internal.libOpenIMSDK?.get_login_status;
    if (typeof native === 'function') {
      const code = Number(native(`stoclaw-status-${Date.now()}`));
      return Number.isFinite(code) ? code : null;
    }
  } catch (error) {
    logger.warn('[OpenIM] sync get_login_status failed:', error);
  }
  return null;
}

async function readStatus(sdk: OpenIMSDKInternal): Promise<number | null> {
  const syncStatus = readLoginStatusSync();
  if (syncStatus !== null) return syncStatus;

  try {
    const response = await Promise.race([
      sdk.getLoginStatus(),
      delay(500).then(() => null),
    ]);
    if (!response) return null;
    const code = Number(response?.data);
    return Number.isFinite(code) ? code : null;
  } catch (error) {
    logger.warn('[OpenIM] getLoginStatus failed:', error);
    return null;
  }
}

function broadcastBootstrapResult(state: OpenIMBootstrapState): void {
  const payload = { ...state };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('openim:bootstrap-result', payload);
    }
  }
  const tracked = (sdkInstance as OpenIMSDKMainInternal | null)?.webContents;
  if (tracked) {
    for (const wc of tracked) {
      if (!wc.isDestroyed()) {
        wc.send('openim:bootstrap-result', payload);
      }
    }
  }
}

function setBootstrapState(next: Partial<OpenIMBootstrapState>): OpenIMBootstrapState {
  bootstrapState = { ...bootstrapState, ...next };
  return bootstrapState;
}

function markBootstrapLoggedIn(userID: string, token: string, status: number | null): OpenIMBootstrapState {
  bootstrappedUserID = userID;
  bootstrappedToken = token;
  return setBootstrapState({
    ready: true,
    inProgress: false,
    userID,
    status,
    error: null,
  });
}

function invalidateBootstrapSession(reason: string): void {
  logger.warn(`[OpenIM] session invalidated: ${reason}`);
  bootstrappedUserID = null;
  bootstrappedToken = null;
  const failed = setBootstrapState({
    ready: false,
    inProgress: false,
    userID: null,
    status: null,
    error: reason,
  });
  broadcastBootstrapResult(failed);
}

/** Active IM login in main — reuse this token so we don't rotate and kill the session. */
export function getActiveOpenIMLogin(): { userID: string; token: string } | null {
  if (!bootstrappedUserID || !bootstrappedToken || !bootstrapState.ready) return null;
  const status = readLoginStatusSync();
  if (status !== null && status !== LoginStatusLogged) return null;
  return { userID: bootstrappedUserID, token: bootstrappedToken };
}

function installSessionEventHook(sdk: OpenIMSDKInternal): void {
  if (sessionEventHookInstalled) return;
  const previousEmit = typeof sdk.emit === 'function' ? sdk.emit.bind(sdk) : null;
  if (!previousEmit) {
    logger.warn('[OpenIM] sdk.emit missing; cannot hook session invalid events');
    return;
  }
  sessionEventHookInstalled = true;
  sdk.emit = (event: string, data: unknown) => {
    if (SESSION_INVALID_EVENTS.has(event)) {
      invalidateBootstrapSession(event);
    }
    return previousEmit(event, data);
  };
  logger.info('[OpenIM] session invalid-event hook installed');
}

async function forceRelogin(
  sdk: OpenIMSDKInternal,
  userID: string,
  token: string,
): Promise<OpenIMBootstrapState> {
  const status = await readStatus(sdk);
  if (status === LoginStatusLogged) {
    logger.info('[OpenIM] logout before token refresh');
    try {
      await Promise.race([sdk.logout(), delay(2_000)]);
    } catch (error) {
      logger.warn('[OpenIM] logout before re-login failed:', error);
    }
  }

  void sdk.login({ userID, token }).then(
    () => logger.info('[OpenIM] re-login callback resolved'),
    (error) => logger.warn('[OpenIM] re-login callback error:', error),
  );

  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const next = await readStatus(sdk);
    logger.info(`[OpenIM] re-login status poll => ${String(next)}`);
    if (next === LoginStatusLogged) {
      const ready = markBootstrapLoggedIn(userID, token, next);
      logger.info(`[OpenIM] bootstrap ready after token refresh userID=${userID}`);
      broadcastBootstrapResult(ready);
      return ready;
    }
    await delay(150);
  }

  const last = await readStatus(sdk);
  const failed = setBootstrapState({
    ready: false,
    inProgress: false,
    userID,
    status: last,
    error: `re-login status poll timed out (lastStatus=${String(last)})`,
  });
  bootstrappedUserID = null;
  bootstrappedToken = null;
  broadcastBootstrapResult(failed);
  return failed;
}

export function initOpenIMMainSDK(webContents: WebContents): boolean {
  registerOpenIMIpcHandlers();
  ensureOpenIMPaths();

  if (sdkInstance) {
    sdkInstance.addWebContent(webContents);
    registerBootstrapHandlers();
    return true;
  }

  const libPath = resolveOpenIMLibPath();
  if (!libPath) {
    initError = 'native library not found';
    logger.error(`[OpenIM] Main SDK skipped: ${initError}`);
    console.error(`[OpenIM] Main SDK skipped: ${initError}`);
    return false;
  }

  try {
    sdkInstance = new OpenIMSDKMain(libPath, webContents);
    initError = null;
    installSessionEventHook((sdkInstance as OpenIMSDKMainInternal).sdk);
    registerBootstrapHandlers();
    logger.info('[OpenIM] Main SDK initialized');
    console.info('[OpenIM] Main SDK initialized');
    return true;
  } catch (error) {
    initError = error instanceof Error ? error.message : String(error);
    logger.error('[OpenIM] Failed to initialize main SDK:', error);
    console.error('[OpenIM] Failed to initialize main SDK:', error);
    return false;
  }
}

/**
 * Full bootstrap in main process.
 * Completes even if the invoke reply channel to renderer is wedged —
 * state + `openim:bootstrap-result` event are the source of truth.
 */
export async function bootstrapOpenIMViaMain(payload: OpenIMBootstrapPayload): Promise<OpenIMBootstrapState> {
  const sdk = getSdk();
  if (!sdk) {
    const failed = setBootstrapState({
      ready: false,
      inProgress: false,
      userID: payload.userID,
      status: null,
      error: 'OpenIM main SDK not ready',
    });
    broadcastBootstrapResult(failed);
    return failed;
  }

  const { userID, token, apiAddr, wsAddr, platformID, dataDir, logFilePath } = payload;

  // Safe reuse only when the same token is still live in the native SDK.
  // Fresh get_user_token rotates the server ticket — reusing old login then kills API calls.
  if (
    bootstrapState.ready
    && bootstrapState.userID === userID
    && bootstrappedUserID === userID
    && bootstrappedToken === token
  ) {
    const status = await readStatus(sdk);
    if (status === LoginStatusLogged) {
      logger.info('[OpenIM] bootstrap reuse logged-in session');
      broadcastBootstrapResult(bootstrapState);
      return bootstrapState;
    }
    logger.warn(`[OpenIM] bootstrap state ready but status=${String(status)}; re-login`);
    invalidateBootstrapSession(`stale login status=${String(status)}`);
  }

  if (
    bootstrappedUserID === userID
    && bootstrappedToken
    && bootstrappedToken !== token
  ) {
    logger.info('[OpenIM] bootstrap token rotated; forcing re-login');
    if (bootstrapInFlight) {
      return bootstrapInFlight;
    }
    bootstrapInFlight = (async () => {
      setBootstrapState({
        ready: false,
        inProgress: true,
        userID,
        status: null,
        error: null,
      });
      try {
        return await forceRelogin(sdk, userID, token);
      } finally {
        bootstrapInFlight = null;
      }
    })();
    return bootstrapInFlight;
  }

  if (bootstrapInFlight) {
    return bootstrapInFlight;
  }

  bootstrapInFlight = (async () => {
    setBootstrapState({
      ready: false,
      inProgress: true,
      userID,
      status: null,
      error: null,
    });
    logger.info(`[OpenIM] bootstrap start userID=${userID}`);

    try {
      let status = await readStatus(sdk);
      if (status === LoginStatusLogged && bootstrappedUserID === userID && bootstrappedToken === token) {
        const ready = markBootstrapLoggedIn(userID, token, status);
        logger.info('[OpenIM] bootstrap reuse after status read');
        broadcastBootstrapResult(ready);
        return ready;
      }

      if (status === LoginStatusLogged && bootstrappedToken !== token) {
        return await forceRelogin(sdk, userID, token);
      }

      try {
        const initResult = await Promise.race([
          sdk.initSDK({
            platformID,
            apiAddr,
            wsAddr,
            dataDir,
            logFilePath,
            logLevel: 4,
            isLogStandardOutput: false,
            systemType: 'electron',
          }),
          delay(5_000).then(() => 'timeout' as const),
        ]);

        if (initResult === 'timeout') {
          const failed = setBootstrapState({
            ready: false,
            inProgress: false,
            userID,
            status: null,
            error: 'initSDK timed out in main',
          });
          broadcastBootstrapResult(failed);
          return failed;
        }
        if (initResult !== true) {
          logger.warn(`[OpenIM] initSDK returned ${String(initResult)}; continuing`);
        } else {
          logger.info('[OpenIM] initSDK ok');
        }
      } catch (error) {
        logger.warn('[OpenIM] initSDK error (may already be inited):', error);
      }

      status = await readStatus(sdk);
      if (status === LoginStatusLogged) {
        // Already logged — only safe if the live token matches what we are about to use.
        if (bootstrappedToken !== token) {
          return await forceRelogin(sdk, userID, token);
        }
        const ready = markBootstrapLoggedIn(userID, token, status);
        logger.info('[OpenIM] already Logged after init');
        broadcastBootstrapResult(ready);
        return ready;
      }

      // Fire login; do not await koffi callback (often never resolves).
      void sdk.login({ userID, token }).then(
        () => logger.info('[OpenIM] login callback resolved'),
        (error) => logger.warn('[OpenIM] login callback error:', error),
      );

      const deadline = Date.now() + 8_000;
      while (Date.now() < deadline) {
        status = await readStatus(sdk);
        logger.info(`[OpenIM] status poll => ${String(status)}`);
        if (status === LoginStatusLogged) {
          const ready = markBootstrapLoggedIn(userID, token, status);
          logger.info(`[OpenIM] bootstrap ready userID=${userID}`);
          broadcastBootstrapResult(ready);
          return ready;
        }
        await delay(150);
      }

      status = await readStatus(sdk);
      const failed = setBootstrapState({
        ready: false,
        inProgress: false,
        userID,
        status,
        error: `login status poll timed out (lastStatus=${String(status)})`,
      });
      bootstrappedUserID = null;
      bootstrappedToken = null;
      broadcastBootstrapResult(failed);
      return failed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      bootstrappedUserID = null;
      bootstrappedToken = null;
      const failed = setBootstrapState({
        ready: false,
        inProgress: false,
        userID,
        status: null,
        error: message,
      });
      broadcastBootstrapResult(failed);
      return failed;
    } finally {
      bootstrapInFlight = null;
    }
  })();

  return bootstrapInFlight;
}

function registerBootstrapHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  ipcMain.handle('openim:getBootstrapState', () => ({ ...bootstrapState }));

  ipcMain.handle('openim:bootstrap', async (_, payload: OpenIMBootstrapPayload | null) => {
    if (!payload?.userID || !payload?.token) {
      const failed = {
        ok: false,
        ready: false,
        inProgress: false,
        userID: null,
        status: null,
        error: 'invalid bootstrap payload',
      };
      broadcastBootstrapResult(failed);
      return failed;
    }
    const state = await bootstrapOpenIMViaMain(payload);
    // Also return for callers whose invoke reply still works.
    return {
      ok: state.ready,
      ready: state.ready,
      inProgress: state.inProgress,
      userID: state.userID,
      status: state.status,
      error: state.error ?? undefined,
    };
  });

  ipcMain.handle(
    'openim:login',
    async (_, payload: { userID?: string; token?: string } | null) => {
      const userID = payload?.userID?.trim() ?? '';
      const token = payload?.token?.trim() ?? '';
      if (!userID || !token) {
        return { ok: false, status: null, error: 'userID/token required' };
      }
      const sdk = getSdk();
      if (!sdk) return { ok: false, status: null, error: 'SDK not ready' };
      void sdk.login({ userID, token }).catch(() => undefined);
      const deadline = Date.now() + 8_000;
      let status: number | null = null;
      while (Date.now() < deadline) {
        status = await readStatus(sdk);
        if (status === LoginStatusLogged) {
          bootstrappedUserID = userID;
          bootstrappedToken = token;
          setBootstrapState({
            ready: true,
            inProgress: false,
            userID,
            status,
            error: null,
          });
          return { ok: true, status };
        }
        await delay(150);
      }
      return { ok: false, status, error: `login poll timed out (lastStatus=${String(status)})` };
    },
  );
}

export async function shutdownOpenIMMainSDK(): Promise<void> {
  if (!sdkInstance) return;

  const internal = sdkInstance as OpenIMSDKMainInternal;
  sdkInstance = null;
  bootstrappedUserID = null;
  bootstrappedToken = null;
  bootstrapInFlight = null;
  sessionEventHookInstalled = false;
  setBootstrapState({
    ready: false,
    inProgress: false,
    userID: null,
    status: null,
    error: null,
  });

  try {
    ipcMain.removeHandler('openim-sdk-ipc-methods');
  } catch {
    // ignore
  }
  try {
    ipcMain.removeHandler('openim:login');
  } catch {
    // ignore
  }
  try {
    ipcMain.removeHandler('openim:bootstrap');
  } catch {
    // ignore
  }
  try {
    ipcMain.removeHandler('openim:getBootstrapState');
  } catch {
    // ignore
  }
  handlersRegistered = false;

  // Must stop IM fully on quit: logout FIRST, then unInit.
  // Parallel / premature unInit causes native panic:
  //   "sdk not logout, please logout first" → nil LoginMgr SIGSEGV
  logger.info('[OpenIM] shutdown: logout…');
  try {
    await Promise.race([
      Promise.resolve(internal.sdk.logout()).catch((error) => {
        logger.warn('[OpenIM] logout during shutdown failed:', error);
      }),
      delay(2_000),
    ]);
  } catch (error) {
    logger.warn('[OpenIM] logout during shutdown error:', error);
  }

  await delay(120);

  logger.info('[OpenIM] shutdown: unInitSDK…');
  try {
    await Promise.race([
      Promise.resolve(internal.sdk.unInitSDK()).catch((error) => {
        logger.warn('[OpenIM] unInitSDK during shutdown failed:', error);
      }),
      delay(1_500),
    ]);
  } catch (error) {
    logger.warn('[OpenIM] unInitSDK during shutdown error:', error);
  }

  logger.info('[OpenIM] Main SDK stopped');
}
