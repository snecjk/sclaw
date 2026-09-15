import { createHash, randomUUID } from 'node:crypto';
import { getAgentPreferredModel } from '../utils/agent-config';
import { getApiKey } from '../utils/secure-storage';
import {
  getDefaultProviderAccountId,
  getProviderAccount,
} from '../services/providers/provider-store';
import { resolveSessionToolCwd } from '../services/session-catalog-service';
import {
  getPiConfigDir,
  getPiSessionsDir,
} from '../utils/paths';
import { logger } from '../utils/logger';
import { getPiRuntimeService } from '../services/pi-runtime-service';
import { getSkillManager } from '../services/skills/skill-manager';
import { routeSessionSkills, type RoutedSessionSkill } from '../services/skills/session-skill-router';
import { emitSkillRoutingProgress, type SkillRoutingProgressSink } from '../services/skills/skill-routing-progress';
import { extractPiReadPaths, resolvePiReadSkillSlug } from '../services/skills/session-skill-usage';
import {
  completeSkillTurn,
  failSkillTurn,
  markSkillUsed,
} from '../services/skills/session-skill-state-service';
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
  PiContextUsageResult,
  PiInspectResult,
  PiModelConfig,
  PiPromptAttachment,
  PiPromptPayload,
  PiPromptResult,
  PiSessionConfig,
} from '../../shared/pi-runtime-protocol';
import { CHAT_HISTORY_LIMIT } from '../../shared/chat-config';
import { isWorkflowPiSessionKey } from '../../shared/workflow-pi-session';

const BUILTIN_PI_PROVIDERS = new Set(['anthropic', 'openai', 'google', 'openrouter']);
const attachedEventSinks = new WeakSet<object>();
const routedPiSkills = new Map<string, RoutedSessionSkill[]>();

function createSkillSetHash(skills: RoutedSessionSkill[]): string {
  return createHash('sha256')
    .update(skills.map((skill) => `${skill.slug}@${skill.sourceHash}`).sort().join('\n'))
    .digest('hex');
}

function attachEventSink(ctx: EngineAdapterContext): void {
  const sink = ctx.eventSink ?? ctx.gatewayManager;
  if (!sink || attachedEventSinks.has(sink)) return;
  attachedEventSinks.add(sink);
  const runtime = getPiRuntimeService();
  runtime.on('event', (event) => {
    if (event.sessionKey && event.runId && event.type === 'message.final') {
      const selected = routedPiSkills.get(event.sessionKey) ?? [];
      for (const readPath of extractPiReadPaths(event.message)) {
        const slug = resolvePiReadSkillSlug(selected, readPath);
        if (slug) void markSkillUsed(event.sessionKey, event.runId, slug).catch(() => {});
      }
    }
    if (event.sessionKey && event.runId && event.type === 'turn.completed') {
      void completeSkillTurn(event.sessionKey, event.runId).catch(() => {});
    } else if (event.sessionKey && event.runId && ['turn.failed', 'turn.aborted', 'turn.interrupted'].includes(event.type)) {
      void failSkillTurn(event.sessionKey, event.runId).catch(() => {});
    }
    sink.emit('chat:message', toLegacyChatMessagePayload(event));
  });
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

/**
 * Parse the gateway model's maxContextWindow (stored as string) into a number.
 * Returns null if the value is missing or invalid.
 */
function resolveGatewayContextWindow(
  customModelDetails: Record<string, { maxContextWindow?: string }> | undefined,
  modelId: string,
): number | null {
  if (!customModelDetails) return null;
  const detail = customModelDetails[modelId];
  if (!detail?.maxContextWindow) return null;
  const parsed = Number(detail.maxContextWindow);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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

  // Resolve real contextWindow from gateway model metadata (stored as string).
  const gatewayContextWindow = resolveGatewayContextWindow(account.metadata?.customModelDetails, model);

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
      ...(gatewayContextWindow != null ? { contextWindow: gatewayContextWindow } : {}),
    },
  };
}

