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
