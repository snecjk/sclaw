/**
 * Browser Automation loopback HTTP API 鉴权（计划 §四 C1 / P0-3）。
 *
 * 两道闸：
 *  ① Host 头白名单（防 DNS rebinding）：浏览器内恶意页面可 fetch 127.0.0.1:3210，
 *    但 attacker.com 解析到 127.0.0.1 时 Host=attacker.com，被白名单拦截。
 *  ② Authorization: Bearer <token>，与 C3 落盘分发的 token 做 timingSafeEqual 比对。
 *
 * 灰度策略：token 未配置（读取/创建失败）时放行但打 warn 日志；配置后强制 401。
 * 写法参照同目录 internal-request-auth.ts 的 timingSafeEqual 先例。
 */
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { logger } from '../utils/logger';
import { getOrCreateBrowserAutomationToken } from '../utils/openclaw-auth';

/** 仅允许回环 Host（端口可选）：127.0.0.1 / localhost / [::1]。 */
const HOST_HEADER_ALLOWLIST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

export interface BrowserAutomationAuthFailure {
  statusCode: 401 | 403;
  code: 'UNAUTHORIZED' | 'HOST_MISMATCH';
  message: string;
}

/** Host 头白名单校验；通过返回 null，否则返回 403 HOST_MISMATCH。 */
export function checkBrowserAutomationHost(req: IncomingMessage): BrowserAutomationAuthFailure | null {
  const host = req.headers.host;
  if (typeof host === 'string' && HOST_HEADER_ALLOWLIST.test(host.trim())) {
    return null;
  }
  return {
    statusCode: 403,
    code: 'HOST_MISMATCH',
    message: `Host header is not allowed: ${host ?? '(missing)'}`,
  };
}

function readBearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/.exec(value.trim());
  const token = match?.[1]?.trim();
  return token ? token : null;
}

/**
 * Bearer token 校验；通过返回 null，否则返回 401 UNAUTHORIZED。
 * 灰度：token 未配置时放行 + warn（旧版插件无 token 的过渡期保护，计划 §六 R10）。
 */
export function checkBrowserAutomationAuthorization(req: IncomingMessage): BrowserAutomationAuthFailure | null {
  let expected: string;
  try {
    expected = getOrCreateBrowserAutomationToken();
  } catch (error) {
    logger.warn('[browser-automation] auth token unavailable; gray-mode allow (no Bearer check):', error);
    return null;
  }

  const provided = readBearerToken(req);
  // timingSafeEqual 要求等长 Buffer：长度不等即失败，但保持定长比较路径避免时序侧信道
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided ?? '');
  if (
    providedBytes.byteLength !== expectedBytes.byteLength
    || !timingSafeEqual(providedBytes, expectedBytes)
  ) {
    return {
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Missing or invalid bearer token',
    };
  }
  return null;
}

/** Host → Bearer 顺序校验（Host 更便宜且先挡 rebinding）。 */
export function checkBrowserAutomationHttpAuth(req: IncomingMessage): BrowserAutomationAuthFailure | null {
  return checkBrowserAutomationHost(req) ?? checkBrowserAutomationAuthorization(req);
}
