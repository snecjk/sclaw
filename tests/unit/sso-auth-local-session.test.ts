import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildSsoAuthLocalServerEnvironment,
  SsoAuthLocalSessionStore,
} from '../../electron/services/sso-auth-local-session';

const tempRoots: string[] = [];

async function createAppFiles(pageType: 'site' | 'assets', applicationId?: string) {
  const appPath = await mkdtemp(join(tmpdir(), 'sclaw-sso-session-'));
  tempRoots.push(appPath);
  await mkdir(join(appPath, '.sclaw'), { recursive: true });
  await writeFile(
    join(appPath, '.sclaw', 'app-dev.json'),
    JSON.stringify({ pageType }),
  );
  if (applicationId) {
    await mkdir(join(appPath, '.sto'), { recursive: true });
    await writeFile(join(appPath, '.sto', 'workspace.json'), JSON.stringify({
      version: 1,
      workspacePath: appPath,
      registryUrl: 'https://zc-hybrid-test.sto.cn',
      applicationId,
    }));
  }
  return appPath;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('SsoAuthLocalSessionStore', () => {
  it('creates a 32-byte secret and resolves the bound application identity', async () => {
    const appPath = await createAppFiles('site', 'app-1001');
    const store = new SsoAuthLocalSessionStore({
      randomBytes: () => Buffer.alloc(32, 7),
      now: () => 1_000,
    });

    const session = await store.create({ workspaceId: 'ws-1', appPath });

    expect(Buffer.from(session.secret, 'base64url')).toHaveLength(32);
    expect(session).toMatchObject({
      workspaceId: 'ws-1',
      appPath,
      applicationId: 'app-1001',
      pageType: 'site',
      expiresAt: 1_000 + 12 * 60 * 60 * 1_000,
    });
    expect(store.publicConfig(session)).toEqual({
      protocolVersion: 'sto-sso-auth/v1',
      applicationId: 'app-1001',
      pageType: 'site',
      runtimeMode: 'local',
      deployEnv: 'daily',
    });
    expect(JSON.stringify(store.publicConfig(session))).not.toContain(session.secret);
    expect(buildSsoAuthLocalServerEnvironment(session, 3210)).toEqual({
      STO_SSO_AUTH_SESSION: session.secret,
      STO_SSO_AUTH_WORKSPACE_ID: 'ws-1',
      STO_SSO_AUTH_APPLICATION_ID: 'app-1001',
      STO_SSO_AUTH_PAGE_TYPE: 'site',
      STO_SSO_AUTH_DEPLOY_ENV: 'daily',
      STO_SSO_AUTH_HOST_API: 'http://127.0.0.1:3210',
    });
  });

  it('replaces, validates, expires, and destroys sessions', async () => {
    let now = 5_000;
    let seed = 1;
    const appPath = await createAppFiles('site');
    const store = new SsoAuthLocalSessionStore({
      randomBytes: () => Buffer.alloc(32, seed++),
      now: () => now,
    });
    const first = await store.create({ workspaceId: 'ws-2', appPath });
    const second = await store.create({ workspaceId: 'ws-2', appPath });

    expect(store.validate({ workspaceId: 'ws-2', secret: first.secret })).toBeNull();
    expect(store.validate({ workspaceId: 'ws-other', secret: second.secret })).toBeNull();
    expect(store.validate({ workspaceId: 'ws-2', secret: 'wrong' })).toBeNull();
    expect(store.validate({ workspaceId: 'ws-2', secret: second.secret })).toEqual(second);
    expect(second.applicationId).toBe('local:ws-2');

    now = second.expiresAt + 1;
    expect(store.validate({ workspaceId: 'ws-2', secret: second.secret })).toBeNull();

    const third = await store.create({ workspaceId: 'ws-2', appPath });
    store.destroy('ws-2', 'wrong-secret');
    expect(store.validate({ workspaceId: 'ws-2', secret: third.secret })).toEqual(third);
    store.destroy('ws-2');
    expect(store.validate({ workspaceId: 'ws-2', secret: third.secret })).toBeNull();
  });

  it('keeps Assets page type so the route can reject it', async () => {
    const appPath = await createAppFiles('assets');
    const store = new SsoAuthLocalSessionStore();
    await expect(store.create({ workspaceId: 'ws-assets', appPath }))
      .resolves.toMatchObject({ pageType: 'assets' });
  });

  it('does not register a session when its start generation was canceled', async () => {
    const appPath = await createAppFiles('site');
    const store = new SsoAuthLocalSessionStore();

    await expect(store.create({
      workspaceId: 'ws-canceled',
      appPath,
      isCurrent: () => false,
    })).rejects.toThrow('创建已取消');

    expect(store.validate({ workspaceId: 'ws-canceled', secret: 'anything' })).toBeNull();
  });
});
