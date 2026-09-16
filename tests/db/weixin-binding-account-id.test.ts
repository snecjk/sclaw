// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupInMemoryDb, type InMemoryDb } from './helpers';

vi.mock('../../electron/message-channel/weixin/runtime/transport/migrate-credentials', () => ({
  migrateLegacyCredentials: vi.fn(),
}));

vi.mock('../../electron/message-channel/weixin/runtime/transport/account-store', () => ({
  listIndexedAccountIds: () => [],
  loadAccount: () => null,
  resolvePrimaryAccount: () => ({ accountId: 'wx-bot-1', token: 'tok' }),
  clearAccountFiles: vi.fn(),
  saveAccount: vi.fn(),
}));

vi.mock('../../electron/message-channel/weixin/runtime/transport/state-dir', () => ({
  resolveWeixinStateDir: () => '/tmp/weixin-test',
}));

vi.mock('../../electron/message-channel/hub/binding-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../electron/message-channel/hub/binding-service')>();
  return {
    ...actual,
    getLocalDeviceId: async () => 'device-test',
  };
});

describe('Weixin binding with real account_id', () => {
  let mem: InMemoryDb;

  beforeEach(() => {
    mem = setupInMemoryDb();
  });

  afterEach(() => {
    mem.teardown();
  });

  it('updates engine/agent without UNIQUE conflict when account_id is not default', async () => {
    const now = '2026-09-16T00:00:00.000Z';
    await mem.kysely
      .insertInto('channel_connections')
      .values({
        id: 'wechat-row-1',
        channel_type: 'wechat',
        account_id: 'wx-bot-1',
        enabled: 1,
        device_id: 'device-test',
        external_user_id: null,
        provider_account_id: 'wx-bot-1',
        bind_status: 'bound',
        bound_at: now,
        last_online_at: null,
        refresh_token: null,
        credential_token: 'tok',
        endpoint_base_url: null,
        engine_type: 'pi',
        agent_id: 'main',
        extras_json: null,
        created_at: now,
        updated_at: now,
      })
      .execute();

    const { updateWeixinBindingAgent } = await import(
      '../../electron/message-channel/weixin/binding'
    );

    const binding = await updateWeixinBindingAgent({
      engineType: 'claude',
      agentId: 'agent-2',
    });

    expect(binding).toMatchObject({
      channelType: 'wechat',
      accountId: 'wx-bot-1',
      engineType: 'claude',
      agentId: 'agent-2',
    });

    const rows = await mem.kysely
      .selectFrom('channel_connections')
      .selectAll()
      .where('channel_type', '=', 'wechat')
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      account_id: 'wx-bot-1',
      engine_type: 'claude',
      agent_id: 'agent-2',
    });
  });

  it('re-binds a new WeChat accountId by updating the existing single-bot row', async () => {
    const now = '2026-09-16T00:00:00.000Z';
    await mem.kysely
      .insertInto('channel_connections')
      .values({
        id: 'wechat-row-1',
        channel_type: 'wechat',
        account_id: 'wx-bot-old',
        enabled: 1,
        device_id: 'device-test',
        external_user_id: null,
        provider_account_id: 'wx-bot-old',
        bind_status: 'bound',
        bound_at: now,
        last_online_at: null,
        refresh_token: null,
        credential_token: 'old-tok',
        endpoint_base_url: null,
        engine_type: 'pi',
        agent_id: 'main',
        extras_json: null,
        created_at: now,
        updated_at: now,
      })
      .execute();

    const { upsertWeixinBinding } = await import(
      '../../electron/message-channel/weixin/binding'
    );

    const binding = await upsertWeixinBinding({
      accountId: 'wx-bot-new',
      token: 'new-tok',
      engineType: 'claude',
      agentId: 'main',
    });

    expect(binding.accountId).toBe('wx-bot-new');

    const rows = await mem.kysely
      .selectFrom('channel_connections')
      .selectAll()
      .where('channel_type', '=', 'wechat')
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'wechat-row-1',
      account_id: 'wx-bot-new',
      provider_account_id: 'wx-bot-new',
      engine_type: 'claude',
    });
  });
});
