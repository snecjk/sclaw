/**
 * Claude in-session model switching: archive the old SDK session (preserve UI history),
 * start the next query on a fresh SDK session with the new model.
 */

import { getEngineSessionRegistryEntry, upsertEngineSessionRegistryEntry } from './session-registry';
import { logger } from '../utils/logger';

function normalizeModelId(model?: string): string {
  return (model ?? '').trim();
}

export async function applyClaudeSessionModelSwitch(params: {
  sessionKey: string;
  agentId: string;
  cwd: string;
  rawModel: string;
  accountId?: string;
  title?: string;
}): Promise<{ model: string; modelChanged: boolean }> {
  const existing = await getEngineSessionRegistryEntry(params.sessionKey);
  const nextModel = normalizeModelId(params.rawModel);
  const previousModel = normalizeModelId(existing?.model);
  const modelChanged = Boolean(nextModel && nextModel !== previousModel);

  let archivedClaudeSessionIds = [...(existing?.archivedClaudeSessionIds ?? [])];
  let sessionId = existing?.sessionId;
  let pendingHistoryBridge = existing?.pendingHistoryBridge ?? false;

  if (modelChanged && sessionId) {
    if (!archivedClaudeSessionIds.includes(sessionId)) {
      archivedClaudeSessionIds.push(sessionId);
    }
    logger.info(
      `[claude-session] Model switch ${previousModel || '(unset)'} -> ${nextModel}; archived SDK session ${sessionId}`,
    );
    sessionId = undefined;
    pendingHistoryBridge = true;
  }

  await upsertEngineSessionRegistryEntry({
    sessionKey: params.sessionKey,
    sessionId,
    cwd: params.cwd,
    agentId: params.agentId,
    engineType: 'claude',
    updatedAt: Date.now(),
    title: params.title ?? existing?.title,
    model: nextModel,
    accountId: params.accountId ?? existing?.accountId,
    archivedClaudeSessionIds,
    pendingHistoryBridge: modelChanged ? pendingHistoryBridge : existing?.pendingHistoryBridge,
  });

  return { model: nextModel, modelChanged };
}
