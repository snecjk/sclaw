// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupInMemoryDb, type InMemoryDb } from './helpers';

const storeMocks = vi.hoisted(() => ({
  epoch: null as string | null,
  getSetting: vi.fn(async (key: string) => {
    if (key === 'channelBindEpoch') return storeMocks.epoch;
    return null;
  }),
  setSetting: vi.fn(async (key: string, value: unknown) => {
    if (key === 'channelBindEpoch') storeMocks.epoch = value as string | null;
  }),
}));

vi.mock('../../electron/utils/store', () => ({
  getSetting: storeMocks.getSetting,
  setSetting: storeMocks.setSetting,
}));

vi.mock('../../electron/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const runtimeMocks = vi.hoisted(() => ({
  weixinShutdown: vi.fn().mockResolvedValue(undefined),
  hubDisconnect: vi.fn(),
}));

vi.mock('../../electron/message-channel/weixin/service', () => ({
  getWeixinChannelService: () => ({
    shutdown: runtimeMocks.weixinShutdown,
  }),
}));

vi.mock('../../electron/message-channel/hub/hub-client', () => ({
  getSclawHubClient: () => ({
    disconnectPermanently: runtimeMocks.hubDisconnect,
  }),
}));

describe('channel runtime epoch reset', () => {
  let mem: InMemoryDb;
  let fixtureRoot: string;

  beforeEach(() => {
    mem = setupInMemoryDb();
    storeMocks.epoch = null;
    storeMocks.getSetting.mockClear();
    storeMocks.setSetting.mockClear();
    runtimeMocks.weixinShutdown.mockClear();
    runtimeMocks.hubDisconnect.mockClear();
    fixtureRoot = mkdtempSync(join(tmpdir(), 'channel-epoch-'));
  });

  afterEach(() => {
    mem.teardown();
    rmSync(fixtureRoot, { recursive: true, force: true });
    delete process.env.STOCLAW_WEIXIN_STATE_DIR;
    vi.resetModules();
  });

  async function seedBoundRows(): Promise<void> {
    const now = '2026-09-17T00:00:00.000Z';
    for (const row of [
      {
        id: 'dt-1',
        channel_type: 'dingtalk' as const,
        refresh_token: 'dt-tok',
        credential_token: null as string | null,
      },
      {
        id: 'wx-1',
        channel_type: 'wechat' as const,
        refresh_token: null as string | null,
        credential_token: 'wx-tok',
      },
      {
        id: 'mob-1',
        channel_type: 'sto-mobile' as const,
        refresh_token: 'mob-tok',
        credential_token: null as string | null,
      },
    ]) {
      await mem.kysely
        .insertInto('channel_connections')
        .values({
          id: row.id,
          channel_type: row.channel_type,
          account_id: row.channel_type === 'wechat' ? 'wx-bot' : 'default',
          enabled: 1,
          device_id: 'device-test',
          external_user_id: null,
          provider_account_id: null,
          bind_status: 'bound',
          bound_at: now,
          last_online_at: null,
          refresh_token: row.refresh_token,
          credential_token: row.credential_token,
          endpoint_base_url: null,
          engine_type: 'pi',
          agent_id: 'main',
          extras_json: null,
          created_at: now,
          updated_at: now,
        })
        .execute();
    }

    await mem.kysely
      .insertInto('catalog_sessions')
      .values({
        workspace_id: 'default',
        session_key: 'agent:main:channel:dingtalk:u1',
        group_id: null,
        title: 'old channel',
        pin_rank: null,
        sort_key: null,
        last_activity_at: now,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        version: 1,
        created_by: null,
        updated_by: null,
        session_type: 'channel',
        task_id: null,
        app_id: null,
        channel_type: 'dingtalk',
        channel_id: 'u1',
      })
      .execute();

    await mem.kysely
      .insertInto('catalog_sessions')
      .values({
        workspace_id: 'default',
        session_key: 'agent:main:main',
        group_id: null,
        title: 'main chat',
        pin_rank: null,
        sort_key: null,
        last_activity_at: now,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        version: 1,
        created_by: null,
        updated_by: null,
        session_type: 'chat',
        task_id: null,
        app_id: null,
        channel_type: null,
        channel_id: null,
      })
      .execute();
  }

  it('resets dirs, revokes rows, soft-deletes channel catalog when epoch unset', async () => {
    await seedBoundRows();
    const weixinDir = join(fixtureRoot, 'weixin');
    mkdirSync(weixinDir, { recursive: true });
    writeFileSync(join(weixinDir, 'accounts.json'), '{"accountIds":["x"]}');
    process.env.STOCLAW_WEIXIN_STATE_DIR = weixinDir;

    const { maybeResetChannelRuntimeEpoch, CHANNEL_BIND_EPOCH } = await import(
      '../../electron/message-channel/common/channel-runtime-epoch'
    );
    const result = await maybeResetChannelRuntimeEpoch();
    expect(result.reset).toBe(true);
    expect(storeMocks.setSetting).toHaveBeenCalledWith('channelBindEpoch', CHANNEL_BIND_EPOCH);
    expect(existsSync(weixinDir)).toBe(false);
    expect(runtimeMocks.weixinShutdown).toHaveBeenCalled();
    expect(runtimeMocks.hubDisconnect).toHaveBeenCalled();

    const rows = await mem.kysely.selectFrom('channel_connections').selectAll().execute();
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.bind_status).toBe('revoked');
      expect(row.enabled).toBe(0);
      expect(row.refresh_token).toBeNull();
      expect(row.credential_token).toBeNull();
    }

    const channelSession = await mem.kysely
      .selectFrom('catalog_sessions')
      .selectAll()
      .where('session_key', '=', 'agent:main:channel:dingtalk:u1')
      .executeTakeFirst();
    expect(channelSession?.deleted_at).toBeTruthy();

    const chatSession = await mem.kysely
      .selectFrom('catalog_sessions')
      .selectAll()
      .where('session_key', '=', 'agent:main:main')
      .executeTakeFirst();
    expect(chatSession?.deleted_at).toBeNull();
  });

  it('is idempotent when epoch already matches', async () => {
    const { CHANNEL_BIND_EPOCH, maybeResetChannelRuntimeEpoch } = await import(
      '../../electron/message-channel/common/channel-runtime-epoch'
    );
    storeMocks.epoch = CHANNEL_BIND_EPOCH;
    await seedBoundRows();
    const weixinDir = join(fixtureRoot, 'weixin-keep');
    mkdirSync(weixinDir, { recursive: true });
    writeFileSync(join(weixinDir, 'keep.txt'), '1');
    process.env.STOCLAW_WEIXIN_STATE_DIR = weixinDir;

    const result = await maybeResetChannelRuntimeEpoch();
    expect(result.reset).toBe(false);
    expect(existsSync(join(weixinDir, 'keep.txt'))).toBe(true);
    expect(runtimeMocks.weixinShutdown).not.toHaveBeenCalled();

    const dt = await mem.kysely
      .selectFrom('channel_connections')
      .selectAll()
      .where('id', '=', 'dt-1')
      .executeTakeFirst();
    expect(dt?.bind_status).toBe('bound');
    expect(dt?.refresh_token).toBe('dt-tok');
  });
});
