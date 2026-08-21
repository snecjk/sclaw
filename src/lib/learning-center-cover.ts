import { invokeIpc } from '@/lib/api-client';

type RemoteFetchResult = {
  ok?: boolean;
  status?: number;
  headers?: Record<string, string>;
  bodyBase64?: string;
};

function header(headers: Record<string, string> | undefined, name: string): string {
  if (!headers) return '';
  const needle = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === needle) return value;
  }
  return '';
}

/**
 * Aliyun OSS default and acceleration domains can force browser downloads by
 * returning `Content-Disposition: attachment`. Fetch these covers in the main
 * process instead of assigning the URL directly to an <img> element.
 */
export function requiresLearningCoverHostFetch(url: string): boolean {
  try {
    const hostname = new URL(url.trim()).hostname.toLowerCase();
    return hostname.endsWith('.aliyuncs.com')
      && (hostname.includes('.oss-') || hostname.includes('.oss.'));
  } catch {
    return false;
  }
}

export async function resolveLearningCoverSrc(url: string): Promise<string> {
  const trimmed = url.trim();
  if (!trimmed) return '';
  try {
    const result = await invokeIpc<RemoteFetchResult>('preview:httpFetch', { url: trimmed });
    if (!result?.ok || result.status !== 200 || !result.bodyBase64) return trimmed;
    const rawType = header(result.headers, 'content-type').split(';')[0]?.trim().toLowerCase() ?? '';
    const contentType = rawType.startsWith('image/') ? rawType : 'image/jpeg';
    return `data:${contentType};base64,${result.bodyBase64}`;
  } catch {
    return trimmed;
  }
}
