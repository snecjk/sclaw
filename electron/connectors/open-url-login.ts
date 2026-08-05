/**
 * Generic CLI open_url login — spawn auth.login, extract URL, open embedded/system.
 */
import { BrowserWindow, session, shell } from 'electron';
import { type ChildProcess, spawn } from 'node:child_process';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  extractLoginUrlFromOutput,
  interpretAuthStatusWithPatterns,
  normalizeLoginUrlPatterns,
} from '../../shared/connectors/auth-output-match';
import type { ManagedCliAuthSpec } from '../../shared/connectors/types';
import { resolveBinaryAfterInstall } from './installers/shell-script-installer';
import { logger } from '../utils/logger';
import { runAuthStatusFromSpec } from './managed-cli-auth-commands';

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const PARTITION_PREFIX = 'persist:connector-open-url-login';

export type OpenUrlLoginResult = {
  ok: boolean;
  error?: string;
  exitCode: number;
};

function resolveParentWindow(explicit?: BrowserWindow | null): BrowserWindow | null {
  if (explicit && !explicit.isDestroyed()) return explicit;
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused;
  return BrowserWindow.getAllWindows().find((win) => !win.isDestroyed()) ?? null;
}

function resolveLoginArgv(auth: ManagedCliAuthSpec): string[] {
  if (process.platform === 'win32' && auth.loginWindows?.length) {
    return auth.loginWindows;
  }
  return auth.login ?? [];
}

async function buildSpawnEnv(blockSystemOpen: boolean): Promise<NodeJS.ProcessEnv> {
  const env = { ...process.env };
  if (!blockSystemOpen || process.platform === 'win32') return env;

  const noopDir = await mkdtemp(join(tmpdir(), 'stoclaw-cli-noop-'));
  const scriptName = process.platform === 'darwin' ? 'open' : 'xdg-open';
  const scriptPath = join(noopDir, scriptName);
  await writeFile(scriptPath, '#!/bin/sh\nexit 0\n', 'utf-8');
  await chmod(scriptPath, 0o755);
  env.PATH = `${noopDir}:${env.PATH || ''}`;
  return env;
}

class OpenUrlLoginSession {
  private loginWindow: BrowserWindow | null = null;
  private activeChild: ChildProcess | null = null;

  cancel(): void {
    if (this.activeChild && !this.activeChild.killed) {
      this.activeChild.kill('SIGTERM');
      this.activeChild = null;
    }
    this.closeWindow();
  }

  private closeWindow(): void {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      this.loginWindow.close();
    }
    this.loginWindow = null;
  }

  async run(options: {
    binaryPath: string;
    argv: string[];
    auth: ManagedCliAuthSpec;
    parentWindow: BrowserWindow | null;
  }): Promise<void> {
    this.cancel();
    const patterns = normalizeLoginUrlPatterns(options.auth.loginUrlPattern);
    if (patterns.length === 0) {
      throw new Error('缺少 auth.loginUrlPattern，无法打开授权页');
    }
    const openIn = options.auth.openIn === 'system' ? 'system' : 'embedded';
    if (openIn === 'embedded' && !options.parentWindow) {
      throw new Error('Main window unavailable');
    }
    const env = await buildSpawnEnv(options.auth.blockSystemOpen === true);
    const args = options.argv.slice(1);
    const bin = options.argv[0] || options.binaryPath;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let loginOpened = false;
      let cancelledByUser = false;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        this.activeChild = null;
        fn();
      };

      const child = spawn(bin, args, {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      this.activeChild = child;

      const maybeOpen = (text: string) => {
        if (loginOpened || !text) return;
        const loginUrl = extractLoginUrlFromOutput(text, patterns);
        if (!loginUrl) return;
        loginOpened = true;
        if (openIn === 'system') {
          void shell.openExternal(loginUrl).catch((error) => {
            logger.warn(
              '[open-url-login] openExternal failed:',
              error instanceof Error ? error.message : String(error),
            );
          });
          return;
        }
        const parent = options.parentWindow;
        if (!parent) return;
        void this.openEmbedded(parent, loginUrl, {
          onClosed: () => {
            cancelledByUser = true;
          },
        }).catch((error) => {
          logger.warn(
            '[open-url-login] embedded window failed:',
            error instanceof Error ? error.message : String(error),
          );
        });
      };

      const onOutput = (chunk: Buffer) => {
        const text = chunk.toString();
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (trimmed && !/[▄█▀]/.test(trimmed)) {
            logger.info(`[open-url-login] ${trimmed}`);
          }
        }
        maybeOpen(text);
      };

      child.stdout?.on('data', onOutput);
      child.stderr?.on('data', onOutput);

      child.on('error', (error) => {
        this.closeWindow();
        settle(() => reject(error));
      });

      child.on('close', (code) => {
        this.closeWindow();
        if (code === 0) {
          settle(() => resolve());
          return;
        }
        if (cancelledByUser) {
          settle(() => reject(new Error('login cancelled')));
          return;
        }
        settle(() => reject(new Error(`CLI login failed (exit ${code ?? 'unknown'})`)));
      });

      const timer = setTimeout(() => {
        this.cancel();
        settle(() => reject(new Error('CLI login timed out (5 minutes)')));
      }, LOGIN_TIMEOUT_MS);

      const clearTimer = () => clearTimeout(timer);
      child.once('close', clearTimer);
      child.once('error', clearTimer);
    });
  }

  private async openEmbedded(
    parentWindow: BrowserWindow,
    loginUrl: string,
    options?: { onClosed?: () => void },
  ): Promise<void> {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      await this.loginWindow.loadURL(loginUrl);
      return;
    }

    const ses = session.fromPartition(PARTITION_PREFIX);
    const isMac = process.platform === 'darwin';
    const pb = parentWindow.getContentBounds();
    let width = Math.floor(pb.width);
    let height = Math.floor(pb.height);
    if (width < 420 || height < 520) {
      width = 960;
      height = 720;
    }

    const win = new BrowserWindow({
      width,
      height,
      x: Math.floor(pb.x + Math.max(0, (pb.width - width) / 2)),
      y: Math.floor(pb.y + Math.max(0, (pb.height - height) / 2)),
      parent: parentWindow,
      modal: !isMac,
      show: false,
      resizable: true,
      autoHideMenuBar: true,
      title: '授权登录',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        session: ses,
      },
    });
    win.setMenu(null);
    this.loginWindow = win;

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        void win.loadURL(url);
      }
      return { action: 'deny' };
    });

    win.on('closed', () => {
      this.loginWindow = null;
      options?.onClosed?.();
      if (this.activeChild && !this.activeChild.killed) {
        this.activeChild.kill('SIGTERM');
        this.activeChild = null;
      }
    });

    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.show();
    });

    try {
      await win.loadURL(loginUrl);
    } catch (error) {
      if (win.isDestroyed()) return;
      const message = error instanceof Error ? error.message : String(error);
      if (/ERR_ABORTED|ERR_FAILED|-3\b/i.test(message)) return;
      throw error;
    }
  }
}

