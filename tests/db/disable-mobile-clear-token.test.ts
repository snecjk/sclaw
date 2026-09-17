// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupInMemoryDb, type InMemoryDb } from './helpers';

vi.mock('../../electron/message-channel/hub/binding-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../electron/message-channel/hub/binding-service')>();
  return {
    ...actual,
    getLocalDeviceId: async () => 'device-test',
  };
});

describe('disableMobileAppBind clears refresh_token', () => {
  let mem: InMemoryDb;

  beforeEach(() => {
    mem = setupInMemoryDb();
  });

  afterEach(() => {
    mem.teardown();
  });

  it('sets revoked + enabled=0 + refresh_token null', async () => {
    const now = '2026-09-17T00:00:00.000Z';
    await mem.kysely
      .insertInto('channel_connections')
      .values({
        id: 'mobile-bound',
        channel_type: 'sto-mobile',
        account_id: 'default',
        enabled: 1,
        device_id: 'device-test',
        external_user_id: null,
        provider_account_id: null,
        bind_status: 'bound',
        bound_at: now,
        last_online_at: null,
        refresh_token: 'mob-tok',
        credential_token: null,
        endpoint_base_url: null,
        engine_type: 'pi',
        agent_id: 'main',
        extras_json: null,
        created_at: now,
        updated_at: now,
      })
      .execute();

    const {
      disableMobileAppBind,
      resolveSharedHubRefreshToken,
      getChannelConnection,
    } = await import('../../electron/message-channel/hub/binding-service');

    await disableMobileAppBind();
    const row = await getChannelConnection('mobile');
    expect(row?.bindStatus).toBe('revoked');
    expect(row?.enabled).toBe(false);
    expect(row?.refreshToken).toBeNull();
    expect(await resolveSharedHubRefreshToken()).toBeNull();
  });

  it('clears replaceReason while preserving other extras', async () => {
    const now = '2026-09-17T00:00:00.000Z';
    await mem.kysely
      .insertInto('channel_connections')
      .values({
        id: 'mobile-reason',
        channel_type: 'sto-mobile',
        account_id: 'default',
        enabled: 0,
        device_id: 'device-test',
        external_user_id: null,
        provider_account_id: null,
        bind_status: 'revoked',
        bound_at: now,
        last_online_at: null,
        refresh_token: null,
        credential_token: null,
        endpoint_base_url: null,
        engine_type: 'pi',
        agent_id: 'main',
        extras_json: JSON.stringify({
          replaceReason: 'other_device',
          preFixedBinding: { engineType: 'claude', agentId: 'old', at: now },
        }),
        created_at: now,
        updated_at: now,
      })
      .execute();

    const {
      disableMobileAppBind,
      getChannelConnection,
      setChannelReplaceReason,
    } = await import('../../electron/message-channel/hub/binding-service');

    await disableMobileAppBind();
    const afterDisable = await getChannelConnection('mobile');
    expect(afterDisable?.extras?.replaceReason).toBeUndefined();
    expect(afterDisable?.extras?.preFixedBinding).toMatchObject({
      engineType: 'claude',
      agentId: 'old',
    });

    await setChannelReplaceReason('mobile', 'unbound');
    const withReason = await getChannelConnection('mobile');
    expect(withReason?.extras?.replaceReason).toBe('unbound');
    expect(withReason?.extras?.preFixedBinding).toMatchObject({
      engineType: 'claude',
      agentId: 'old',
    });

    await setChannelReplaceReason('mobile', null);
    const cleared = await getChannelConnection('mobile');
    expect(cleared?.extras?.replaceReason).toBeUndefined();
    expect(cleared?.extras?.preFixedBinding).toMatchObject({
      engineType: 'claude',
      agentId: 'old',
    });
  });

  it('revokeDingTalkHubBind clears replaceReason and writes null extras when empty', async () => {
    const now = '2026-09-17T00:00:00.000Z';
    await mem.kysely
      .insertInto('channel_connections')
      .values({
        id: 'dingtalk-reason',
        channel_type: 'dingtalk',
        account_id: 'default',
        enabled: 1,
        device_id: 'device-test',
        external_user_id: 'u1',
        provider_account_id: null,
        bind_status: 'bound',
        bound_at: now,
        last_online_at: null,
        refresh_token: 'dt-tok',
        credential_token: null,
        endpoint_base_url: null,
        engine_type: 'pi',
        agent_id: 'main',
        extras_json: JSON.stringify({ replaceReason: 'unbound' }),
        created_at: now,
        updated_at: now,
      })
      .execute();

    const {
      revokeDingTalkHubBind,
      getChannelConnection,
    } = await import('../../electron/message-channel/hub/binding-service');

    await revokeDingTalkHubBind();
    const row = await getChannelConnection('dingtalk');
    expect(row?.bindStatus).toBe('revoked');
    expect(row?.refreshToken).toBeNull();
    expect(row?.extras).toBeNull();

    const raw = await mem.kysely
      .selectFrom('channel_connections')
      .select(['extras_json'])
      .where('id', '=', 'dingtalk-reason')
      .executeTakeFirst();
    expect(raw?.extras_json).toBeNull();
  });
});
