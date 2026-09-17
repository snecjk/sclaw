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
});
