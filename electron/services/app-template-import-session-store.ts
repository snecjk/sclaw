import { rm } from 'node:fs/promises';

import type { PreparedTemplateImport } from './app-template-import-scanner';
import { createUlid } from '../utils/ulid';

const IMPORT_SESSION_TTL_MS = 10 * 60 * 1_000;

export interface AppTemplateImportSessionIdentity {
  templateRoot: string;
  templateId: string;
}

export interface AppTemplateImportSession {
  workspaceId: string;
  prepared: PreparedTemplateImport;
  expiresAtMs: number;
  identity?: AppTemplateImportSessionIdentity;
}

export interface AppTemplateImportSessionStoreOptions {
  now?: () => number;
  removeSnapshot?: (path: string) => Promise<void>;
}

export class AppTemplateImportSessionStore {
  private readonly sessions = new Map<string, AppTemplateImportSession>();
  private readonly expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly now: () => number;
  private readonly removeSnapshot: (path: string) => Promise<void>;

  constructor(options: AppTemplateImportSessionStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.removeSnapshot = options.removeSnapshot
      ?? ((path) => rm(path, { recursive: true, force: true }));
  }

  create(
    workspaceId: string,
    prepared: PreparedTemplateImport,
    identity?: AppTemplateImportSessionIdentity,
  ): {
    importToken: string;
    expiresAt: string;
  } {
    const importToken = createUlid();
    const expiresAtMs = this.now() + IMPORT_SESSION_TTL_MS;
    this.sessions.set(importToken, { workspaceId, prepared, expiresAtMs, identity });
    const timer = setTimeout(() => {
      const session = this.sessions.get(importToken);
      if (!session) return;
      this.sessions.delete(importToken);
      this.expiryTimers.delete(importToken);
      void this.removeSnapshot(session.prepared.snapshotRoot);
    }, IMPORT_SESSION_TTL_MS);
    timer.unref?.();
    this.expiryTimers.set(importToken, timer);
    return { importToken, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  take(importToken: string, workspaceId: string): AppTemplateImportSession {
    const session = this.requireSession(importToken);
    if (session.workspaceId !== workspaceId) {
      throw new Error('导入会话不属于当前模板');
    }
    if (session.expiresAtMs <= this.now()) {
      this.sessions.delete(importToken);
      this.clearExpiryTimer(importToken);
      void this.removeSnapshot(session.prepared.snapshotRoot);
      throw new Error('导入会话已过期，请重新扫描');
    }
    this.sessions.delete(importToken);
    this.clearExpiryTimer(importToken);
    return session;
  }

  getLockKey(importToken: string, workspaceId: string): string {
    const session = this.requireSession(importToken);
    if (session.workspaceId !== workspaceId) {
      throw new Error('导入会话不属于当前模板');
    }
    if (session.expiresAtMs <= this.now()) {
      this.sessions.delete(importToken);
      this.clearExpiryTimer(importToken);
      void this.removeSnapshot(session.prepared.snapshotRoot);
      throw new Error('导入会话已过期，请重新扫描');
    }
    return session.identity
      ? `${session.identity.templateRoot}\0${session.identity.templateId}`
      : `workspace:${workspaceId}`;
  }

  async cancel(importToken: string, workspaceId: string): Promise<boolean> {
    const session = this.sessions.get(importToken);
    if (!session) return false;
    if (session.workspaceId !== workspaceId) {
      throw new Error('导入会话不属于当前模板');
    }
    this.sessions.delete(importToken);
    this.clearExpiryTimer(importToken);
    await this.removeSnapshot(session.prepared.snapshotRoot);
    return session.expiresAtMs > this.now();
  }

  async dispose(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    for (const timer of this.expiryTimers.values()) clearTimeout(timer);
    this.expiryTimers.clear();
    await Promise.all(sessions.map((session) => this.removeSnapshot(session.prepared.snapshotRoot)));
  }

  private requireSession(importToken: string): AppTemplateImportSession {
    const session = this.sessions.get(importToken);
    if (!session) throw new Error('导入会话不存在或已使用');
    return session;
  }

  private clearExpiryTimer(importToken: string): void {
    const timer = this.expiryTimers.get(importToken);
    if (timer) clearTimeout(timer);
    this.expiryTimers.delete(importToken);
  }
}

export const defaultAppTemplateImportSessionStore = new AppTemplateImportSessionStore();
