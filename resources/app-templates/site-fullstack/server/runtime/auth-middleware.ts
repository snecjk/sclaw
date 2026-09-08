import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { cookieName, getSessionUser } from '../auth/session.ts';
import type { AppDb } from './db.ts';

export type AuthVariables = {
  db: AppDb;
  user: { id: string; username: string; role: string } | null;
};

/** 注入 db + 当前用户；平台壳。 */
export function createAuthMiddleware(db: AppDb) {
  return async (c: Context<{ Variables: AuthVariables }>, next: Next) => {
    c.set('db', db);
    const sid = getCookie(c, cookieName());
    c.set('user', getSessionUser(db, sid));
    await next();
  };
}
