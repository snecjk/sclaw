import { randomUUID } from 'node:crypto';
import { getAgentPreferredModel } from '../utils/agent-config';
import { getApiKey } from '../utils/secure-storage';
import {
  getDefaultProviderAccountId,
  getProviderAccount,
} from '../services/providers/provider-store';
import { resolveSessionToolCwd } from '../services/session-catalog-service';
import {
  getPiAgentSkillsDir,
  getPiConfigDir,
  getPiSkillsDir,
  getPiSessionsDir,
} from '../utils/paths';
import { logger } from '../utils/logger';
import { getPiRuntimeService } from '../services/pi-runtime-service';
import { getSkillManager } from '../services/skills/skill-manager';
import { toLegacyChatMessagePayload, type NormalizedEngineEvent } from '../gateway/normalized-engine-event';
import { resolveAgentIdForSessionKey } from './session-engine';
import {
  deleteEngineSessionRegistryEntry,
  getEngineSessionRegistryEntry,
  listEngineSessionRegistryEntries,
  upsertEngineSessionRegistryEntry,
  type EngineSessionRegistryEntry,
} from './session-registry';
import type {
  EngineAdapter,
  EngineAdapterContext,
  EngineHistoryResult,
  EngineSendWithMediaParams,
} from './types';
import type {
  PiHistoryResult,
  PiInspectResult,
  PiModelConfig,
  PiPromptResult,
  PiSessionConfig,
} from '../../shared/pi-runtime-protocol';

const BUILTIN_PI_PROVIDERS = new Set(['anthropic', 'openai', 'google', 'openrouter']);
const attachedEventSinks = new WeakSet<object>();

function attachEventSink(ctx: EngineAdapterContext): void {
  const sink = ctx.eventSink ?? ctx.gatewayManager;
  if (!sink || attachedEventSinks.has(sink)) return;
  attachedEventSinks.add(sink);
  const runtime = getPiRuntimeService();
  runtime.on('event', (event) => sink.emit('chat:message', toLegacyChatMessagePayload(event)));
  runtime.on('exit', ({ code, sessions }) => {
    for (const sessionKey of sessions) {
      const event: NormalizedEngineEvent = {
        type: 'turn.interrupted',
        sessionKey,
        errorMessage: `Pi runtime exited unexpectedly with code ${code}`,
      };
      sink.emit('chat:message', toLegacyChatMessagePayload(event));
    }
  });
}

async function resolvePiModel(
  agentId: string,
  entry: EngineSessionRegistryEntry | null,
): Promise<{ model: PiModelConfig; accountId: string }> {
  const preferred = await getAgentPreferredModel(agentId);
  const accountId = entry?.accountId || preferred.accountId || await getDefaultProviderAccountId();
  if (!accountId) throw new Error('PI_MODEL_UNAVAILABLE: no provider account is selected');
  const account = await getProviderAccount(accountId);
  if (!account || account.enabled === false) {
    throw new Error(`PI_MODEL_UNAVAILABLE: provider account ${accountId} is unavailable`);
  }
  const model = (entry?.model || preferred.model || account.model || '').trim();
  if (!model) throw new Error(`PI_MODEL_UNAVAILABLE: account ${accountId} has no model selected`);

  const provider = BUILTIN_PI_PROVIDERS.has(account.vendorId) && !account.baseUrl
    ? account.vendorId
    : account.id;
  if (!BUILTIN_PI_PROVIDERS.has(provider) && !account.baseUrl) {
    throw new Error(`PI_PROVIDER_UNSUPPORTED: ${account.vendorId} requires an explicit base URL`);
  }
  const apiKey = await getApiKey(accountId);
  if (account.authMode !== 'local' && !apiKey) {
    throw new Error(`PI_CREDENTIAL_UNAVAILABLE: account ${accountId} has no API key`);
  }
  return {
    accountId,
    model: {
      provider,
      model,
      accountId,
      apiKey: apiKey ?? undefined,
      baseUrl: account.baseUrl,
      apiProtocol: account.apiProtocol,
      headers: account.headers,
    },
  };
}

async function buildPiSessionConfig(
  sessionKey: string,
  params?: Pick<EngineSendWithMediaParams, 'systemPromptAppend' | 'media' | 'allowedRoots' | 'cwdOverride'>,
): Promise<{ config: PiSessionConfig; entry: EngineSessionRegistryEntry }> {
  const existing = await getEngineSessionRegistryEntry(sessionKey);
  const agentId = existing?.agentId || await resolveAgentIdForSessionKey(sessionKey);
  const cwd = params?.cwdOverride?.trim() || existing?.cwd || await resolveSessionToolCwd(sessionKey, agentId);
  if (!cwd) throw new Error(`PI_WORKSPACE_UNAVAILABLE: session ${sessionKey} has no cwd`);
  await getSkillManager().reconcile(
    { agentId },
    ['pi'],
    { notifyAfterBatch: false },
  );
  const selection = await resolvePiModel(agentId, existing);
  const workspaceNote = [
    '# SClaw runtime context',
    `The default working directory is: ${cwd}`,
    'For an interactive chat this directory is context and the default cwd, not a security boundary. You may access other paths allowed to the current operating-system user when the user asks.',
    'Do not install Pi packages or load project .pi settings, extensions, or package configuration.',
    params?.systemPromptAppend?.trim(),
  ].filter(Boolean).join('\n\n');
  const entry: EngineSessionRegistryEntry = {
    ...existing,
    sessionKey,
    engineType: 'pi',
    agentId,
    cwd,
    model: selection.model.model,
    provider: selection.model.provider,
    accountId: selection.accountId,
    updatedAt: Date.now(),
  };
  const config: PiSessionConfig = {
    sessionKey,
    cwd,
    agentDir: getPiConfigDir(),
    sessionDir: getPiSessionsDir(),
    sessionFile: existing?.piSessionFile,
    systemPrompt: workspaceNote,
    model: selection.model,
    media: params?.media,
    scheduledAllowedRoots: params?.allowedRoots,
    skillRoots: [getPiSkillsDir(), getPiAgentSkillsDir(agentId)],
  };
  return { config, entry };
}

