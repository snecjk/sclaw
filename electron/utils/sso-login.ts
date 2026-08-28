/**
 * SSO Login Window Manager
 * Opens the STO SSO login page in an Electron BrowserWindow and
 * intercepts the redirect callback to capture the authorization code.
 *
 * Strategy:
 * 1. session.webRequest.onBeforeRequest intercepts ALL main-frame requests
 *    and checks for the callback URL or any URL carrying an auth code.
 * 2. will-navigate / will-redirect serve as fallback interception.
 * 3. new-window handler catches popup-based redirects.
 */

import { BrowserWindow, session } from 'electron';
import type { SsoEnvironment, SsoUserInfo } from './auth-store';
import { buildLoginUrl, exchangeCodeForUser, getBaseUrl } from './sso-service';
import { logger } from './logger';

const SSO_CALLBACK_PREFIX = 'https://sso-callback.stoclaw.local/callback';
const SSO_PARTITION = 'persist:sso-login';

/** SSO domain suffixes — navigations to these are part of the login flow, not callbacks. */
const SSO_DOMAINS = ['.sto.cn', '.stosystem.com'];

function isSsoDomain(hostname: string): boolean {
  return SSO_DOMAINS.some((d) => hostname === d.slice(1) || hostname.endsWith(d));
}

export function createSsoCallbackClaimGuard(): () => boolean {
  let claimed = false;
  return () => {
    if (claimed) return false;
    claimed = true;
    return true;
  };
}

/**
 * True when a loadURL rejection is a superseded navigation rather than a real
 * load failure：回调拦截（webRequest cancel / preventDefault）或已登录 SSO 直接
 * 回跳会把进行中的导航打成 ERR_ABORTED（errno -3），此时 handleCallbackUrl 已在
 * 交换 code，不能把登录 Promise 判负。
 */
export function isAbortedNavigationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if ((error as { code?: unknown }).code === 'ERR_ABORTED') return true;
  if ((error as { errno?: unknown }).errno === -3) return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.includes('ERR_ABORTED');
}

export class SsoLoginManager {
  private loginWindow: BrowserWindow | null = null;

