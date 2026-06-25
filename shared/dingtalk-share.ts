/**
 * DingTalk share helpers (PC client employee picker).
 * @see https://developers.dingtalk.com/document/isvapp/applink-select-employee-to-send-message
 * @see https://developers.dingtalk.com/document/development/structure-of-applink
 */

export const DINGTALK_SHARE_APPLINK_PATH = '/page/open_user_select';
export const DINGTALK_SHARE_APPLINK_HOST = 'https://applink.dingtalk.com';
/** Deep link mapped from AppLink path — opens DingTalk directly without browser. */
export const DINGTALK_SHARE_DEEPLINK_ORIGIN = 'dingtalk://dingtalkclient';

/** Windows shell.openExternal URL length limit (Electron). */
export const DINGTALK_SHARE_MAX_URL_LENGTH = 2080;

export type DingTalkShareContent = {
  /** Plain text body. */
  text?: string;
  /** HTTP(S) link to share. */
  url?: string;
  /** HTTP(S) image URLs (AppLink only embeds links in defaultMsg). */
  imageUrls?: string[];
  /** DingTalk picker window title. */
  title?: string;
};

export type DingTalkShareBuildResult = {
  /** Preferred open URL (`dingtalk://` — skips browser confirmation). */
  url: string;
  /** HTTPS AppLink fallback (may open browser intermediate page). */
  appLinkUrl: string;
  defaultMsg: string;
  wndCaption: string;
  truncated: boolean;
  warnings: string[];
};

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeImageUrls(imageUrls: string[] | undefined): { urls: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const urls: string[] = [];
  for (const raw of imageUrls ?? []) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (isHttpUrl(trimmed)) {
      urls.push(trimmed);
      continue;
    }
    warnings.push(`已忽略非 HTTP(S) 图片地址：${trimmed}`);
  }
  return { urls, warnings };
}

function formatImageLine(url: string, index: number): string {
  const label = index > 0 ? `图片 ${index + 1}` : '图片';
  return `[${label}](${url})`;
}

/**
 * Compose defaultMsg for DingTalk picker from text / url / images.
 */
export function buildDingTalkShareDefaultMsg(content: DingTalkShareContent): {
  defaultMsg: string;
  warnings: string[];
} {
  const warnings: string[] = [];
  const text = trimOptional(content.text);
  const url = trimOptional(content.url);
  const { urls: imageUrls, warnings: imageWarnings } = normalizeImageUrls(content.imageUrls);
  warnings.push(...imageWarnings);

  if (url && !isHttpUrl(url)) {
    warnings.push(`链接不是有效的 HTTP(S) URL，已作为纯文本附带：${url}`);
  }

  const parts: string[] = [];
  if (text) parts.push(text);

  if (url) {
    if (isHttpUrl(url)) {
      parts.push(`[链接](${url})`);
    } else {
      parts.push(url);
    }
  }

  for (let i = 0; i < imageUrls.length; i += 1) {
    parts.push(formatImageLine(imageUrls[i]!, i));
  }

  const defaultMsg = parts.join('\n\n').trim();
  if (!defaultMsg) {
    throw new Error('分享内容为空：请提供 text、url 或 imageUrls 至少一项');
  }

  return { defaultMsg, warnings };
}

function buildShareQuery(wndCaption: string, defaultMsg: string): string {
  const urlParam = encodeURIComponent(JSON.stringify({ sengMsgScene: true, defaultMsg }));
  return `wnd_caption=${encodeURIComponent(wndCaption)}&url_param=${urlParam}`;
}

function buildShareUrlPair(wndCaption: string, defaultMsg: string): { deepLink: string; appLink: string } {
  const query = buildShareQuery(wndCaption, defaultMsg);
  return {
    deepLink: `${DINGTALK_SHARE_DEEPLINK_ORIGIN}/page/open_user_select?${query}`,
    appLink: `${DINGTALK_SHARE_APPLINK_HOST}${DINGTALK_SHARE_APPLINK_PATH}?${query}`,
  };
}

function truncateDefaultMsgForUrl(
  defaultMsg: string,
  wndCaption: string,
  maxUrlLength: number,
): { defaultMsg: string; truncated: boolean } {
  const buildOpenUrl = (msg: string) => buildShareUrlPair(wndCaption, msg).deepLink;

  if (buildOpenUrl(defaultMsg).length <= maxUrlLength) {
    return { defaultMsg, truncated: false };
  }

  let low = 0;
  let high = defaultMsg.length;
  let best = '';
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = `${defaultMsg.slice(0, mid).trimEnd()}\n\n…（内容已截断）`;
    if (buildOpenUrl(candidate).length <= maxUrlLength) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (!best) {
    throw new Error('分享内容过长，无法生成钉钉分享链接');
  }

  return { defaultMsg: best, truncated: true };
}

/**
 * Build DingTalk share URLs. `url` is the deep link (desktop preferred); `appLinkUrl` is HTTPS fallback.
 */
export function buildDingTalkShareAppLinkUrl(
  content: DingTalkShareContent,
  options?: { maxUrlLength?: number },
): DingTalkShareBuildResult {
  const wndCaption = trimOptional(content.title) ?? '分享';
  const { defaultMsg: rawMsg, warnings } = buildDingTalkShareDefaultMsg(content);
  const maxUrlLength = options?.maxUrlLength ?? DINGTALK_SHARE_MAX_URL_LENGTH;
  const { defaultMsg, truncated } = truncateDefaultMsgForUrl(rawMsg, wndCaption, maxUrlLength);
  if (truncated) {
    warnings.push('分享正文过长，已自动截断以适配系统 URL 长度限制');
  }

  const { deepLink, appLink } = buildShareUrlPair(wndCaption, defaultMsg);

  return {
    url: deepLink,
    appLinkUrl: appLink,
    defaultMsg,
    wndCaption,
    truncated,
    warnings,
  };
}

export function assertDingTalkShareOpenUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('无效的钉钉分享链接');
  }

  const isAppLink =
    parsed.protocol === 'https:'
    && parsed.host === 'applink.dingtalk.com'
    && parsed.pathname.endsWith(DINGTALK_SHARE_APPLINK_PATH);
  const isDeepLink =
    parsed.protocol === 'dingtalk:'
    && parsed.host === 'dingtalkclient'
    && parsed.pathname.endsWith('/page/open_user_select');

  if (!isAppLink && !isDeepLink) {
    throw new Error('仅允许打开钉钉官方分享链接');
  }
}

/** @deprecated Use assertDingTalkShareOpenUrl */
export function assertDingTalkShareAppLinkUrl(url: string): void {
  assertDingTalkShareOpenUrl(url);
}
