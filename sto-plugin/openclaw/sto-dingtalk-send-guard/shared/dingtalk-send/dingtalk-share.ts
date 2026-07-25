/**
 * Self-contained copy for Gateway extension install (~/.stoclaw/openclaw/extensions/...).
 * Keep in sync with repository root `shared/dingtalk-send/dingtalk-share.ts`.
 * Regenerate: `pnpm run sync:plugin-shared`
 */
export const DINGTALK_SHARE_APPLINK_PATH = '/page/open_user_select';
export const DINGTALK_SHARE_APPLINK_HOST = 'https://applink.dingtalk.com';
/** Deep link mapped from AppLink path — opens DingTalk directly without browser. */
export const DINGTALK_SHARE_DEEPLINK_ORIGIN = 'dingtalk://dingtalkclient';

/** Windows shell.openExternal URL length limit (Electron). Applies to share body character count. */
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
  const { textPart, suffixPart, warnings } = buildDingTalkShareMessageParts(content);
  const defaultMsg = composeDingTalkShareDefaultMsg(textPart, suffixPart, false);
  if (!defaultMsg) {
    throw new Error('分享内容为空：请提供 text、url 或 imageUrls 至少一项');
  }
  return { defaultMsg, warnings };
}

export function buildDingTalkShareMessageParts(content: DingTalkShareContent): {
  textPart: string;
  suffixPart: string;
  warnings: string[];
} {
  const warnings: string[] = [];
  const textPart = trimOptional(content.text) ?? '';
  const url = trimOptional(content.url);
  const { urls: imageUrls, warnings: imageWarnings } = normalizeImageUrls(content.imageUrls);
  warnings.push(...imageWarnings);

  if (url && !isHttpUrl(url)) {
    warnings.push(`链接不是有效的 HTTP(S) URL，已作为纯文本附带：${url}`);
  }

  const suffixLines: string[] = [];
  if (url) {
    suffixLines.push(isHttpUrl(url) ? `[链接](${url})` : url);
  }
  for (let i = 0; i < imageUrls.length; i += 1) {
    suffixLines.push(formatImageLine(imageUrls[i]!, i));
  }

  return {
    textPart,
    suffixPart: suffixLines.join('\n\n'),
    warnings,
  };
}

function composeDingTalkShareDefaultMsg(
  textPart: string,
  suffixPart: string,
  textTruncated: boolean,
): string {
  const parts: string[] = [];
  const trimmedText = textPart.trim();
  if (trimmedText) {
    parts.push(textTruncated ? `${trimmedText.trimEnd()}\n\n…（内容已截断）` : trimmedText);
  }
  const trimmedSuffix = suffixPart.trim();
  if (trimmedSuffix) parts.push(trimmedSuffix);
  return parts.join('\n\n').trim();
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
  textPart: string,
  suffixPart: string,
  wndCaption: string,
  maxUrlLength: number,
): { defaultMsg: string; truncated: boolean } {
  const buildOpenUrl = (msg: string) => buildShareUrlPair(wndCaption, msg).deepLink;

  const fullMsg = composeDingTalkShareDefaultMsg(textPart, suffixPart, false);
  if (buildOpenUrl(fullMsg).length <= maxUrlLength) {
    return { defaultMsg: fullMsg, truncated: false };
  }

  const suffixOnly = composeDingTalkShareDefaultMsg('', suffixPart, false);
  if (suffixOnly && buildOpenUrl(suffixOnly).length > maxUrlLength) {
    throw new Error('分享链接过长，无法生成钉钉分享链接');
  }

  if (!textPart.trim()) {
    return { defaultMsg: suffixOnly, truncated: false };
  }

  let low = 0;
  let high = textPart.length;
  let best = '';
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = composeDingTalkShareDefaultMsg(textPart.slice(0, mid), suffixPart, true);
    if (buildOpenUrl(candidate).length <= maxUrlLength) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (!best && suffixOnly) {
    return { defaultMsg: suffixOnly, truncated: true };
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
  const { textPart, suffixPart, warnings } = buildDingTalkShareMessageParts(content);
  const maxUrlLength = options?.maxUrlLength ?? DINGTALK_SHARE_MAX_URL_LENGTH;
  const fullMsg = composeDingTalkShareDefaultMsg(textPart, suffixPart, false);

  if (fullMsg.length <= maxUrlLength) {
    const { deepLink, appLink } = buildShareUrlPair(wndCaption, fullMsg);
    return {
      url: deepLink,
      appLinkUrl: appLink,
      defaultMsg: fullMsg,
      wndCaption,
      truncated: false,
      warnings,
    };
  }

  const { defaultMsg, truncated } = truncateDefaultMsgForUrl(
    textPart,
    suffixPart,
    wndCaption,
    maxUrlLength,
  );
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
