import type { AgentEngineType, EngineHistoryResult } from '../engines/types';
import { getChatUserTurnCompositionRepository, type StoredUserTurnComposition } from '../db/repositories/chat-user-turn-composition-repository';
import { modelMessageTextFingerprint } from '../../shared/model-message-composition';

const HISTORY_MATCH_WINDOW_MS = 5 * 60_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function messageRole(message: unknown): string {
  return String(asRecord(message)?.role ?? '').toLowerCase();
}

function messageIdempotencyKey(message: unknown): string | null {
  const record = asRecord(message);
  const metadata = asRecord(record?.metadata);
  const value = record?.idempotencyKey ?? record?.idempotency_key
    ?? metadata?.idempotencyKey ?? metadata?.idempotency_key;
  return typeof value === 'string' && value ? value : null;
}

function messageProviderId(message: unknown): string | null {
  const record = asRecord(message);
  const value = record?.id ?? record?.messageId ?? record?.message_id;
  return typeof value === 'string' && value ? value : null;
}

function messageTimestamp(message: unknown): number | null {
  const record = asRecord(message);
  const raw = record?.timestamp ?? record?.createdAt ?? record?.created_at;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw < 1e12 ? raw * 1000 : raw;
  if (typeof raw === 'string') {
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function messageText(message: unknown): string {
  const record = asRecord(message);
  const content = record?.content ?? record?.message ?? record?.text;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((block) => {
    const item = asRecord(block);
    return typeof item?.text === 'string' ? item.text : '';
  }).join('');
}

function buildComposerMetadata(turn: StoredUserTurnComposition): Record<string, unknown> {
  const composerSegments: Array<Record<string, unknown>> = [];
  const skillMetas: Array<{ slug: string; title: string }> = [];
  const attachedFiles: Array<Record<string, unknown>> = [];
  let attachmentIndex = 0;

  for (const segment of turn.composition.segments) {
    switch (segment.type) {
      case 'text':
        composerSegments.push({ type: 'text', text: segment.text });
        break;
      case 'mention':
        {
          const mention = segment.mentionIndex === undefined
            ? undefined
            : turn.hostMetadata.dingTalkMentions?.[segment.mentionIndex];
        composerSegments.push({
          type: 'mention',
          mention: mention ?? { type: 'user', displayName: segment.displayName },
        });
        break;
        }
      case 'skill': {
        const meta = { slug: segment.slug, title: segment.title };
        skillMetas.push(meta);
        composerSegments.push({ type: 'skill', ...meta });
        break;
      }
      case 'workflow':
        composerSegments.push({
          type: 'workflow',
          id: segment.id,
          name: segment.name,
          source: segment.source,
        });
        break;
      case 'attachment': {
        const attachment = turn.attachments[attachmentIndex++];
        if (!attachment) break;
        const file = {
          type: 'file',
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          fileSize: attachment.byteSize,
          preview: null,
          filePath: attachment.filePath,
          stagedPath: attachment.filePath,
          provenance: attachment.provenance,
        };
        composerSegments.push(file);
        attachedFiles.push({
          fileName: attachment.fileName,
          filePath: attachment.filePath,
          mimeType: attachment.mimeType,
          fileSize: attachment.byteSize,
          preview: null,
          provenance: attachment.provenance,
        });
        break;
      }
    }
  }

  return {
    content: turn.displayText,
    _composerSegments: composerSegments,
    _attachedFiles: attachedFiles.length ? attachedFiles : undefined,
    _skillMeta: skillMetas[0],
    _skillMetas: skillMetas.length ? skillMetas : undefined,
  };
}

function matchTurnsToMessages(messages: unknown[], turns: StoredUserTurnComposition[]): Map<number, StoredUserTurnComposition> {
  const userIndexes = messages
    .map((message, index) => ({ message, index }))
    .filter((item) => messageRole(item.message) === 'user');
  const matches = new Map<number, StoredUserTurnComposition>();
  const usedTurns = new Set<string>();
  const byIdempotencyKey = new Map(turns.map((turn) => [turn.idempotencyKey, turn]));
  const byProviderMessageId = new Map(
    turns.filter((turn) => turn.providerMessageId).map((turn) => [turn.providerMessageId!, turn]),
  );

  for (const item of userIndexes) {
    const key = messageIdempotencyKey(item.message);
    if (!key) continue;
    const turn = byIdempotencyKey.get(key);
    if (!turn) continue;
    matches.set(item.index, turn);
    usedTurns.add(turn.idempotencyKey);
  }

  for (const item of userIndexes) {
    if (matches.has(item.index)) continue;
    const providerId = messageProviderId(item.message);
    if (!providerId) continue;
    const turn = byProviderMessageId.get(providerId) ?? byIdempotencyKey.get(providerId);
    if (!turn) continue;
    matches.set(item.index, turn);
    usedTurns.add(turn.idempotencyKey);
  }

  const fingerprintPairs = userIndexes.flatMap((item) => {
    if (matches.has(item.index)) return [];
    const timestamp = messageTimestamp(item.message);
    const fingerprint = modelMessageTextFingerprint(messageText(item.message));
    if (timestamp == null || !fingerprint) return [];
    return turns
      .filter((turn) => !usedTurns.has(turn.idempotencyKey)
        && turn.messageFingerprint === fingerprint)
      .map((turn) => ({
        messageIndex: item.index,
        turn,
        distance: Math.abs(Date.parse(turn.createdAt) - timestamp),
      }))
      .filter((candidate) => candidate.distance <= HISTORY_MATCH_WINDOW_MS);
  }).sort((left, right) => left.distance - right.distance);
  for (const pair of fingerprintPairs) {
    if (matches.has(pair.messageIndex) || usedTurns.has(pair.turn.idempotencyKey)) continue;
    const tied = fingerprintPairs.some((candidate) => (
      candidate !== pair
      && candidate.distance === pair.distance
      && (candidate.messageIndex === pair.messageIndex
        || candidate.turn.idempotencyKey === pair.turn.idempotencyKey)
      && !matches.has(candidate.messageIndex)
      && !usedTurns.has(candidate.turn.idempotencyKey)
    ));
    if (tied) continue;
    matches.set(pair.messageIndex, pair.turn);
    usedTurns.add(pair.turn.idempotencyKey);
  }

  const unmatchedMessages = userIndexes.filter((item) => !matches.has(item.index));
  const unmatchedTurns = turns.filter((turn) => !usedTurns.has(turn.idempotencyKey));
  const candidateTurnsByMessage = new Map<number, StoredUserTurnComposition[]>();
  const candidateMessageCountByTurn = new Map<string, number>();
  for (const item of unmatchedMessages) {
    const timestamp = messageTimestamp(item.message);
    if (timestamp == null) continue;
    const candidates = unmatchedTurns.filter((turn) => (
      Math.abs(Date.parse(turn.createdAt) - timestamp) <= HISTORY_MATCH_WINDOW_MS
    ));
    candidateTurnsByMessage.set(item.index, candidates);
    for (const turn of candidates) {
      candidateMessageCountByTurn.set(
        turn.idempotencyKey,
        (candidateMessageCountByTurn.get(turn.idempotencyKey) ?? 0) + 1,
      );
    }
  }
  for (const item of unmatchedMessages) {
    const candidates = candidateTurnsByMessage.get(item.index) ?? [];
    if (candidates.length !== 1) continue;
    const turn = candidates[0]!;
    if (candidateMessageCountByTurn.get(turn.idempotencyKey) !== 1) continue;
    matches.set(item.index, turn);
    usedTurns.add(turn.idempotencyKey);
  }
  return matches;
}

export async function projectUserTurnCompositions(
  sessionKey: string,
  result: EngineHistoryResult,
  engineType?: AgentEngineType,
): Promise<EngineHistoryResult> {
  if (!result.messages.length) return result;
  try {
    const repository = getChatUserTurnCompositionRepository();
    const timestamps = result.messages
      .filter((message) => messageRole(message) === 'user')
      .map(messageTimestamp)
      .filter((value): value is number => value != null);
    const from = timestamps.length
      ? new Date(Math.min(...timestamps) - HISTORY_MATCH_WINDOW_MS).toISOString()
      : undefined;
    const to = timestamps.length
      ? new Date(Math.max(...timestamps) + HISTORY_MATCH_WINDOW_MS).toISOString()
      : undefined;
    await repository.deleteExpiredPendingAndRejected().catch(() => {});
    const messageIds = result.messages.flatMap((message) => [
      messageIdempotencyKey(message),
      messageProviderId(message),
    ]).filter((value): value is string => Boolean(value));
    const [rangeTurns, idTurns] = await Promise.all([
      repository.listAcceptedForHistoryRange({
        sessionKey,
        engineType,
        from,
        to,
        limit: Math.max(result.messages.length * 3, 100),
      }),
      repository.listAcceptedByMessageIds({ sessionKey, engineType, ids: messageIds }),
    ]);
    const turns = [...new Map(
      [...rangeTurns, ...idTurns].map((turn) => [turn.idempotencyKey, turn]),
    ).values()];
    if (!turns.length) return result;
    const matches = matchTurnsToMessages(result.messages, turns);
    if (!matches.size) return result;
    const providerBindings: Array<Promise<void>> = [];
    const projected = {
      ...result,
      messages: result.messages.map((message, index) => {
        const turn = matches.get(index);
        if (!turn) return message;
        const providerMessageId = messageProviderId(message);
        if (providerMessageId && providerMessageId !== turn.providerMessageId) {
          providerBindings.push(repository.bindProviderMessageId(
            sessionKey,
            turn.idempotencyKey,
            providerMessageId,
          ));
        }
        return { ...(asRecord(message) ?? {}), ...buildComposerMetadata(turn) };
      }),
    };
    await Promise.all(providerBindings).catch(() => {});
    return projected;
  } catch {
    return result;
  }
}
