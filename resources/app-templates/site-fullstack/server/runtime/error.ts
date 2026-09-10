import type { Context, Next } from 'hono';
import { logError } from './logger.ts';

/** 统一 JSON 错误；平台壳，业务路由勿改。 */
export async function errorMiddleware(c: Context, next: Next): Promise<Response | void> {
  try {
    await next();
  } catch (err) {
    logError('unhandled', err);
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return c.json({ success: false, error: message }, 500);
  }
}
