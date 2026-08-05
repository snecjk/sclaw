/**
 * DingTalk dws OAuth login — embedded BrowserWindow instead of system browser.
 *
 * Loopback flow (macOS/Linux): block `open`/`xdg-open`, parse auth URL from dws stderr,
 * load it in a child window; let 127.0.0.1 callback hit dws local listener.
 *
 * Device flow (Windows): open verification URL with user_code in embedded window.
 */
import { BrowserWindow, session } from 'electron';
import { type ChildProcess, spawn } from 'node:child_process';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logger } from './logger';
import { resolveDwsBinary } from './dws-cli';

const DWS_LOGIN_PARTITION = 'persist:dws-login';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

const LOOPBACK_AUTH_URL_RE = /https:\/\/login\.dingtalk\.com\/oauth2\/auth\?\S+/i;
const DEVICE_VERIFY_URL_RE = /https:\/\/login\.dingtalk\.com\/oauth2\/device\/verify\.htm\?user_code=\S+/i;
const LOOPBACK_CALLBACK_RE = /^http:\/\/127\.0\.0\.1:\d+\//i;

export class DwsLoginManager {
  private loginWindow: BrowserWindow | null = null;
  private activeChild: ChildProcess | null = null;

  cancelLogin(): void {
    if (this.activeChild && !this.activeChild.killed) {
      this.activeChild.kill('SIGTERM');
      this.activeChild = null;
    }
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      this.loginWindow.close();
      this.loginWindow = null;
    }
  }

  async startLogin(parentWindow: BrowserWindow): Promise<void> {
    this.cancelLogin();

    const binary = resolveDwsBinary();
    if (!binary) {
      throw new Error('dws is not installed');
    }

    const useDeviceFlow = process.platform === 'win32';
    const args = useDeviceFlow
      ? ['auth', 'login', '--device', '--force']
      : ['auth', 'login', '--force'];

    const env = await this.buildSpawnEnv();

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let loginUrl: string | null = null;
      let loginWindowOpened = false;
      let cancelledByUser = false;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        this.activeChild = null;
        fn();
      };

      const child = spawn(binary, args, {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      this.activeChild = child;

      const maybeOpenWindow = (text: string) => {
        if (loginWindowOpened || !text) return;
        const match = text.match(useDeviceFlow ? DEVICE_VERIFY_URL_RE : LOOPBACK_AUTH_URL_RE);
        if (!match?.[0]) return;
        loginUrl = match[0].trim();
        loginWindowOpened = true;
        void this.openLoginWindow(parentWindow, loginUrl, {
          onClosed: () => {
            cancelledByUser = true;
          },
        }).catch((error) => {
          logger.warn(
            '[DwsLogin] open login window failed:',
            error instanceof Error ? error.message : String(error),
          );
        });
      };

      const onOutput = (chunk: Buffer) => {
        const text = chunk.toString();
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (trimmed) logger.info(`[DwsLogin] ${trimmed}`);
        }
        maybeOpenWindow(text);
      };

      child.stdout.on('data', onOutput);
      child.stderr.on('data', onOutput);

      child.on('error', (error) => {
        this.closeLoginWindow();
        settle(() => reject(error));
      });

      child.on('close', (code) => {
        this.closeLoginWindow();
        if (code === 0) {
          settle(() => resolve());
          return;
        }
        if (cancelledByUser) {
          settle(() => reject(new Error('DingTalk login cancelled')));
          return;
        }
        settle(() => reject(new Error(`dws auth login failed (exit ${code ?? 'unknown'})`)));
      });

      const timer = setTimeout(() => {
        this.cancelLogin();
        settle(() => reject(new Error('DingTalk login timed out (5 minutes)')));
      }, LOGIN_TIMEOUT_MS);

      const clearTimer = () => clearTimeout(timer);
      child.once('close', clearTimer);
      child.once('error', clearTimer);
    });
  }

  private async buildSpawnEnv(): Promise<NodeJS.ProcessEnv> {
    const env = { ...process.env };
    if (process.platform === 'win32') {
      return env;
    }

    const noopDir = await mkdtemp(join(tmpdir(), 'stoclaw-dws-noop-'));
    const scriptName = process.platform === 'darwin' ? 'open' : 'xdg-open';
    const scriptPath = join(noopDir, scriptName);
    await writeFile(scriptPath, '#!/bin/sh\nexit 0\n', 'utf-8');
    await chmod(scriptPath, 0o755);

    const pathSep = process.platform === 'win32' ? ';' : ':';
    env.PATH = `${noopDir}${pathSep}${env.PATH || ''}`;
    return env;
  }

  private closeLoginWindow(): void {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      this.loginWindow.close();
    }
    this.loginWindow = null;
  }

  private async openLoginWindow(
    parentWindow: BrowserWindow,
    loginUrl: string,
    options?: { onClosed?: () => void },
  ): Promise<void> {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      await this.loginWindow.loadURL(loginUrl);
      return;
    }

    const ses = session.fromPartition(DWS_LOGIN_PARTITION);
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
      title: '钉钉登录',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        session: ses,
      },
    });
    win.setMenu(null);
    this.loginWindow = win;

    const handleNavigation = (url: string) => {
      logger.info(`[DwsLogin:nav] ${url.substring(0, 300)}`);
      if (LOOPBACK_CALLBACK_RE.test(url)) {
        // Do not cancel — dws loopback server must receive this request.
      }
    };

    win.webContents.on('will-navigate', (_event, url) => handleNavigation(url));
    win.webContents.on('did-navigate', (_event, url) => handleNavigation(url));
    win.webContents.on('did-navigate-in-page', (_event, url) => handleNavigation(url));

    win.webContents.setWindowOpenHandler(({ url }) => {
      handleNavigation(url);
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
      // User closed the window (or navigation aborted) — not a fatal main-process error.
      if (win.isDestroyed()) return;
      const message = error instanceof Error ? error.message : String(error);
      if (/ERR_ABORTED|ERR_FAILED|-3\b/i.test(message)) return;
      throw error;
    }
  }
}

let manager: DwsLoginManager | null = null;

export function getDwsLoginManager(): DwsLoginManager {
  if (!manager) {
    manager = new DwsLoginManager();
  }
  return manager;
}