export async function buildPiSessionConfig(
  sessionKey: string,
  runId?: string,
  params?: EngineSendWithMediaParams,
  progressSink?: SkillRoutingProgressSink | null,
): Promise<{ config: PiSessionConfig; entry: EngineSessionRegistryEntry }> {
  const existing = await getEngineSessionRegistryEntry(sessionKey);
  const agentId = existing?.agentId || await resolveAgentIdForSessionKey(sessionKey);
  const cwd = existing?.cwd || await resolveSessionToolCwd(sessionKey, agentId, 'pi');
  if (!cwd) throw new Error(`PI_WORKSPACE_UNAVAILABLE: session ${sessionKey} has no cwd`);
  await getSkillManager().reconcile(
    { agentId },
    ['pi'],
    { notifyAfterBatch: false },
  );
  const selection = await resolvePiModel(agentId, existing);
  const sessionMode = params?.runtimePolicy?.origin === 'scheduled_task' ? 'scheduled' : 'interactive';
  const selectedSkills = runId && params
    ? (await routeSessionSkills({
        sessionKey,
        runId,
        agentId,
        engine: 'pi',
        mode: sessionMode,
        query: params.message,
        rawMessage: params.message,
        attachmentNames: params.media?.map((item) => item.fileName),
        explicitSlugs: params.normalizedTurn?.selectedSkillSlugs,
        onProgress: sessionMode === 'scheduled'
          ? undefined
          : (message) => emitSkillRoutingProgress(progressSink, sessionKey, runId, message),
      })).selected
    : routedPiSkills.get(sessionKey) ?? [];
  if (runId) routedPiSkills.set(sessionKey, selectedSkills);
  const workspaceNote = [
    '# SClaw runtime context',
    `The default working directory is: ${cwd}`,
    'For an interactive chat this directory is context and the default cwd, not a security boundary. You may access other paths allowed to the current operating-system user when the user asks.',
    'Do not install Pi packages or load project .pi settings, extensions, or package configuration.',
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
    agentId,
    cwd,
    agentDir: getPiConfigDir(),
    projectTrusted: false,
    sessionDir: getPiSessionsDir(),
    sessionFile: existing?.piSessionFile,
    systemPrompt: workspaceNote,
    model: selection.model,
    sessionMode,
    skillRoots: selectedSkills.map((skill) => skill.sourceDir),
    selectedSkills: selectedSkills.map((skill) => ({
      slug: skill.slug,
      path: skill.sourceDir,
      sourceHash: skill.sourceHash,
    })),
    skillSetHash: createSkillSetHash(selectedSkills),
  };
  return { config, entry };
}

async function sendPiMessage(
  ctx: EngineAdapterContext,
  params: EngineSendWithMediaParams,
): Promise<{ success: boolean; result?: { runId?: string }; error?: string }> {
  const runId = randomUUID();
  try {
    attachEventSink(ctx);
    const { config, entry } = await buildPiSessionConfig(
      params.sessionKey,
      runId,
      params,
      ctx.eventSink ?? ctx.gatewayManager,
    );
    for (const match of params.message.matchAll(/(?:^|\s)\/skill:([a-z0-9._-]+)/gi)) {
      await markSkillUsed(params.sessionKey, runId, match[1]);
    }
    await upsertEngineSessionRegistryEntry(entry);
    let result: PiPromptResult;
    try {
      const payload = {
        config,
        message: params.normalizedTurn?.modelText ?? params.message,
        runId,
        systemPromptAppend: params.systemPromptAppend?.trim() || undefined,
        media: (params.media ?? []) satisfies PiPromptAttachment[],
        referencesEmbedded: Boolean(params.normalizedTurn && !params.normalizedTurn.legacy),
      } satisfies PiPromptPayload;
      result = await getPiRuntimeService().request<PiPromptResult>('session.prompt', {
        sessionKey: params.sessionKey,
        payload,
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
    await failSkillTurn(params.sessionKey, runId).catch(() => {});
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
  routedPiSkills.delete(sessionKey);
}

export const piAdapter: EngineAdapter = {
  historyCapabilities: {
    paginationMode: 'before-id',
    defaultPageSize: CHAT_HISTORY_LIMIT,
  },
  type: 'pi',
  scheduledTaskCapabilities: {
    enforcedPermissionProfile: 'workspace-write',
    requiresWorkspacePath: true,
    supportsWorkflow: true,
  },
  chatCapabilities: {
    hasReliableRuntimeStatus: true,
    hasStructuredReasoningEvents: true,
    hasStructuredToolEvents: true,
    requiresHistoryProjection: true,
    supportsContextUsage: true,
    supportsManualCompaction: true,
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
        sessions: entries
          .filter((entry) => !isWorkflowPiSessionKey(entry.sessionKey))
          .map((entry) => ({
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
        payload: {
          config,
          limit: params.limit,
          ...(params.beforeId ? { beforeId: params.beforeId } : {}),
        },
      });
      const history: EngineHistoryResult = {
        messages: result.messages,
        thinkingLevel: null,
        isRunning: result.isRunning,
        hasMore: result.hasMore,
        totalCount: result.totalCount,
      };
      return { success: true, result: history };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  async getExecutionSnapshot() {
    return { success: true, result: null };
  },

  async getContextUsage(_ctx, params) {
    try {
      const { config } = await buildPiSessionConfig(params.sessionKey);
      const usage = await getPiRuntimeService().request<PiContextUsageResult>('session.contextUsage', {
        sessionKey: params.sessionKey,
        payload: { config },
      });
      return {
        success: true,
        result: {
          ...usage,
          accuracy: usage.percent == null ? 'unknown' : 'exact',
          updatedAt: Date.now(),
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  async compactSession(ctx, params) {
    try {
      attachEventSink(ctx);
      const { config } = await buildPiSessionConfig(params.sessionKey);
      await getPiRuntimeService().request('session.compact', {
        sessionKey: params.sessionKey,
        payload: { config },
        timeoutMs: 120_000,
      });
      return { success: true, result: { compacted: true } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
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
