import type { IncomingMessage, ServerResponse } from 'http';

/**
 * 解析 JSON body。默认参数保持旧行为（41 个既有路由零影响，§六 R7）；
 * maxBytes 超限抛 { statusCode: 413, code: 'PAYLOAD_TOO_LARGE' }，timeoutMs 超时抛 408。
 */
export async function parseJsonBody<T>(
  req: IncomingMessage,
  opts?: { maxBytes?: number; timeoutMs?: number },
): Promise<T> {
  const maxBytes = opts?.maxBytes ?? Infinity;
  const chunks: Buffer[] = [];
  let received = 0;
  let timer: NodeJS.Timeout | null = null;
  try {
    const timeoutGuard = opts?.timeoutMs
      ? new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(Object.assign(new Error(`request body timed out after ${opts.timeoutMs}ms`), { statusCode: 408 }));
          }, opts.timeoutMs);
        })
      : null;
    const collect = (async () => {
      for await (const chunk of req) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        received += buf.byteLength;
        if (received > maxBytes) {
          throw Object.assign(new Error(`request body too large (>${maxBytes} bytes)`), {
            statusCode: 413,
            code: 'PAYLOAD_TOO_LARGE',
          });
        }
        chunks.push(buf);
      }
    })();
    if (timeoutGuard) {
      await Promise.race([collect, timeoutGuard]);
    } else {
      await collect;
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return {} as T;
  }
  return JSON.parse(raw) as T;
}

export function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  setCorsHeaders(res);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export function sendNoContent(res: ServerResponse): void {
  setCorsHeaders(res);
  res.statusCode = 204;
  res.end();
}

export function sendText(res: ServerResponse, statusCode: number, text: string): void {
  setCorsHeaders(res);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(text);
}
