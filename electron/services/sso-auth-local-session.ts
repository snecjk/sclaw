import { randomBytes as nodeRandomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { join } from 'path';

const SESSION_TTL_MS = 12 * 60 * 60 * 1_000;

export interface SsoAuthLocalSession {
  workspaceId: string;
  appPath: string;
  applicationId: string;
  pageType: 'site' | 'assets';
  secret: string;
  expiresAt: number;
}

export interface SsoAuthLocalPublicConfig {
  protocolVersion: 'sto-sso-auth/v1';
  applicationId: string;
  pageType: 'site' | 'assets';
  runtimeMode: 'local';
  deployEnv: 'daily';
}

export function buildSsoAuthLocalServerEnvironment(
  session: SsoAuthLocalSession,
  hostApiPort: number,
): Record<string, string> {
  return {
    STO_SSO_AUTH_SESSION: session.secret,
    STO_SSO_AUTH_WORKSPACE_ID: session.workspaceId,
    STO_SSO_AUTH_APPLICATION_ID: session.applicationId,
    STO_SSO_AUTH_PAGE_TYPE: session.pageType,
    STO_SSO_AUTH_DEPLOY_ENV: 'daily',
    STO_SSO_AUTH_HOST_API: `http://127.0.0.1:${hostApiPort}`,
  };
}

type SessionStoreDependencies = {
  randomBytes?: (size: number) => Buffer;
  now?: () => number;
};

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function secretsEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer);
}

export class SsoAuthLocalSessionStore {
  private readonly sessions = new Map<string, SsoAuthLocalSession>();
  private readonly randomBytes: (size: number) => Buffer;
  private readonly now: () => number;

  constructor(dependencies: SessionStoreDependencies = {}) {
    this.randomBytes = dependencies.randomBytes ?? nodeRandomBytes;
    this.now = dependencies.now ?? Date.now;
  }

  async create(input: {
    workspaceId: string;
    appPath: string;
    isCurrent?: () => boolean;
  }): Promise<SsoAuthLocalSession> {
    const workspaceId = input.workspaceId.trim();
    const appPath = resolve(input.appPath);
    if (!workspaceId || !appPath) throw new Error('缺少本地 SSO Session 工作区信息');

    const marker = await readJson(join(appPath, '.sclaw', 'app-dev.json'));
    const pageType = marker?.pageType === 'assets' ? 'assets' : 'site';
    const workspace = await readJson(join(appPath, '.sto', 'workspace.json'));
    const applicationId = (
      typeof workspace?.appCode === 'string' && workspace.appCode.trim()
        ? workspace.appCode.trim()
        : typeof workspace?.applicationId === 'string' && workspace.applicationId.trim()
          ? workspace.applicationId.trim()
          : `local:${workspaceId}`
    );
    const session: SsoAuthLocalSession = {
      workspaceId,
      appPath,
      applicationId,
      pageType,
      secret: this.randomBytes(32).toString('base64url'),
      expiresAt: this.now() + SESSION_TTL_MS,
    };
    if (input.isCurrent && !input.isCurrent()) {
      throw new Error('本地 SSO Session 创建已取消');
    }
    this.sessions.set(workspaceId, session);
    return session;
  }

  validate(input: {
    workspaceId: string;
    secret: string;
    appPath?: string;
  }): SsoAuthLocalSession | null {
    const session = this.sessions.get(input.workspaceId);
    if (!session) return null;
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(input.workspaceId);
      return null;
    }
    if (input.appPath && session.appPath !== resolve(input.appPath)) return null;
    if (!secretsEqual(session.secret, input.secret)) return null;
    return session;
  }

  destroy(workspaceId: string, expectedSecret?: string): void {
    if (expectedSecret) {
      const session = this.sessions.get(workspaceId);
      if (!session || !secretsEqual(session.secret, expectedSecret)) return;
    }
    this.sessions.delete(workspaceId);
  }

  destroyAll(): void {
    this.sessions.clear();
  }

  publicConfig(session: SsoAuthLocalSession): SsoAuthLocalPublicConfig {
    return {
      protocolVersion: 'sto-sso-auth/v1',
      applicationId: session.applicationId,
      pageType: session.pageType,
      runtimeMode: 'local',
      deployEnv: 'daily',
    };
  }
}

const defaultStore = new SsoAuthLocalSessionStore();

export function createSsoAuthLocalSession(input: {
  workspaceId: string;
  appPath: string;
  isCurrent?: () => boolean;
}): Promise<SsoAuthLocalSession> {
  return defaultStore.create(input);
}

export function validateSsoAuthLocalSession(input: {
  workspaceId: string;
  secret: string;
  appPath?: string;
}): SsoAuthLocalSession | null {
  return defaultStore.validate(input);
}

export function destroySsoAuthLocalSession(workspaceId: string, expectedSecret?: string): void {
  defaultStore.destroy(workspaceId, expectedSecret);
}

export function destroyAllSsoAuthLocalSessions(): void {
  defaultStore.destroyAll();
}
