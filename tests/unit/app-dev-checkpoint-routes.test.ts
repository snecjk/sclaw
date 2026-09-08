/**
 * T04 app-dev checkpoint 路由测试（mock service 层，参照 app-plaza-routes.test.ts）：
 * - POST /api/app-dev/checkpoints 响应扩展 {created, status, hash, subject}（向后兼容）
 * - GET  /api/app-dev/checkpoints/diff 返回逐文件差异
 * - POST /api/app-dev/checkpoints/restore 透传任意 hash
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostApiContext } from '@electron/api/context';

const mocks = vi.hoisted(() => ({
  createCheckpointDetailed: vi.fn(),
  diffCheckpoint: vi.fn(),
  restoreCheckpoint: vi.fn(),
  getWorkspaceRootPath: vi.fn(),
  sendJson: vi.fn(),
}));

vi.mock('@electron/services/app-dev-service', () => ({
  DEFAULT_APPS_PARENT_DIR: '/tmp/apps',
  createCheckpointDetailed: (...args: unknown[]) => mocks.createCheckpointDetailed(...args),
  diffCheckpoint: (...args: unknown[]) => mocks.diffCheckpoint(...args),
  restoreCheckpoint: (...args: unknown[]) => mocks.restoreCheckpoint(...args),
  createUserApp: vi.fn(),
  cloneDevApp: vi.fn(),
  importUserApp: vi.fn(),
  ensureAppDevContext: vi.fn(),
  getAppDevStatus: vi.fn(),
  isGitAvailable: vi.fn(async () => true),
  listAppRoutes: vi.fn(async () => []),
  listAppSourceFiles: vi.fn(async () => []),
  listCheckpoints: vi.fn(async () => []),
  listDevAppWorkspaceIds: vi.fn(async () => []),
  listDevApps: vi.fn(async () => []),
  resolveCloudAppForWorkspace: vi.fn(),
  readAppSourceFile: vi.fn(),
  restartApp: vi.fn(),
  runSetupPipeline: vi.fn(),
  searchAppSourceFiles: vi.fn(async () => []),
  stopApp: vi.fn(),
  writeAppSourceFile: vi.fn(),
  installNpmPackage: vi.fn(),
  installPipPackage: vi.fn(),
  listAppDevAssistSkills: vi.fn(async () => []),
  installAppDevAssistSkill: vi.fn(),
  listAppDevPackageCatalog: vi.fn(async () => []),
  deleteDevApp: vi.fn(),
}));
vi.mock('@electron/services/session-catalog-service', () => ({
  getWorkspaceRootPath: (...args: unknown[]) => mocks.getWorkspaceRootPath(...args),
}));
vi.mock('@electron/api/route-utils', () => ({
  sendJson: (...args: unknown[]) => mocks.sendJson(...args),
  parseJsonBody: async (req: IncomingMessage) =>
    (req as unknown as { __body?: unknown }).__body ?? {},
}));
vi.mock('@electron/api/routes/app-dev-sso-auth', () => ({
  handleAppDevSsoAuthRoute: async () => false,
}));

import { handleAppDevRoutes } from '@electron/api/routes/app-dev';

const ctx = {} as HostApiContext;
const res = {} as ServerResponse;

function jsonRequest(method: string, body?: unknown): IncomingMessage {
  return { method, __body: body } as unknown as IncomingMessage;
}

function lastSendJson(): { status: number; payload: Record<string, unknown> } {
  const call = mocks.sendJson.mock.calls.at(-1);
  return { status: call?.[1] as number, payload: call?.[2] as Record<string, unknown> };
}

describe('app-dev checkpoint routes（T04）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWorkspaceRootPath.mockResolvedValue('/tmp/app');
  });

  it('POST /checkpoints：响应携带 hash/subject/status，created 语义不变', async () => {
    mocks.createCheckpointDetailed.mockResolvedValue({ status: 'created', hash: 'abc123hash' });

    const handled = await handleAppDevRoutes(
      jsonRequest('POST', { workspaceId: 'ws-1', message: '对话修改 · 把标题改蓝' }),
      res,
      new URL('http://localhost/api/app-dev/checkpoints'),
      ctx,
    );

    expect(handled).toBe(true);
    expect(mocks.createCheckpointDetailed).toHaveBeenCalledWith('/tmp/app', '对话修改 · 把标题改蓝');
    const { status, payload } = lastSendJson();
    expect(status).toBe(200);
    expect(payload).toEqual({
      success: true,
      created: true,
      status: 'created',
      hash: 'abc123hash',
      subject: '对话修改 · 把标题改蓝',
    });
  });

  it('POST /checkpoints：clean-head 时 created=false 且 hash 为当前 HEAD', async () => {
    mocks.createCheckpointDetailed.mockResolvedValue({ status: 'clean-head', hash: 'head-hash' });

    await handleAppDevRoutes(
      jsonRequest('POST', { workspaceId: 'ws-1' }),
      res,
      new URL('http://localhost/api/app-dev/checkpoints'),
      ctx,
    );

    const { payload } = lastSendJson();
    expect(payload.created).toBe(false);
    expect(payload.status).toBe('clean-head');
    expect(payload.hash).toBe('head-hash');
    // 缺省 message 保持旧行为
    expect(mocks.createCheckpointDetailed).toHaveBeenCalledWith('/tmp/app', '应用更新');
  });

  it('GET /checkpoints/diff：透传 workspaceId+hash 并返回 diff', async () => {
    const diff = {
      hash: 'abc123',
      parentHash: 'def456',
      subject: '对话修改 · v2',
      files: [{ path: 'a.txt', status: 'M', added: 2, removed: 1, original: 'x', modified: 'y' }],
    };
    mocks.diffCheckpoint.mockResolvedValue(diff);

    const handled = await handleAppDevRoutes(
      jsonRequest('GET'),
      res,
      new URL('http://localhost/api/app-dev/checkpoints/diff?workspaceId=ws-1&hash=abc123'),
      ctx,
    );

    expect(handled).toBe(true);
    expect(mocks.diffCheckpoint).toHaveBeenCalledWith('/tmp/app', 'abc123');
    const { status, payload } = lastSendJson();
    expect(status).toBe(200);
    expect(payload).toEqual({ success: true, diff });
  });

  it('GET /checkpoints/diff：service 返回 null 时 success=false', async () => {
    mocks.diffCheckpoint.mockResolvedValue(null);

    await handleAppDevRoutes(
      jsonRequest('GET'),
      res,
      new URL('http://localhost/api/app-dev/checkpoints/diff?workspaceId=ws-1&hash=bad'),
      ctx,
    );

    const { payload } = lastSendJson();
    expect(payload.success).toBe(false);
    expect(typeof payload.error).toBe('string');
  });

  it('POST /checkpoints/restore：透传任意 hash 并回传 backupRef', async () => {
    mocks.restoreCheckpoint.mockResolvedValue({ restored: true, backupRef: 'sclaw-backup-1' });

    const handled = await handleAppDevRoutes(
      jsonRequest('POST', { workspaceId: 'ws-1', hash: 'abc123' }),
      res,
      new URL('http://localhost/api/app-dev/checkpoints/restore'),
      ctx,
    );

    expect(handled).toBe(true);
    expect(mocks.restoreCheckpoint).toHaveBeenCalledWith('/tmp/app', 'abc123');
    const { payload } = lastSendJson();
    expect(payload).toEqual({ success: true, restored: true, backupRef: 'sclaw-backup-1' });
  });
});
