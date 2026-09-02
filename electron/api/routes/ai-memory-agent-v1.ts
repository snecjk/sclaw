/**
 * AI Memory Agent V1 通用透传代理
 *
 * 前端直接写完整路径 /ai-memory/agent/v1/xxx，
 * Electron 将请求透传至 Python 后端（memory-center）。
 * 后续新增 /ai-memory/agent/v1 下的接口无需再改 Node 层。
 *
 * 路径映射：/ai-memory/agent/v1/{rest} → {sto_base_url}/agent/v1/{rest}
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { sendJson } from '../route-utils';
import { getStoToken } from '../../utils/auth-store';
import { buildStoMemoryCenterAuthHeaders } from '../../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../../utils/sto-domain';
import { logger } from '../../utils/logger';

function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function handleAiMemoryAgentV1Routes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (!url.pathname.startsWith('/ai-memory/agent/v1')) return false;

  const backendPath = url.pathname.replace('/ai-memory/agent/v1', '/agent/v1');

  try {
    const token = await getStoToken();
    if (!token) throw new Error('未登录或 stoToken 已过期，请重新登录');

    const baseUrl = await resolveStoBaseUrl();
    const targetUrl = `${baseUrl}${backendPath}${url.search}`;
    const headers: Record<string, string> = {
      ...buildStoMemoryCenterAuthHeaders(token),
      // 写死 application/json：该代理仅转发 /ai-memory/agent/v1 下的 JSON 接口，
      // 不信任上游（net.fetch 对字符串 body 会默认塞 text/plain）传入的 content-type，
      // 否则后端 FastAPI 不按 JSON 解析 body → Pydantic 422。
      'Content-Type': 'application/json',
    };

    const rawBody = await readRawBody(req);
    logger.debug(`[AiMemoryAgentV1Proxy] >>> ${req.method} ${targetUrl}`);

    const backendRes = await fetch(targetUrl, {
      method: req.method || 'GET',
      headers,
      body: rawBody.length > 0 ? rawBody : undefined,
    });

    const text = await backendRes.text();
    logger.debug(`[AiMemoryAgentV1Proxy] <<< ${req.method} ${targetUrl} status=${backendRes.status} bytes=${text.length}`);

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = { error: text };
    }
    sendJson(res, backendRes.status, json);
  } catch (error) {
    const message = String(error);
    logger.warn(`[AiMemoryAgentV1Proxy] <<< ${req.method} ${url.pathname} error=${message}`);
    if (message.includes('401') || message.includes('未登录')) {
      sendJson(res, 401, { success: false, error: message });
    } else {
      sendJson(res, 500, { success: false, error: message });
    }
  }
  return true;
}
