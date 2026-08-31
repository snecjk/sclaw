import {
  chatHistoryFingerprintsEqual,
  isChatHistoryFingerprint,
  type ChatHistoryFingerprint,
} from '../../shared/chat-history-fingerprint';
import type { AgentEngineType, EngineHistoryResult } from './types';

export function readClientHistoryFingerprint(value: unknown): ChatHistoryFingerprint | null {
  return isChatHistoryFingerprint(value) ? value : null;
}

/**
 * Claude 本地 buildHistory 后按指纹决定是否省略 messages。
 * OpenClaw 仍走 gateway 全量，不省略。
 */
export function omitUnchangedHistoryMessages(input: {
  engineType: AgentEngineType | undefined;
  result: EngineHistoryResult;
  clientFingerprint: ChatHistoryFingerprint | null;
  beforeId?: string | null;
}): EngineHistoryResult {
  const fingerprint = input.result.fingerprint;
  const canReconcile = input.engineType === 'claude'
    && !input.beforeId
    && Boolean(fingerprint)
    && chatHistoryFingerprintsEqual(input.clientFingerprint, fingerprint);
  if (!canReconcile) {
    return input.result;
  }
  return {
    ...input.result,
    messages: [],
    unchanged: true,
  };
}
