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
import { logger } from '../../utils/logger';

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
  if (!isStoEmbedBrowserUrl(url)) return;

  const embedSession = session.fromPartition(SCLAW_EMBED_BROWSER_PARTITION);
  let copied = 0;

  for (const domain of SCLAW_EMBED_COOKIE_DOMAIN_SUFFIXES) {
    copied += await syncDomainCookies(session.defaultSession, embedSession, domain);
  }

  if (copied > 0) {
    logger.info(`[SclawEmbedBrowser] synced ${copied} cookie(s) into ${SCLAW_EMBED_BROWSER_PARTITION}`);
  }
}
