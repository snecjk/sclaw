import { session } from 'electron';
import { proxyAwareFetch } from './proxy-fetch';

const DWS_LOGIN_PARTITION = 'persist:dws-login';

function normalizeMediaId(mediaId: string): string {
  const trimmed = mediaId.trim();
  return trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
}

function buildAvatarCandidateUrls(mediaId: string): string[] {
  const id = normalizeMediaId(mediaId);
  if (!id) return [];
  return [
    `https://down.dingtalk.com/media/${id}_100_100.jpg`,
    `https://down.dingtalk.com/media/${id}_100_100.png`,
    `https://down.dingtalk.com/media/${id}_64_64.jpg`,
    `https://down.dingtalk.com/media/${id}.jpg`,
    `https://down.dingtalk.com/media/${id}.png`,
    `https://down.dingtalk.com/media/${id}`,
  ];
}

async function fetchAvatarFromUrl(url: string): Promise<{ body: Buffer; contentType: string } | null> {
  const requestInit: RequestInit = {
    method: 'GET',
    headers: {
      Referer: 'https://www.dingtalk.com/',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) DingTalk/7.0',
    },
  };

  const attempts: Array<() => Promise<Response>> = [
    () => session.fromPartition(DWS_LOGIN_PARTITION).fetch(url, requestInit),
    () => session.defaultSession.fetch(url, requestInit),
    () => proxyAwareFetch(url, { ...requestInit, timeoutMs: 8_000 }),
  ];

  for (const attempt of attempts) {
    try {
      const response = await attempt();
      if (!response.ok) continue;
      const contentType = response.headers.get('content-type') ?? 'image/jpeg';
      if (!contentType.startsWith('image/')) continue;
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > 0) {
        return { body, contentType };
      }
    } catch {
      // try next transport
    }
  }
  return null;
}

export async function fetchDingTalkAvatar(
  mediaId: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  const candidates = buildAvatarCandidateUrls(mediaId);
  for (const url of candidates) {
    const result = await fetchAvatarFromUrl(url);
    if (result) return result;
  }
  return null;
}

export function toAvatarProxyPath(mediaId: string | null | undefined): string | null {
  if (!mediaId?.trim()) return null;
  return `/api/dingtalk/avatar?mediaId=${encodeURIComponent(mediaId.trim())}`;
}