let sessionSingleton: OpenUrlLoginSession | null = null;

function getSession(): OpenUrlLoginSession {
  if (!sessionSingleton) sessionSingleton = new OpenUrlLoginSession();
  return sessionSingleton;
}

export async function runOpenUrlLogin(options: {
  auth: ManagedCliAuthSpec;
  binary: string;
  binDir?: string;
  parentWindow?: BrowserWindow | null;
}): Promise<OpenUrlLoginResult> {
  const argv = resolveLoginArgv(options.auth);
  if (argv.length === 0) {
    return { ok: false, error: '缺少 auth.login', exitCode: 1 };
  }
  if (normalizeLoginUrlPatterns(options.auth.loginUrlPattern).length === 0) {
    return { ok: false, error: '缺少 auth.loginUrlPattern', exitCode: 1 };
  }

  const parent = resolveParentWindow(options.parentWindow);
  if (!parent && options.auth.openIn !== 'system') {
    return { ok: false, error: 'Main window unavailable', exitCode: 1 };
  }

  const binaryPath =
    resolveBinaryAfterInstall({ binary: options.binary, binDir: options.binDir }) || options.binary;

  try {
    const spawnArgv =
      argv[0] === options.binary || argv[0] === binaryPath
        ? [binaryPath, ...argv.slice(1)]
        : argv;
    await getSession().run({
      binaryPath,
      argv: spawnArgv,
      auth: options.auth,
      parentWindow: parent,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, exitCode: 1 };
  }

  if (options.auth.status?.length) {
    const status = await runAuthStatusFromSpec({
      auth: options.auth,
      binary: options.binary,
      binDir: options.binDir,
    });
    const authenticated = interpretAuthStatusWithPatterns({
      stdout: status.stdout || '',
      stderr: status.stderr || '',
      exitCode: status.exitCode,
      loggedInPattern: options.auth.loggedInPattern,
      loggedOutPattern: options.auth.loggedOutPattern,
    });
    if (!authenticated) {
      return {
        ok: false,
        error: status.error || status.stderr || '授权未完成，请重试',
        exitCode: status.exitCode || 1,
      };
    }
  }

  return { ok: true, exitCode: 0 };
}

/** Probe helpers used by reauth — status patterns without full login. */
export async function probeOpenUrlAuthenticated(options: {
  auth: ManagedCliAuthSpec;
  binary: string;
  binDir?: string;
}): Promise<boolean> {
  if (!options.auth.status?.length) {
    return false;
  }
  const status = await runAuthStatusFromSpec({
    auth: options.auth,
    binary: options.binary,
    binDir: options.binDir,
  });
  return interpretAuthStatusWithPatterns({
    stdout: status.stdout || '',
    stderr: status.stderr || '',
    exitCode: status.exitCode,
    loggedInPattern: options.auth.loggedInPattern,
    loggedOutPattern: options.auth.loggedOutPattern,
  });
}
