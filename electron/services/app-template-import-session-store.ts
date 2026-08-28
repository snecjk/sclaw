import { rm } from 'node:fs/promises';

import type { PreparedTemplateImport } from './app-template-import-scanner';
import { createUlid } from '../utils/ulid';

const IMPORT_SESSION_TTL_MS = 10 * 60 * 1_000;

interface ImportSession {
  workspaceId: string;
  prepared: PreparedTemplateImport;
  expiresAtMs: number;
}

export interface AppTemplateImportSessionStoreOptions {
  now?: () => number;
  removeSnapshot?: (path: string) => Promise<void>;
}

export class AppTemplateImportSessionStore {
  private readonly sessions = new Map<string, ImportSession>();
  private readonly now: () => number;
  private readonly removeSnapshot: (path: string) => Promise<void>;

  constructor(options: AppTemplateImportSessionStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.removeSnapshot = options.removeSnapshot
      ?? ((path) => rm(path, { recursive: true, force: true }));
  }

  create(workspaceId: string, prepared: PreparedTemplateImport): {
    importToken: string;
    expiresAt: string;
  } {
    const importToken = createUlid();
    const expiresAtMs = this.now() + IMPORT_SESSION_TTL_MS;
    this.sessions.set(importToken, { workspaceId, prepared, expiresAtMs });
    return { importToken, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  take(importToken: string, workspaceId: string): ImportSession {
    const session = this.requireSession(importToken);
    if (session.workspaceId !== workspaceId) {
      throw new Error('导入会话不属于当前模板');
    }
    if (session.expiresAtMs <= this.now()) {
      this.sessions.delete(importToken);
      void this.removeSnapshot(session.prepared.snapshotRoot);
      throw new Error('导入会话已过期，请重新扫描');
    }
    this.sessions.delete(importToken);
    return session;
  }

  async cancel(importToken: string, workspaceId: string): Promise<boolean> {
    const session = this.sessions.get(importToken);
    if (!session) return false;
    if (session.workspaceId !== workspaceId) {
      throw new Error('导入会话不属于当前模板');
    }
    this.sessions.delete(importToken);
    await this.removeSnapshot(session.prepared.snapshotRoot);
    return session.expiresAtMs > this.now();
  }

  async dispose(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(sessions.map((session) => this.removeSnapshot(session.prepared.snapshotRoot)));
  }

  private requireSession(importToken: string): ImportSession {
    const session = this.sessions.get(importToken);
    if (!session) throw new Error('导入会话不存在或已使用');
    return session;
  }
}

export const defaultAppTemplateImportSessionStore = new AppTemplateImportSessionStore();