async function sendPiMessage(
  ctx: EngineAdapterContext,
  params: EngineSendWithMediaParams,
): Promise<{ success: boolean; result?: { runId?: string }; error?: string }> {
  try {
    attachEventSink(ctx);
    const { config, entry } = await buildPiSessionConfig(params.sessionKey, params);
    const runId = randomUUID();
    await upsertEngineSessionRegistryEntry(entry);
    let result: PiPromptResult;
    try {
      result = await getPiRuntimeService().request<PiPromptResult>('session.prompt', {
        sessionKey: params.sessionKey,
        payload: { config, message: params.message, runId },
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('timed out')) {
        const inspection = await getPiRuntimeService().request<{ status: string; runId?: string }>('session.inspect', {
          sessionKey: params.sessionKey,
        }).catch(() => null);
        if (inspection?.status === 'active' && (!inspection.runId || inspection.runId === runId)) {
          getPiRuntimeService().markSessionActive(params.sessionKey);
          return { success: true, result: { runId } };
        }
      }
      throw error;
    }
    getPiRuntimeService().markSessionActive(params.sessionKey);
    await upsertEngineSessionRegistryEntry({
      ...entry,
      sessionId: result.sessionId,
      piSessionFile: result.sessionFile,
    });
    return { success: true, result: { runId: result.runId } };
  } catch (error) {
    logger.warn('[pi-adapter] send failed', { sessionKey: params.sessionKey, error: String(error) });
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function deletePiSession(sessionKey: string): Promise<void> {
  const entry = await getEngineSessionRegistryEntry(sessionKey);
  await getPiRuntimeService().request('session.delete', {
    sessionKey,
    payload: { sessionFile: entry?.piSessionFile },
  }).catch((error) => logger.warn('[pi-adapter] runtime delete failed', { sessionKey, error: String(error) }));
  await deleteEngineSessionRegistryEntry(sessionKey);
}

export const piAdapter: EngineAdapter = {
  type: 'pi',
  chatCapabilities: {
    hasReliableRuntimeStatus: true,
    hasStructuredReasoningEvents: true,
    hasStructuredToolEvents: true,
    requiresHistoryProjection: true,
  },

  classifyFinalMessage({ message, phase }) {
    if (phase === 'completed') return 'completed';
    return message == null ? 'awaiting_transcript' : 'progress';
  },

  prepareMemoryInjection(params, memory) {
    const memoryPrompt = [memory.preference, memory.execution].filter(Boolean).join('\n\n');
    return {
      ...params,
      systemPromptAppend: [memoryPrompt, params.systemPromptAppend?.trim()].filter(Boolean).join('\n\n') || undefined,
    };
  },

  async inspectRun(_ctx, params) {
    try {
      return await getPiRuntimeService().request<PiInspectResult>('session.inspect', {
        sessionKey: params.sessionKey,
      });
    } catch (error) {
      return { status: 'unknown', runId: params.runId ?? undefined, reason: String(error) };
    }
  },

  async listSessions() {
    const entries = await listEngineSessionRegistryEntries('pi');
    return {
      success: true,
      result: {
        sessions: entries.map((entry) => ({
          key: entry.sessionKey,
          label: entry.title,
          displayName: entry.title,
          updatedAt: entry.updatedAt,
          model: entry.model,
          engineType: 'pi' as const,
        })),
      },
    };
  },

  async getHistory(_ctx, params) {
    try {
      const { config } = await buildPiSessionConfig(params.sessionKey);
      const result = await getPiRuntimeService().request<PiHistoryResult>('session.history', {
        sessionKey: params.sessionKey,
        payload: { config, limit: params.limit },
      });
      const history: EngineHistoryResult = {
        messages: result.messages.slice(-params.limit),
        thinkingLevel: null,
        isRunning: result.isRunning,
      };
      return { success: true, result: history };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  async getExecutionSnapshot() {
    return { success: true, result: null };
  },

  async sendMessage(ctx, params) {
    return sendPiMessage(ctx, { ...params, media: [] });
  },

  async sendMessageWithMedia(ctx, params) {
    return sendPiMessage(ctx, params);
  },

  async abortRun(_ctx, params) {
    try {
      const result = await getPiRuntimeService().request<{ aborted: boolean; runIds: unknown[] }>(
        'session.abort',
        { sessionKey: params.sessionKey },
      );
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};
