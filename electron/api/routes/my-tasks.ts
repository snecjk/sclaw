/**
 * My-Tasks 通用透传代理
 *
 * 将前端 /api/my-tasks/* 请求原样转发至 Python 后端 /agent/v1/*，
 * 自动注入 stoToken 鉴权头。后续新增 /agent/v1 下的接口无需再改 Node 层。
 *
 * 路径映射规则：/api/my-tasks/{rest} → /agent/v1/{rest}
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { HostApiContext } from '../context';
import { sendJson } from '../route-utils';
import { getStoToken } from '../../utils/auth-store';
import { buildStoMemoryCenterAuthHeaders } from '../../utils/sto-memory-api-auth';
import { resolveStoBaseUrl } from '../../utils/sto-domain';
import { logger } from '../../utils/logger';

const PREFIX = '/api/my-tasks/';
const BACKEND_PREFIX = '/agent/v1/';


function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function handleMyTasksRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (!url.pathname.startsWith(PREFIX)) return false;

  const rest = url.pathname.slice(PREFIX.length);
  const backendPath = `${BACKEND_PREFIX}${rest}`;

  try {
    const token = await getStoToken();
    if (!token) throw new Error('未登录或 stoToken 已过期，请重新登录');

    const baseUrl = await resolveStoBaseUrl();
    const targetUrl = `${baseUrl}${backendPath}${url.search}`;
    const headers: Record<string, string> = {
      ...buildStoMemoryCenterAuthHeaders(token),
      'Content-Type': req.headers['content-type'] || 'application/json',
    };

    const rawBody = await readRawBody(req);
    logger.info(`[MyTasksProxy] >>> ${req.method} ${targetUrl}`);

    const backendRes = await fetch(targetUrl, {
      method: req.method || 'GET',
      headers,
      body: rawBody.length > 0 ? rawBody : undefined,
    });

    const text = await backendRes.text();
    logger.info(`[MyTasksProxy] <<< ${req.method} ${targetUrl} status=${backendRes.status}`);

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = { error: text };
    }
    sendJson(res, backendRes.status, json);
  } catch (error) {
    const message = String(error);
    if (message.includes('401') || message.includes('未登录')) {
      sendJson(res, 401, { success: false, error: message });
    } else {
      sendJson(res, 500, { success: false, error: message });
    }
  }
  return true;
}
