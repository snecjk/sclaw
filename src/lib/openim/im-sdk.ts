import { getWithRenderProcess } from '@openim/electron-client-sdk/lib/render';
import type { IMSDKInterface } from '@openim/electron-client-sdk/lib/render';
import { getOpenIMConfig, type OpenIMConfig } from './config';
import { getOpenIMDataDir, getOpenIMLogDir, getOpenIMPlatformID } from './data-path';
import { openimLog } from './openim-log';

let imsdk: IMSDKInterface | null = null;
let bootstrapPromise: Promise<IMSDKInterface | null> | null = null;
let bootstrapTargetUserID: string | null = null;
let lastBootstrapError: string | null = null;
let activeUserID: string | null = null;

const BOOTSTRAP_TIMEOUT_MS = 20_000;
const STATE_POLL_MS = 100;

interface BootstrapState {
  ok?: boolean;
  ready?: boolean;
  inProgress?: boolean;
  userID?: string | null;
  status?: number | null;
  error?: string | null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isElectronRenderer(): boolean {
  return typeof window !== 'undefined' && Boolean(window.openIMRenderApi);
}

function getBootstrapBlockReason(config: OpenIMConfig): string | null {
  if (!config.isConfigured) return 'env not configured';
  if (!isElectronRenderer()) return 'not in Electron (openIMRenderApi missing)';
  return null;
}

function formatOpenIMError(error: unknown): string {
  if (!error) return 'unknown error';
  if (typeof error === 'string') return error;
  if (typeof error === 'boolean') return error ? 'unknown error' : 'initSDK returned false';
  if (error instanceof Error) return error.message;
  if (typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const parts = [
      record.errMsg,
      record.errDlt,
      record.message,
      record.errCode !== undefined ? `errCode=${String(record.errCode)}` : null,
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(' | ');
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function getRenderInstance(): IMSDKInterface {
  const { instance } = getWithRenderProcess();
  return instance;
}

function isReadyState(state: BootstrapState | null | undefined, userID: string): boolean {
  return Boolean(state?.ready && state.userID === userID);
}

function isFailedState(state: BootstrapState | null | undefined, userID: string): boolean {
  return Boolean(
    state
    && state.userID === userID
    && !state.ready
    && !state.inProgress
    && state.error,
  );
}

async function readBootstrapState(): Promise<BootstrapState | null> {
  try {
    return await withTimeout(
      window.electron.ipcRenderer.invoke('openim:getBootstrapState') as Promise<BootstrapState>,
      800,
      'getBootstrapState',
    );
  } catch (error) {
    openimLog('getBootstrapState failed', error);
    return null;
  }
}

/**
 * Wait for main-process bootstrap via push event + best-effort state poll.
 * Push event is authoritative when invoke replies are wedged.
 */
function waitUntilMainReady(userID: string, timeoutMs: number): Promise<BootstrapState> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;

    const finish = (state: BootstrapState | null, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      unsubscribe?.();
      if (error) {
        reject(error);
        return;
      }
      if (!state) {
        reject(new Error(`bootstrap poll timed out after ${timeoutMs}ms`));
        return;
      }
      resolve(state);
    };

    const timeoutTimer = setTimeout(() => {
      finish(null, new Error(`bootstrap poll timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const onResult = (...args: unknown[]) => {
      const state = args[0] as BootstrapState | undefined;
      if (!state || state.userID !== userID) return;
      if (isReadyState(state, userID) || isFailedState(state, userID)) {
        openimLog('bootstrap via event', state);
        finish(state);
      }
    };

    try {
      const maybeUnsub = window.electron.ipcRenderer.on('openim:bootstrap-result', onResult);
      unsubscribe = typeof maybeUnsub === 'function' ? maybeUnsub : undefined;
    } catch (error) {
      openimLog('bootstrap event subscribe failed', error);
    }

    const poll = async () => {
      while (!settled) {
        const state = await readBootstrapState();
        if (state && (isReadyState(state, userID) || isFailedState(state, userID))) {
          openimLog('bootstrap via state poll', state);
          finish(state);
          return;
        }
        await delay(STATE_POLL_MS);
      }
    };
    void poll();
  });
}

async function runBootstrap(config: OpenIMConfig): Promise<IMSDKInterface | null> {
  const blockReason = getBootstrapBlockReason(config);
  if (blockReason) {
    lastBootstrapError = blockReason;
    openimLog(`bootstrap skipped: ${blockReason}`);
    return null;
  }

  if (imsdk && activeUserID === config.userID) {
    openimLog('bootstrap reuse renderer session');
    return imsdk;
  }

  const dataDir = await getOpenIMDataDir(config.userID);
  const logFilePath = await getOpenIMLogDir(config.userID);
  const payload = {
    userID: config.userID,
    token: config.token,
    apiAddr: config.apiAddr,
    wsAddr: config.wsAddr,
    platformID: getOpenIMPlatformID(),
    dataDir,
    logFilePath,
  };

  openimLog('bootstrap via main process', {
    userID: config.userID,
    apiAddr: config.apiAddr,
    wsAddr: config.wsAddr,
    platformID: payload.platformID,
  });

  // Ensure render proxy is created and subscribed to events before main inits.
  const instance = getRenderInstance();

  // Subscribe / poll BEFORE kicking bootstrap so we never miss the push event.
  const readyWait = waitUntilMainReady(config.userID, 15_000);

  // Kick main bootstrap. Do NOT await invoke — reply channel has been observed to hang
  // even after main logs "bootstrap ready". State poll + event are authoritative.
  void window.electron.ipcRenderer.invoke('openim:bootstrap', payload).then(
    (result) => openimLog('bootstrap invoke reply', result),
    (error) => openimLog('bootstrap invoke error/hang', error),
  );

  const state = await readyWait;
  openimLog('bootstrap main state', state);

  if (!isReadyState(state, config.userID)) {
    throw new Error(state.error || 'OpenIM bootstrap failed');
  }

  imsdk = instance;
  activeUserID = config.userID;
  openimLog('bootstrap ready', { userID: config.userID, status: state.status });
  return instance;
}

export function isOpenIMReady(): boolean {
  return imsdk !== null && activeUserID !== null;
}

export function getIMSDK(): IMSDKInterface | null {
  return isOpenIMReady() ? imsdk : null;
}

export function getActiveOpenIMUserID(): string | null {
  return activeUserID;
}

export function getLastBootstrapError(): string | null {
  return lastBootstrapError;
}

/**
 * Attach renderer SDK proxy after main process already logged in
 * (e.g. credentials HTTP response carried imReady=true).
 * Does not call native login again — avoids wedged IPC invoke paths.
 */
export function attachOpenIMRendererSession(userID: string): IMSDKInterface | null {
  const blockReason = getBootstrapBlockReason({
    enabled: true,
    apiAddr: '',
    wsAddr: '',
    userID,
    token: 'attached',
    isConfigured: true,
  });
  if (blockReason) {
    lastBootstrapError = blockReason;
    openimLog(`attach skipped: ${blockReason}`);
    return null;
  }

  if (imsdk && activeUserID === userID) {
    return imsdk;
  }

  const instance = getRenderInstance();
  imsdk = instance;
  activeUserID = userID;
  lastBootstrapError = null;
  openimLog('renderer session attached (main already ready)', { userID });
  return instance;
}

export async function bootstrapOpenIM(config?: OpenIMConfig): Promise<IMSDKInterface | null> {
  const resolved = config ?? getOpenIMConfig();
  openimLog('bootstrap start', {
    isConfigured: resolved.isConfigured,
    userID: resolved.userID,
    hasToken: Boolean(resolved.token),
    inElectron: isElectronRenderer(),
  });

  if (imsdk && activeUserID === resolved.userID) {
    return imsdk;
  }

  if (bootstrapPromise && bootstrapTargetUserID === resolved.userID) {
    return bootstrapPromise;
  }

  if (bootstrapPromise) {
    try {
      await withTimeout(bootstrapPromise, 2_000, 'await previous bootstrap');
    } catch {
      // ignore
    }
    bootstrapPromise = null;
    bootstrapTargetUserID = null;
  }

  bootstrapTargetUserID = resolved.userID;
  bootstrapPromise = withTimeout(
    (async () => {
      lastBootstrapError = null;
      return runBootstrap(resolved);
    })(),
    BOOTSTRAP_TIMEOUT_MS,
    'bootstrap',
  )
    .catch((error) => {
      lastBootstrapError = formatOpenIMError(error);
      openimLog('bootstrap failed', { error: lastBootstrapError });
      return null;
    })
    .finally(() => {
      if (bootstrapTargetUserID === resolved.userID) {
        bootstrapPromise = null;
        bootstrapTargetUserID = null;
      }
    });

  return bootstrapPromise;
}

export async function shutdownOpenIMSession(): Promise<void> {
  const instance = imsdk;
  imsdk = null;
  activeUserID = null;
  bootstrapPromise = null;
  bootstrapTargetUserID = null;
  if (!instance) return;

  try {
    await withTimeout(Promise.resolve(instance.logout?.() as Promise<unknown>), 1_000, 'logout');
  } catch {
    // ignore hung logout
  }
}
