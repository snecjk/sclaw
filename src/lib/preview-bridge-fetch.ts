import { invokeIpc } from '@/lib/api-client';

export type PreviewBridgeHttpFetchResult = {
  ok?: boolean;
  status?: number;
  headers?: Record<string, string>;
  bodyBase64?: string;
  error?: string;
};

/** Proxy same-origin HTTP from preview iframe via Main (bypasses renderer CORS). */
export async function previewBridgeHttpFetch(params: {
  url: string;
  allowedOrigin: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<PreviewBridgeHttpFetchResult> {
  return invokeIpc<PreviewBridgeHttpFetchResult>('preview:httpFetch', params);
}
