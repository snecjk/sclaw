import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { todos } from '../../drizzle/schema.ts';
import { newId } from '../auth/session.ts';
import type { AuthVariables } from '../runtime/auth-middleware.ts';

export const todoRoutes = new Hono<{ Variables: AuthVariables }>();

todoRoutes.get('/', (c) => {
  const user = c.get('user');
  if (!user) return c.json({ success: false, error: '未登录' }, 401);
  const db = c.get('db');
  const items = db.select().from(todos).where(eq(todos.userId, user.id)).all();
  return c.json({ success: true, items });
});

todoRoutes.post('/', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ success: false, error: '未登录' }, 401);
  const db = c.get('db');
  const body = await c.req.json().catch(() => ({})) as { title?: string };
  const title = String(body.title ?? '').trim();
  if (!title) return c.json({ success: false, error: '标题不能为空' }, 400);
  const id = newId();
  db.insert(todos).values({
    id,
    userId: user.id,
    title,
    done: false,
    createdAt: Date.now(),
  }).run();
  return c.json({ success: true, item: { id, title, done: false } });
});

todoRoutes.patch('/:id', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ success: false, error: '未登录' }, 401);
  const db = c.get('db');
  const id = c.req.param('id');
  const existing = db.select().from(todos).where(eq(todos.id, id)).get();
  if (!existing || existing.userId !== user.id) {
    return c.json({ success: false, error: '不存在' }, 404);
  }
  const body = await c.req.json().catch(() => ({})) as { title?: string; done?: boolean };
  const title = body.title != null ? String(body.title).trim() : existing.title;
  const done = typeof body.done === 'boolean' ? body.done : existing.done;
  db.update(todos).set({ title, done }).where(eq(todos.id, id)).run();
  return c.json({ success: true, item: { id, title, done } });
});

todoRoutes.delete('/:id', (c) => {
  const user = c.get('user');
  if (!user) return c.json({ success: false, error: '未登录' }, 401);
  const db = c.get('db');
  const id = c.req.param('id');
  const existing = db.select().from(todos).where(eq(todos.id, id)).get();
  if (!existing || existing.userId !== user.id) {
    return c.json({ success: false, error: '不存在' }, 404);
  }
  db.delete(todos).where(eq(todos.id, id)).run();
  return c.json({ success: true });
});
