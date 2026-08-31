/**
 * Embed browser session — isolated persist partition with first-party cookie context.
 * Syncs STO domain cookies from defaultSession before each embed navigation.
 */
import { session, type Cookie } from 'electron';
import {
  SCLAW_EMBED_BROWSER_PARTITION,
  SCLAW_EMBED_COOKIE_DOMAIN_SUFFIXES,
  isStoEmbedBrowserUrl,
} from '../../../shared/sclaw-embed-browser';
import { getStoPolicyReportApiHost } from '../../../shared/env-config';
import {
  STO_POLICY_AUTH_COOKIE_NAMES,
  TEAMBITION_AUTH_COOKIE_NAMES,
  hasValidStoPolicyAuthCookie,
  hasValidTeambitionAuthCookie,
} from '../../../shared/sto-policy-auth-cookie';
import { logger } from '../../utils/logger';

/** Prefer Chinese for DingTalk / STO SSO widgets that key off Accept-Language. */
const EMBED_ACCEPT_LANGUAGE = 'zh-CN,zh;q=0.9';

let localeHeadersInstalled = false;

function ensureEmbedLocaleHeaders(embedSession: Electron.Session): void {
  if (localeHeadersInstalled) return;
  localeHeadersInstalled = true;

  embedSession.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({
      requestHeaders: {
        ...details.requestHeaders,
        'Accept-Language': EMBED_ACCEPT_LANGUAGE,
      },
    });
  });
}

function cookieTargetUrl(cookie: Cookie): string {
  const domain = (cookie.domain ?? '').replace(/^\./, '');
  const path = cookie.path ?? '/';
  const scheme = cookie.secure ? 'https' : 'http';
  return `${scheme}://${domain}${path.startsWith('/') ? path : `/${path}`}`;
}

async function copyCookieToSession(targetSession: Electron.Session, cookie: Cookie): Promise<void> {
  try {
    await targetSession.cookies.set({
      url: cookieTargetUrl(cookie),
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      expirationDate: cookie.expirationDate,
      sameSite: cookie.sameSite,
    });
  } catch {
    // ignore individual cookie copy failures
  }
}

async function syncDomainCookies(
  sourceSession: Electron.Session,
  targetSession: Electron.Session,
  domain: string,
): Promise<number> {
  const cookies = await sourceSession.cookies.get({ domain });
  await Promise.all(cookies.map((cookie) => copyCookieToSession(targetSession, cookie)));
  return cookies.length;
}

/** Copy STO-related cookies from defaultSession into the embed partition. */
export async function prepareSclawEmbedBrowserSession(url: string): Promise<void> {
  const embedSession = session.fromPartition(SCLAW_EMBED_BROWSER_PARTITION);
  ensureEmbedLocaleHeaders(embedSession);

  if (!isStoEmbedBrowserUrl(url)) return;

  let copied = 0;

  for (const domain of SCLAW_EMBED_COOKIE_DOMAIN_SUFFIXES) {
    copied += await syncDomainCookies(session.defaultSession, embedSession, domain);
  }

  if (copied > 0) {
    logger.info(`[SclawEmbedBrowser] synced ${copied} cookie(s) into ${SCLAW_EMBED_BROWSER_PARTITION}`);
  }
}

export interface SclawEmbedSessionCookieSnapshot {
  name: string;
  valuePreview: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate?: number;
}

function maskCookieValue(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return `(${value.length} chars)`;
  return `${value.slice(0, 4)}…${value.slice(-4)} (${value.length})`;
}

/** 读取 embed 分区在指定 URL 下的 cookie（值脱敏，供 SSO 调试）。 */
export async function listSclawEmbedSessionCookies(url: string): Promise<SclawEmbedSessionCookieSnapshot[]> {
  const target = url.trim();
  if (!target || !isStoEmbedBrowserUrl(target)) return [];

  const embedSession = session.fromPartition(SCLAW_EMBED_BROWSER_PARTITION);
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return [];
  }

  const cookies = await embedSession.cookies.get({ url: parsed.origin });
  return cookies.map((cookie) => ({
    name: cookie.name,
    valuePreview: maskCookieValue(cookie.value),
    domain: cookie.domain ?? '',
    path: cookie.path ?? '/',
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly),
    expirationDate: cookie.expirationDate,
  }));
}

function stoPolicyCookieHosts(): string[] {
  const primary = getStoPolicyReportApiHost();
  const hosts = new Set<string>([primary, 'zc.sto.cn', 'pre-zc.sto.cn', 'zc-test.sto.cn']);
  return Array.from(hosts);
}

async function collectStoPolicyAuthCookies(targetSession: Electron.Session): Promise<Cookie[]> {
  const collected: Cookie[] = [];
  for (const host of stoPolicyCookieHosts()) {
    try {
      const cookies = await targetSession.cookies.get({ url: `https://${host}/` });
      for (const cookie of cookies) {
        if ((STO_POLICY_AUTH_COOKIE_NAMES as readonly string[]).includes(cookie.name)) {
          collected.push(cookie);
        }
      }
    } catch {
      // ignore per-host failures
    }
  }
  return collected;
}

/**
 * Whether the embed (or default) session already has a non-expired sto-policy auth cookie.
 * Prefers stoToken, falls back to Authorization; JWT exp is checked when present.
 */
export async function hasStoPolicyAuthInEmbedSession(): Promise<boolean> {
  const embedSession = session.fromPartition(SCLAW_EMBED_BROWSER_PARTITION);
  const embedCookies = await collectStoPolicyAuthCookies(embedSession);
  if (hasValidStoPolicyAuthCookie(embedCookies)) return true;

  // Cookies may still only live on defaultSession before the next prepareSession sync.
  const defaultCookies = await collectStoPolicyAuthCookies(session.defaultSession);
  return hasValidStoPolicyAuthCookie(defaultCookies);
}

function teambitionCookieHosts(): string[] {
  return ['www.teambition.com', 'teambition.com'];
}

async function collectTeambitionAuthCookies(targetSession: Electron.Session): Promise<Cookie[]> {
  const collected: Cookie[] = [];
  for (const host of teambitionCookieHosts()) {
    try {
      const cookies = await targetSession.cookies.get({ url: `https://${host}/` });
      for (const cookie of cookies) {
        if ((TEAMBITION_AUTH_COOKIE_NAMES as readonly string[]).includes(cookie.name)) {
          collected.push(cookie);
        }
      }
    } catch {
      // ignore per-host failures
    }
  }
  return collected;
}

/**
 * Whether the embed (or default) session already has a non-expired Teambition session cookie.
 * Uses TEAMBITION_SESSIONID; cookie expirationDate / JWT exp are checked when present.
 */
export async function hasTeambitionAuthInEmbedSession(): Promise<boolean> {
  const embedSession = session.fromPartition(SCLAW_EMBED_BROWSER_PARTITION);
  const embedCookies = await collectTeambitionAuthCookies(embedSession);
  if (hasValidTeambitionAuthCookie(embedCookies)) return true;

  const defaultCookies = await collectTeambitionAuthCookies(session.defaultSession);
  return hasValidTeambitionAuthCookie(defaultCookies);
}