  /**
   * Open the SSO login window and wait for the user to complete authentication.
   * Resolves with user info on success, rejects on cancellation or error.
   */
  async startLogin(
    env: SsoEnvironment,
    parentWindow: BrowserWindow,
  ): Promise<SsoUserInfo> {
    // Close any existing login window
    this.cancelLogin();

    const baseUrl = getBaseUrl(env);
    // SSO system expects {0} placeholder in returnUrl — it replaces {0} with the auth code
    const callbackUrl = `${SSO_CALLBACK_PREFIX}?Code={0}`;
    const loginUrl = buildLoginUrl(baseUrl, callbackUrl);

    logger.info(`Opening SSO login window for environment: ${env}`);
    logger.info(`SSO login URL: ${loginUrl}`);

    return new Promise<SsoUserInfo>((resolve, reject) => {
      const ses = session.fromPartition(SSO_PARTITION);

      const isMac = process.platform === 'darwin';

      // 与主窗口内容区同宽同高，视觉上与主题框架对齐
      const pb = parentWindow.getContentBounds();
      let width = Math.floor(pb.width);
      let height = Math.floor(pb.height);
      if (width < 400 || height < 400) {
        width = 1280;
        height = 860;
      }

      const win = new BrowserWindow({
        width,
        height,
        x: Math.floor(pb.x),
        y: Math.floor(pb.y),
        parent: parentWindow,
        // On macOS, modal + parent creates a "sheet" window without
        // close/minimize/maximize buttons. Use non-modal child window
        // instead so macOS renders native traffic-light controls.
        modal: !isMac,
        show: false,
        resizable: true,
        autoHideMenuBar: true,
        menuBarVisible: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          session: ses,
        },
      });

      // Remove menu bar entirely
      win.setMenu(null);

      this.loginWindow = win;
      let settled = false;
      const claimCallback = createSsoCallbackClaimGuard();

      const cleanup = () => {
        ses.webRequest.onBeforeRequest(null);
      };

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        this.loginWindow = null;
        cleanup();
        fn();
      };

      /**
       * Extract the authorization code from a URL.
       * Tries multiple common parameter names.
       */
      const extractCode = (url: string): string | null => {
        try {
          const parsed = new URL(url);
          return (
            parsed.searchParams.get('code') ||
            parsed.searchParams.get('Code') ||
            parsed.searchParams.get('authorizationCode') ||
            parsed.searchParams.get('AuthorizationCode') ||
            null
          );
        } catch {
          return null;
        }
      };

      /**
       * Check if a URL is an SSO callback (either our explicit callback URL
       * or any non-SSO-domain URL carrying an authorization code).
       */
      const isSsoCallback = (url: string): boolean => {
        if (url.startsWith(SSO_CALLBACK_PREFIX)) return true;
        try {
          const parsed = new URL(url);
          // If the navigation leaves the SSO domain and carries a code, treat as callback
          if (!isSsoDomain(parsed.hostname) && extractCode(url)) return true;
        } catch {
          // ignore
        }
        return false;
      };

      const handleCallbackUrl = async (url: string) => {
        if (settled || !claimCallback()) {
          logger.info('Ignoring duplicate SSO callback while code exchange is already in progress');
          return;
        }

        logger.info(`SSO callback URL intercepted (full): ${url}`);

        const code = extractCode(url);
        logger.info(`Extracted code: ${code ? `"${code}" (length=${code.length})` : 'NULL/EMPTY'}`);

        if (!code) {
          logger.error(`SSO callback missing code param. Full URL: ${url}`);
          settle(() => {
            if (!win.isDestroyed()) win.close();
            reject(new Error(`SSO callback missing code parameter. URL: ${url}`));
          });
          return;
        }

        try {
          logger.info(`Exchanging SSO code for user info... code="${code}"`);
          const user = await exchangeCodeForUser(baseUrl, code);
          logger.info(`SSO login successful: ${user.realName}`);
          settle(() => {
            if (!win.isDestroyed()) win.close();
            resolve(user);
          });
        } catch (error) {
          logger.error('SSO code exchange failed:', error);
          settle(() => {
            if (!win.isDestroyed()) win.close();
            reject(error);
          });
        }
      };

      // ---- Network-level interception (broadest, most reliable) ----
      // No URL filter — we inspect ALL requests so we never miss the redirect
      // regardless of which domain the SSO system actually redirects to.
      ses.webRequest.onBeforeRequest((details, callback) => {
        // Log main-frame navigations for debugging
        if (details.resourceType === 'mainFrame') {
          logger.info(`[webRequest:mainFrame] ${details.method} ${details.url.substring(0, 300)}`);

          if (isSsoCallback(details.url)) {
            logger.info('[webRequest] SSO callback matched — cancelling request');
            callback({ cancel: true });
            void handleCallbackUrl(details.url);
            return;
          }
        }
        callback({});
      });

      // ---- Fallback: navigation-level interception ----
      win.webContents.on('will-redirect', (_event, url) => {
        logger.info(`[will-redirect] ${url.substring(0, 300)}`);
        if (isSsoCallback(url)) {
          logger.info('[will-redirect] SSO callback matched');
          _event.preventDefault();
          void handleCallbackUrl(url);
        }
      });

      win.webContents.on('will-navigate', (_event, url) => {
        logger.info(`[will-navigate] ${url.substring(0, 300)}`);
        if (isSsoCallback(url)) {
          logger.info('[will-navigate] SSO callback matched');
          _event.preventDefault();
          void handleCallbackUrl(url);
        }
      });

      // ---- Handle popup windows (in case SSO opens a new window) ----
      win.webContents.setWindowOpenHandler(({ url }) => {
        logger.info(`[new-window] ${url.substring(0, 300)}`);
        if (isSsoCallback(url)) {
          logger.info('[new-window] SSO callback matched in popup');
          void handleCallbackUrl(url);
          return { action: 'deny' };
        }
        // Allow other popups (e.g. QR code helper pages)
        return { action: 'allow' };
      });

      // Log completed navigations for debugging
      win.webContents.on('did-navigate', (_event, url) => {
        logger.info(`[did-navigate] ${url.substring(0, 300)}`);
        // Last-resort check: page already loaded but we didn't catch it earlier
        if (isSsoCallback(url)) {
          logger.info('[did-navigate] SSO callback matched (late catch)');
          void handleCallbackUrl(url);
        }
      });

      win.webContents.on('did-navigate-in-page', (_event, url) => {
        logger.info(`[did-navigate-in-page] ${url.substring(0, 300)}`);
      });

      // User closed the window before completing login
      win.on('closed', () => {
        settle(() => {
          reject(new Error('SSO_LOGIN_CANCELLED'));
        });
      });

      win.once('ready-to-show', () => {
        if (!win.isDestroyed()) {
          win.show();
        }
      });

      win.loadURL(loginUrl).catch((err) => {
        if (isAbortedNavigationError(err)) {
          // 回调拦截取消了本次导航（正常流程），code 交换由 handleCallbackUrl 完成
          logger.info('SSO login page load superseded by callback interception; continuing');
          return;
        }
        logger.error('Failed to load SSO login URL:', err);
        settle(() => {
          if (!win.isDestroyed()) win.close();
          reject(new Error(`Failed to load SSO login page: ${String(err)}`));
        });
      });
    });
  }

  /**
   * Cancel any in-progress login by closing the window.
   */
  cancelLogin(): void {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      this.loginWindow.close();
      this.loginWindow = null;
    }
  }
}
