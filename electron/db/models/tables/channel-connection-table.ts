import type { ColumnType } from 'kysely';

export type TimestampColumn = ColumnType<string, string | undefined, string | undefined>;
export type NullableTimestampColumn = ColumnType<string | null, string | null | undefined, string | null | undefined>;

/** Platform channel id string; not limited to a fixed enum at DB layer. */
export type ChannelType = string;
export type ChannelBindStatus = 'unbound' | 'bound' | 'revoked';
/** Engine id string; not limited to a fixed enum at DB layer. */
export type ChannelEngineType = string;

export interface ChannelConnectionTable {
  id: string;
  channel_type: ChannelType;
  account_id: string;
  enabled: number;
  device_id: string;
  external_user_id: string | null;
  provider_account_id: string | null;
  bind_status: ChannelBindStatus;
  bound_at: NullableTimestampColumn;
  last_online_at: NullableTimestampColumn;
  refresh_token: string | null;
  credential_token: string | null;
  endpoint_base_url: string | null;
  engine_type: ChannelEngineType | null;
  agent_id: string | null;
  extras_json: string | null;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}
