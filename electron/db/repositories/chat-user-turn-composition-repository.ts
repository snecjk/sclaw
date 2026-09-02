import { getKyselyDatabase } from '../connection';
import type { AgentEngineType } from '../../engines/types';
import type { NormalizedModelAttachment, NormalizedModelTurn } from '../../services/model-message-normalizer';
import type { ModelMessageCompositionV1 } from '../../../shared/model-message-composition';
import type { DingTalkMention } from '../../../shared/dingtalk-send/dingtalk-mention';
import { modelMessageTextFingerprint } from '../../../shared/model-message-composition';

export interface StoredUserTurnComposition {
  sessionKey: string;
  idempotencyKey: string;
  runId: string | null;
  engineType: AgentEngineType;
  status: 'pending' | 'accepted' | 'rejected';
  displayText: string;
  sourceText: string;
  messageFingerprint: string;
  providerMessageId: string | null;
  composition: ModelMessageCompositionV1;
  attachments: NormalizedModelAttachment[];
  hostMetadata: { dingTalkMentions?: DingTalkMention[] };
  error: string | null;
  createdAt: string;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapRow(row: Record<string, unknown>): StoredUserTurnComposition {
  return {
    sessionKey: String(row.session_key),
    idempotencyKey: String(row.idempotency_key),
    runId: row.run_id == null ? null : String(row.run_id),
    engineType: String(row.engine_type) as AgentEngineType,
    status: String(row.status) as StoredUserTurnComposition['status'],
    displayText: String(row.display_text ?? ''),
    sourceText: String(row.source_text ?? ''),
    messageFingerprint: String(row.message_fingerprint ?? ''),
    providerMessageId: row.provider_message_id == null ? null : String(row.provider_message_id),
    composition: parseJson(String(row.composition_json), { version: 1, segments: [] }),
    attachments: parseJson(String(row.attachments_json ?? '[]'), []),
    hostMetadata: parseJson(String(row.host_metadata_json ?? '{}'), {}),
    error: row.error == null ? null : String(row.error),
    createdAt: String(row.created_at),
  };
}

export class ChatUserTurnCompositionRepository {
  async upsertPending(input: {
    sessionKey: string;
    idempotencyKey: string;
    engineType: AgentEngineType;
    turn: NormalizedModelTurn;
  }): Promise<void> {
    const timestamp = new Date().toISOString();
    await getKyselyDatabase()
      .insertInto('chat_user_turn_compositions')
      .values({
        session_key: input.sessionKey,
        idempotency_key: input.idempotencyKey,
        run_id: null,
        engine_type: input.engineType,
        status: 'pending',
        protocol_version: input.turn.composition.version,
        display_text: input.turn.displayText,
        source_text: input.turn.sourceText,
        message_fingerprint: modelMessageTextFingerprint(input.turn.displayText),
        provider_message_id: null,
        composition_json: JSON.stringify(input.turn.composition),
        attachments_json: JSON.stringify(input.turn.attachments),
        host_metadata_json: JSON.stringify(input.turn.hostMetadata ?? {}),
        error: null,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .onConflict((conflict) => conflict.columns(['session_key', 'idempotency_key']).doNothing())
      .execute();
  }

  async markAccepted(sessionKey: string, idempotencyKey: string, runId?: string): Promise<void> {
    await getKyselyDatabase()
      .updateTable('chat_user_turn_compositions')
      .set({ status: 'accepted', run_id: runId ?? null, error: null, updated_at: new Date().toISOString() })
      .where('session_key', '=', sessionKey)
      .where('idempotency_key', '=', idempotencyKey)
      .execute();
  }

  async bindProviderMessageId(
    sessionKey: string,
    idempotencyKey: string,
    providerMessageId: string,
  ): Promise<void> {
    await getKyselyDatabase()
      .updateTable('chat_user_turn_compositions')
      .set({ provider_message_id: providerMessageId, updated_at: new Date().toISOString() })
      .where('session_key', '=', sessionKey)
      .where('idempotency_key', '=', idempotencyKey)
      .execute();
  }

  async markRejected(sessionKey: string, idempotencyKey: string, error: string): Promise<void> {
    await getKyselyDatabase()
      .updateTable('chat_user_turn_compositions')
      .set({ status: 'rejected', error, updated_at: new Date().toISOString() })
      .where('session_key', '=', sessionKey)
      .where('idempotency_key', '=', idempotencyKey)
      .execute();
  }

  async listAcceptedForHistoryRange(input: {
    sessionKey: string;
    engineType?: AgentEngineType;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<StoredUserTurnComposition[]> {
    let query = getKyselyDatabase()
      .selectFrom('chat_user_turn_compositions')
      .selectAll()
      .where('session_key', '=', input.sessionKey)
      .where('status', '=', 'accepted');
    if (input.engineType) query = query.where('engine_type', '=', input.engineType);
    if (input.from) query = query.where('created_at', '>=', input.from);
    if (input.to) query = query.where('created_at', '<=', input.to);
    const rows = await query
      .orderBy('created_at', 'desc')
      .limit(Math.max(1, Math.min(input.limit ?? 2_000, 5_000)))
      .execute();
    rows.reverse();
    return rows.map((row) => mapRow(row as Record<string, unknown>));
  }

  async listAcceptedByMessageIds(input: {
    sessionKey: string;
    engineType?: AgentEngineType;
    ids: string[];
  }): Promise<StoredUserTurnComposition[]> {
    const ids = [...new Set(input.ids.map((id) => id.trim()).filter(Boolean))].slice(0, 2_000);
    if (!ids.length) return [];
    let query = getKyselyDatabase()
      .selectFrom('chat_user_turn_compositions')
      .selectAll()
      .where('session_key', '=', input.sessionKey)
      .where('status', '=', 'accepted')
      .where((expression) => expression.or([
        expression('idempotency_key', 'in', ids),
        expression('provider_message_id', 'in', ids),
      ]));
    if (input.engineType) query = query.where('engine_type', '=', input.engineType);
    const rows = await query.execute();
    return rows.map((row) => mapRow(row as Record<string, unknown>));
  }

  async deleteExpiredPendingAndRejected(now = Date.now()): Promise<void> {
    const pendingCutoff = new Date(now - 24 * 60 * 60_000).toISOString();
    const rejectedCutoff = new Date(now - 7 * 24 * 60 * 60_000).toISOString();
    await getKyselyDatabase()
      .deleteFrom('chat_user_turn_compositions')
      .where((expression) => expression.or([
        expression.and([
          expression('status', '=', 'pending'),
          expression('updated_at', '<', pendingCutoff),
        ]),
        expression.and([
          expression('status', '=', 'rejected'),
          expression('updated_at', '<', rejectedCutoff),
        ]),
      ]))
      .execute();
  }

  async deleteSession(sessionKey: string): Promise<void> {
    await getKyselyDatabase()
      .deleteFrom('chat_user_turn_compositions')
      .where('session_key', '=', sessionKey)
      .execute();
  }
}

const repository = new ChatUserTurnCompositionRepository();

export function getChatUserTurnCompositionRepository(): ChatUserTurnCompositionRepository {
  return repository;
}
