/**
 * Claude in-session model switching: archive the old SDK session (preserve UI history),
 * start the next query on a fresh SDK session with the new model.
 */

import { getEngineSessionRegistryEntry, upsertEngineSessionRegistryEntry } from './session-registry';
import { logger } from '../utils/logger';
import { resolveAvailableClaudeModel } from './claude-model-selection';

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
  const selection = await resolveAvailableClaudeModel({
    requestedModel: params.rawModel,
    requestedAccountId: params.accountId ?? existing?.accountId,
  });
  const nextModel = normalizeModelId(selection.model);
  const previousModel = normalizeModelId(existing?.model);
  const modelChanged = Boolean(nextModel && nextModel !== previousModel);

  if (selection.fallbackApplied) {
    logger.warn('[claude-session] Requested model is unavailable; using fallback', {
      requestedModel: params.rawModel,
      requestedAccountId: params.accountId ?? existing?.accountId,
      fallbackModel: selection.model,
      fallbackAccountId: selection.accountId,
    });
  }

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
    accountId: selection.accountId,
    archivedClaudeSessionIds,
    pendingHistoryBridge: modelChanged ? pendingHistoryBridge : existing?.pendingHistoryBridge,
  });

  return { model: nextModel, modelChanged };
}
