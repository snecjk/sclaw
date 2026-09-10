import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import {
  cookieName,
  loginUser,
  logoutSession,
  registerUser,
} from '../auth/session.ts';
import type { AuthVariables } from '../runtime/auth-middleware.ts';

export const authRoutes = new Hono<{ Variables: AuthVariables }>();

authRoutes.post('/register', async (c) => {
  const db = c.get('db');
  const body = await c.req.json().catch(() => ({})) as { username?: string; password?: string };
  try {
    const user = await registerUser(db, {
      username: String(body.username ?? ''),
      password: String(body.password ?? ''),
    });
    return c.json({ success: true, user });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : '注册失败' }, 400);
  }
});

authRoutes.post('/login', async (c) => {
  const db = c.get('db');
  const body = await c.req.json().catch(() => ({})) as { username?: string; password?: string };
  try {
    const result = await loginUser(db, {
      username: String(body.username ?? ''),
      password: String(body.password ?? ''),
    });
    setCookie(c, cookieName(), result.sessionId, {
      httpOnly: true,
      path: '/',
      sameSite: 'Lax',
      expires: new Date(result.expiresAt),
    });
    return c.json({ success: true, user: result.user });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : '登录失败' }, 400);
  }
});

authRoutes.post('/logout', (c) => {
  const db = c.get('db');
  const sid = getCookie(c, cookieName());
  logoutSession(db, sid);
  deleteCookie(c, cookieName(), { path: '/' });
  return c.json({ success: true });
});

authRoutes.get('/me', (c) => {
  const user = c.get('user');
  if (!user) return c.json({ success: false, error: '未登录' }, 401);
  return c.json({ success: true, user });
});
