import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { sessions, users } from '../../drizzle/schema.ts';
import type { AppDb } from '../runtime/db.ts';

const SESSION_DAYS = 14;

export function newId(): string {
  return randomBytes(16).toString('hex');
}

export async function registerUser(
  db: AppDb,
  input: { username: string; password: string; role?: string },
): Promise<{ id: string; username: string; role: string }> {
  const username = input.username.trim();
  if (username.length < 2) throw new Error('用户名太短');
  if (input.password.length < 6) throw new Error('密码至少 6 位');
  const id = newId();
  const passwordHash = await bcrypt.hash(input.password, 10);
  const role = input.role === 'admin' ? 'admin' : 'user';
  try {
    db.insert(users).values({
      id,
      username,
      passwordHash,
      role,
      createdAt: Date.now(),
    }).run();
  } catch {
    throw new Error('用户名已存在');
  }
  return { id, username, role };
}

export async function loginUser(
  db: AppDb,
  input: { username: string; password: string },
): Promise<{ user: { id: string; username: string; role: string }; sessionId: string; expiresAt: number }> {
  const row = db.select().from(users).where(eq(users.username, input.username.trim())).get();
  if (!row) throw new Error('用户名或密码错误');
  const ok = await bcrypt.compare(input.password, row.passwordHash);
  if (!ok) throw new Error('用户名或密码错误');
  const sessionId = newId();
  const expiresAt = Date.now() + SESSION_DAYS * 86_400_000;
  db.insert(sessions).values({
    id: sessionId,
    userId: row.id,
    expiresAt,
  }).run();
  return {
    user: { id: row.id, username: row.username, role: row.role },
    sessionId,
    expiresAt,
  };
}

export function logoutSession(db: AppDb, sessionId: string | undefined): void {
  if (!sessionId) return;
  db.delete(sessions).where(eq(sessions.id, sessionId)).run();
}

export function getSessionUser(
  db: AppDb,
  sessionId: string | undefined,
): { id: string; username: string; role: string } | null {
  if (!sessionId) return null;
  const session = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (!session || session.expiresAt < Date.now()) {
    if (session) db.delete(sessions).where(eq(sessions.id, session.id)).run();
    return null;
  }
  const user = db.select().from(users).where(eq(users.id, session.userId)).get();
  if (!user) return null;
  return { id: user.id, username: user.username, role: user.role };
}

export function cookieName(): string {
  const secret = process.env.SESSION_SECRET || 'dev-insecure';
  return `sclaw_sid_${createHash('sha1').update(secret).digest('hex').slice(0, 6)}`;
}
