// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupInMemoryDb, type InMemoryDb } from '../db/helpers';

describe('ensureFixedChannelBindings', () => {
  let mem: InMemoryDb;

  beforeEach(() => {
    mem = setupInMemoryDb();
  });

  afterEach(() => {
    mem.teardown();
  });

  it('normalizes bound rows including legacy mobile channel_type', async () => {
    const now = '2026-09-16T00:00:00.000Z';
    await mem.kysely
      .insertInto('channel_connections')
      .values([
        {
          id: 'dt-1',
          channel_type: 'dingtalk',
          account_id: 'default',
          enabled: 1,
          device_id: 'device-test',
          external_user_id: 'u1',
          provider_account_id: null,
          bind_status: 'bound',
          bound_at: now,
          last_online_at: null,
          refresh_token: 'tok',
          credential_token: null,
          endpoint_base_url: null,
          engine_type: 'claude',
          agent_id: 'main',
          extras_json: null,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'mob-legacy',
          channel_type: 'mobile',
          account_id: 'default',
          enabled: 1,
          device_id: 'device-test',
          external_user_id: null,
          provider_account_id: null,
          bind_status: 'bound',
          bound_at: now,
          last_online_at: null,
          refresh_token: 'mob',
          credential_token: null,
          endpoint_base_url: null,
          engine_type: 'openclaw',
          agent_id: 'agent-x',
          extras_json: null,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'mob-ok',
          channel_type: 'sto-mobile',
          account_id: 'other',
          enabled: 1,
          device_id: 'device-test',
          external_user_id: null,
          provider_account_id: null,
          bind_status: 'bound',
          bound_at: now,
          last_online_at: null,
          refresh_token: null,
          credential_token: null,
          endpoint_base_url: null,
          engine_type: 'pi',
          agent_id: 'main',
          extras_json: null,
          created_at: now,
          updated_at: now,
        },
      ])
      .execute();

    const { ensureFixedChannelBindings } = await import(
      '../../electron/message-channel/hub/binding-service'
    );
    const result = await ensureFixedChannelBindings();
    expect(result.normalized).toBe(2);

    const rows = await mem.kysely
      .selectFrom('channel_connections')
      .selectAll()
      .execute();
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId['dt-1']).toMatchObject({
      engine_type: 'pi',
      agent_id: 'main',
    });
    expect(byId['mob-legacy']).toMatchObject({
      engine_type: 'pi',
      agent_id: 'main',
    });
    expect(JSON.parse(String(byId['mob-legacy'].extras_json))).toMatchObject({
      preFixedBinding: {
        engineType: 'openclaw',
        agentId: 'agent-x',
      },
    });
    expect(byId['mob-ok']).toMatchObject({
      engine_type: 'pi',
      agent_id: 'main',
      extras_json: null,
    });
  });
});
