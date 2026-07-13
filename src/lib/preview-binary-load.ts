import { hostApiFetch } from '@/lib/host-api';
import { previewBridgeHttpFetch } from '@/lib/preview-bridge-fetch';
import { isHttpUrl } from '@/lib/preview-url';

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);
  return buffer;
}

/** Slice a Uint8Array to a standalone ArrayBuffer (avoids shared-buffer offset bugs). */
export function uint8ArrayToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Load a local or remote file as raw bytes for binary preview (Office, etc.). */
export async function loadPreviewBinary(filePath: string): Promise<Uint8Array> {
  if (isHttpUrl(filePath)) {
    const res = await previewBridgeHttpFetch({ url: filePath });
    if (!res.ok || !res.bodyBase64) {
      throw new Error(res.error || `HTTP ${res.status ?? 'error'}`);
    }
    return base64ToUint8Array(res.bodyBase64);
  }

  const readRes = await hostApiFetch<{ content: string; encoding: string }>('/api/files/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath, encoding: 'base64' }),
  });
  const base64 = readRes?.content;
  if (!base64) throw new Error('无法读取文件内容');
  return base64ToUint8Array(base64);
}
