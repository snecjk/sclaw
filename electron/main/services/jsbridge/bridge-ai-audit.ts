import { logger } from '../../../utils/logger';

export interface BridgeAiAuditRecord {
  appId: string;
  capability: 'chat.complete' | 'chat.cancel' | 'chat.invokeAgent';
  requestId: string;
  userId?: string | null;
  promptLength: number;
  contextLength: number;
  finishReason?: string;
  durationMs?: number;
  errorCode?: string;
}

export function logBridgeAiAudit(record: BridgeAiAuditRecord): void {
  logger.info('[bridge-ai][audit]', {
    appId: record.appId,
    capability: record.capability,
    requestId: record.requestId,
    userId: record.userId ?? null,
    promptLength: record.promptLength,
    contextLength: record.contextLength,
    finishReason: record.finishReason ?? null,
    durationMs: record.durationMs ?? null,
    errorCode: record.errorCode ?? null,
  });
}
