import './windows-hide-preload-entry';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { access, mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AgentSession,
  AgentSessionEvent,
} from '@earendil-works/pi-coding-agent';
import type {
  PiPromptResult,
  PiContextUsageResult,
  PiPromptPayload,
  PiSessionConfig,
  PiWorkerMessage,
  PiWorkerRequest,
  SerializedPiError,
} from '../../shared/pi-runtime-protocol';
import type { NormalizedEngineEvent } from '../gateway/normalized-engine-event';
import {
  DEFAULT_MODEL_CONTEXT_WINDOW,
  DEFAULT_MODEL_MAX_TOKENS,
} from '../../shared/model-runtime-defaults';
import { abortPiActiveRun } from './abort-policy';
import {
  getPiAssistantDisplaySnapshot,
  getPiAssistantError,
  getPiModelCompat,
  getPiTranscriptRevision,
  shouldCompletePiRun,
  startPiAssistantSnapshot,
  updatePiAssistantSnapshot,
} from './event-policy';
import { KeyedTaskQueue } from './keyed-task-queue';
import { filterPiSkills } from './skill-policy';
import { buildPiToolSelection } from './tool-policy';
import { createPiPromptLoggingExtension } from './prompt-logging-extension';
import { buildPiHistoryPage, projectPiHistoryMessages } from './history-page';
import { buildPiSystemPromptOverride } from './system-prompt-policy';
import { importNativeEsm } from './native-esm-import';
import { buildPiAgentExtensions } from '../agent-extensions/adapters/pi';
import { piSessionConfigurationKey } from './session-config-policy';
import { preparePiPromptAttachments } from './prompt-attachments';
import { disposePiSession } from './session-disposal';

type PiSession = {
  session: AgentSession;
  sessionId: string;
  sessionFile?: string;
  configKey: string;
  activeRunId?: string;
  settledRunId?: string;
  lastRunId?: string;
  lastRunStatus?: 'completed' | 'failed';
  lastRunError?: string;
  /** Latest provider error in the active turn; Pi may resolve prompt() after it. */
  terminalAssistantError?: string;
  streamingAssistant?: Record<string, unknown> & { role: 'assistant'; content: Array<Record<string, unknown>> };
  clearExtensionSessionState: () => void;
  setExtensionTurnContext: (context: { runId?: string; systemPromptAppend?: string }) => void;
  unsubscribe: () => void;
};

type PiSdk = typeof import('@earendil-works/pi-coding-agent');
const sessions = new Map<string, PiSession>();
const sessionCommandQueue = new KeyedTaskQueue();
const PI_PROVIDER_MAX_RETRIES = 2;
let sdkPromise: Promise<PiSdk> | null = null;
const parentPort = (process as NodeJS.Process & {
  parentPort?: { on(event: 'message', listener: (event: { data: unknown }) => void): void; postMessage(value: unknown): void };
}).parentPort;

function logPiCore(
  stage: string,
  details: Record<string, unknown> = {},
  multilineBody?: string,
): void {
  const header = `[pi-core] ${stage} ${JSON.stringify(details)}`;
  console.info(multilineBody ? `${header}\n${multilineBody}` : header);
}

function summarizeSessionConfig(config: PiSessionConfig): Record<string, unknown> {
  return {
    sessionKey: config.sessionKey,
    cwd: config.cwd,
    agentDir: config.agentDir,
    projectTrusted: config.projectTrusted === true,
    sessionDir: config.sessionDir,
    sessionFile: config.sessionFile ?? null,
    provider: config.model.provider,
    model: config.model.model,
    accountId: config.model.accountId ?? null,
    baseUrl: config.model.baseUrl ?? null,
    apiProtocol: config.model.apiProtocol ?? null,
    hasApiKey: Boolean(config.model.apiKey),
    headerNames: Object.keys(config.model.headers ?? {}),
    systemPromptChars: config.systemPrompt?.length ?? 0,
    sessionMode: config.sessionMode ?? 'interactive',
    skillRoots: config.skillRoots ?? [],
    selectedSkills: config.selectedSkills?.map((item) => item.slug) ?? [],
    skillSetHash: config.skillSetHash ?? '',
  };
}

function post(message: PiWorkerMessage): void {
  parentPort?.postMessage(message);
}

function loadPiSdk(): Promise<PiSdk> {
  const moduleName: string = '@earendil-works/pi-coding-agent';
  if (!sdkPromise) {
    const startedAt = Date.now();
    logPiCore('sdk.load.start', { moduleName });
    sdkPromise = importNativeEsm<PiSdk>(moduleName).then((sdk) => {
      logPiCore('sdk.load.ready', { moduleName, durationMs: Date.now() - startedAt });
      return sdk;
    }).catch((error: unknown) => {
      logPiCore('sdk.load.failed', { moduleName, durationMs: Date.now() - startedAt, error: serializeError(error).message });
      throw error;
    });
  }
  return sdkPromise;
}

function serializeError(error: unknown): SerializedPiError {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack, code: (error as Error & { code?: string }).code };
  }
  return { message: String(error) };
}

/**
 * PI SDK may return percent=null even when tokens and contextWindow are
 * available (e.g. after compaction). Compute a fallback percentage so the UI
 * never shows "--%" when we have enough data.
 */
function computeFallbackPercent(
  tokens: number | null | undefined,
  contextWindow: number | null | undefined,
): number | null {
  if (tokens == null || contextWindow == null || contextWindow <= 0) return null;
  return Math.round((tokens / contextWindow) * 10_000) / 100;
}

function isRetryExhaustedNetworkError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('request timed out')
    || lower.includes('request timeout')
    || lower.includes('network error')
    || lower.includes('network request failed')
    || lower.includes('connection error')
    || lower.includes('fetch failed')
    || lower.includes('socket')
    || lower.includes('econn')
    || lower.includes('enotfound')
    || lower.includes('eai_again')
    || lower === 'terminated';
}

function respond(requestId: string, success: boolean, result?: unknown, error?: unknown): void {
  post({
    type: 'response',
    requestId,
    success,
    result,
    ...(error ? { error: serializeError(error) } : {}),
  });
}

function emit(sessionKey: string, event: NormalizedEngineEvent): void {
  post({ type: 'engine.event', sessionKey, event });
}

async function disposeSessionEntry(
  entry: PiSession,
  event: {
    type: 'session_shutdown';
    reason: 'quit' | 'reload' | 'new' | 'resume' | 'fork';
    targetSessionFile?: string;
  },
): Promise<void> {
  const startedAt = Date.now();
  logPiCore('session.dispose.start', {
    sessionId: entry.sessionId,
    reason: event.reason,
    targetSessionFile: event.targetSessionFile ?? null,
  });
  const result = await disposePiSession(entry, event);
  for (const failure of result.failures) {
    logPiCore('session.dispose.failed', {
      sessionId: entry.sessionId,
      reason: event.reason,
      stage: failure.stage,
      error: serializeError(failure.error).message,
    });
  }
  logPiCore('session.dispose.completed', {
    sessionId: entry.sessionId,
    reason: event.reason,
    shutdownEmitted: result.shutdownEmitted,
    failureCount: result.failures.length,
    durationMs: Date.now() - startedAt,
  });
}

async function createSession(config: PiSessionConfig): Promise<PiSession> {
  const startedAt = Date.now();
  logPiCore('session.create.start', summarizeSessionConfig(config));
  await Promise.all([mkdir(config.agentDir, { recursive: true }), mkdir(config.sessionDir, { recursive: true }), mkdir(config.cwd, { recursive: true })]);
  logPiCore('session.create.directories-ready', { sessionKey: config.sessionKey, durationMs: Date.now() - startedAt });
  // Scope extension settings and data to SClaw before managed native packages
  // are imported. pi-browser-use computes its default profile during import.
  process.env.PI_CODING_AGENT_DIR = config.agentDir;
  process.env.PI_AGENT_HOME = config.agentDir;
  const sdk = await loadPiSdk();
  const settingsManager = sdk.SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: { enabled: true, maxRetries: PI_PROVIDER_MAX_RETRIES },
  }, {
    projectTrusted: config.projectTrusted === true,
  });
  const unifiedExtensions = config.disableAgentExtensions
    ? {
        extensions: [],
        initiallyActiveToolNames: [],
        diagnostics: [],
        setTurnContext: () => undefined,
        clearSessionState: () => undefined,
      }
    : await buildPiAgentExtensions({
        sessionKey: config.sessionKey,
        cwd: config.cwd,
        agentId: config.agentId ?? (config.sessionKey.startsWith('agent:') ? config.sessionKey.split(':')[1] : 'main'),
        model: config.model.model,
        accountId: config.model.accountId,
        mode: config.sessionMode ?? 'interactive',
      });
  for (const diagnostic of unifiedExtensions.diagnostics) {
    logPiCore('extension.diagnostic', diagnostic as unknown as Record<string, unknown>);
  }
  const { excludedToolNames, initiallyActiveToolNames } = buildPiToolSelection(
    unifiedExtensions.initiallyActiveToolNames,
    process.platform,
  );
  logPiCore('extension.tools-enabled', {
    sessionKey: config.sessionKey,
    mode: config.sessionMode ?? 'interactive',
    excludedTools: excludedToolNames,
    initiallyActiveToolCount: initiallyActiveToolNames.length,
    initiallyActiveTools: initiallyActiveToolNames,
  });
  const managedContextPath = join(config.agentDir, 'AGENTS.md');
  const systemPromptOverride = buildPiSystemPromptOverride(config);
  const loader = new sdk.DefaultResourceLoader({
    cwd: config.cwd,
    agentDir: config.agentDir,
    settingsManager,
    noExtensions: true,
    // Use Pi's native Skill loader for the bounded start-of-turn selection.
    // search_skills plus Pi's native read tool handles runtime misses.
    noSkills: true,
    additionalSkillPaths: config.skillRoots ?? [],
    skillsOverride: (current) => ({
      ...current,
      skills: filterPiSkills(current.skills, config.skillRoots ?? []),
    }),
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    agentsFilesOverride: () => ({
      agentsFiles: existsSync(managedContextPath)
        ? [{ path: managedContextPath, content: readFileSync(managedContextPath, 'utf-8') }]
        : [],
    }),
    // SClaw owns the PI base prompt. The SDK still appends managed AGENTS.md,
    // selected Skills and cwd when it assembles the final system prompt.
    systemPromptOverride: () => systemPromptOverride,
    extensionFactories: [
      ...unifiedExtensions.extensions,
      createPiPromptLoggingExtension({
        sessionKey: config.sessionKey,
        getRunId: () => sessions.get(config.sessionKey)?.activeRunId,
        log: logPiCore,
      }),
    ],
  });
  await loader.reload();
  const loadedSkills = loader.getSkills();
  logPiCore('session.create.resources-ready', {
    sessionKey: config.sessionKey,
    skillCount: loadedSkills.skills.length,
    skills: loadedSkills.skills.map((skill) => skill.name),
    diagnosticCount: loadedSkills.diagnostics.length,
    hasManagedContext: existsSync(managedContextPath),
    durationMs: Date.now() - startedAt,
  });

  const modelRuntime = await sdk.ModelRuntime.create({
    modelsPath: null,
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  const providerId = config.model.provider;
  let model = modelRuntime.getModel(providerId, config.model.model);
  logPiCore('session.create.model-lookup', {
    sessionKey: config.sessionKey,
    provider: providerId,
    model: config.model.model,
    foundBuiltin: Boolean(model),
  });
  if (!model && config.model.baseUrl) {
    const resolvedContextWindow = config.model.contextWindow ?? DEFAULT_MODEL_CONTEXT_WINDOW;
    modelRuntime.registerProvider(providerId, {
      baseUrl: config.model.baseUrl,
      apiKey: config.model.apiKey || 'sclaw-runtime-key',
      api: config.model.apiProtocol ?? 'openai-completions',
      headers: config.model.headers,
      models: [{
        id: config.model.model,
        name: config.model.model,
        reasoning: false,
        input: ['text', 'image'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: resolvedContextWindow,
        maxTokens: DEFAULT_MODEL_MAX_TOKENS,
        compat: getPiModelCompat(config.model.apiProtocol),
      }],
    });
    model = modelRuntime.getModel(providerId, config.model.model);
    logPiCore('session.create.provider-registered', {
      sessionKey: config.sessionKey,
      provider: providerId,
      model: config.model.model,
      baseUrl: config.model.baseUrl,
      apiProtocol: config.model.apiProtocol ?? 'openai-completions',
      contextWindow: resolvedContextWindow,
    });
  }
  if (config.model.apiKey) {
    await modelRuntime.setRuntimeApiKey(providerId, config.model.apiKey);
    logPiCore('session.create.runtime-key-set', { sessionKey: config.sessionKey, provider: providerId });
  }
  if (!model) throw new Error(`Pi model not found: ${providerId}/${config.model.model}`);

  const resumesExistingSession = Boolean(config.sessionFile);
  const sessionManager = config.sessionFile
    ? sdk.SessionManager.open(config.sessionFile, config.sessionDir, config.cwd)
    : sdk.SessionManager.create(config.cwd, config.sessionDir);
  logPiCore('session.create.session-manager-ready', {
    sessionKey: config.sessionKey,
    mode: resumesExistingSession ? 'open' : 'create',
    sessionFile: config.sessionFile ?? null,
  });
  const { session } = await sdk.createAgentSession({
    cwd: config.cwd,
    agentDir: config.agentDir,
    model,
    modelRuntime,
    settingsManager,
    resourceLoader: loader,
    sessionManager,
    excludeTools: excludedToolNames,
  });
  // Keep lazy static tools disabled before session_start. Pi automatically makes
  // tools registered by reviewed factories during the event active.
  session.setActiveToolsByName(initiallyActiveToolNames);
  await session.bindExtensions({
    mode: 'rpc',
    onError: (error) => logPiCore('extension.error', error as unknown as Record<string, unknown>),
  });
  logPiCore('extension.lifecycle.bound', {
    sessionKey: config.sessionKey,
    availableToolCount: session.getAllTools().length,
    activeToolCount: session.getActiveToolNames().length,
    activeTools: session.getActiveToolNames(),
  });

  const entry: PiSession = {
    session,
    sessionId: session.sessionId,
    sessionFile: session.sessionFile,
    configKey: piSessionConfigurationKey(config),
    clearExtensionSessionState: unifiedExtensions.clearSessionState,
    setExtensionTurnContext: unifiedExtensions.setTurnContext,
    unsubscribe: () => {},
  };
  let activeCompaction: { attemptId: string; startedAt: number; reason: 'manual' | 'threshold' | 'overflow' } | null = null;
  entry.unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    const runId = entry.activeRunId;
    if (!runId) return;
    switch (event?.type) {
      case 'agent_start':
        logPiCore('event.agent-start', { sessionKey: config.sessionKey, runId });
        emit(config.sessionKey, { type: 'turn.started', sessionKey: config.sessionKey, runId });
        break;
      case 'message_start':
        logPiCore('event.message-start', {
          sessionKey: config.sessionKey,
          runId,
          role: event.message.role,
        });
        entry.streamingAssistant = startPiAssistantSnapshot(event.message, `pi-stream-${runId}`);
        break;
      case 'message_update': {
        entry.streamingAssistant = updatePiAssistantSnapshot(
          entry.streamingAssistant,
          event.assistantMessageEvent,
          `pi-stream-${runId}`,
        );
        if (entry.streamingAssistant) {
          const displaySnapshot = getPiAssistantDisplaySnapshot(
            entry.streamingAssistant,
            event.assistantMessageEvent,
          );
          emit(config.sessionKey, {
            type: 'message.delta', sessionKey: config.sessionKey, runId,
            message: displaySnapshot ?? entry.streamingAssistant,
          });
        }
        break;
      }
      case 'message_end': {
        const message = event.message;
        logPiCore('event.message-end', {
          sessionKey: config.sessionKey,
          runId,
          role: message.role,
          stopReason: message.role === 'assistant' ? message.stopReason : undefined,
        });
        if (message?.role === 'assistant') {
          const errorMessage = getPiAssistantError(message);
          if (errorMessage) {
            // An assistant error message is not a terminal signal. Pi may still
            // retry the provider request (retry.maxRetries) or be unwinding the
            // active agent. Releasing this lock here lets a follow-up race that
            // work and leaves the upstream Agent reporting "already processing".
            // The prompt promise's reject path below is the sole failure
            // terminal: it emits turn.failed only after Pi has settled.
            logPiCore('event.assistant-error-awaiting-settle', {
              sessionKey: config.sessionKey,
              runId,
              error: errorMessage,
            });
            entry.terminalAssistantError = errorMessage;
            entry.streamingAssistant = undefined;
            break;
          }
          entry.terminalAssistantError = undefined;
          emit(config.sessionKey, { type: 'message.final', sessionKey: config.sessionKey, runId, message });
          const contextUsage = entry.session.getContextUsage();
          const resolvedContextWindow = contextUsage?.contextWindow ?? entry.session.model?.contextWindow ?? null;
          const resolvedPercent = contextUsage?.percent ?? computeFallbackPercent(contextUsage?.tokens, resolvedContextWindow);
          emit(config.sessionKey, {
            type: 'context.usage.updated',
            sessionKey: config.sessionKey,
            runId,
            usage: {
              tokens: contextUsage?.tokens ?? null,
              contextWindow: resolvedContextWindow,
              percent: resolvedPercent,
              accuracy: resolvedPercent != null ? 'exact' : 'unknown',
              updatedAt: Date.now(),
            },
          });
          logPiCore('event.context-usage', {
            sessionKey: config.sessionKey,
            runId,
            model: config.model.model,
            contextTokens: contextUsage?.tokens ?? null,
            contextWindow: resolvedContextWindow,
            contextPercent: resolvedPercent,
            compactionTriggered: false,
          });
          entry.streamingAssistant = undefined;
        } else if (message.role === 'toolResult') {
          emit(config.sessionKey, { type: 'tool.result', sessionKey: config.sessionKey, runId, message });
        }
        break;
      }
      case 'agent_settled':
        // Complete from the matching prompt promise. The official SDK resolves
        // that promise only after agent_settled and all listeners have finished.
        entry.settledRunId = runId;
        logPiCore('event.agent-settled', { sessionKey: config.sessionKey, runId });
        break;
      case 'compaction_start': {
        activeCompaction = {
          attemptId: randomUUID(),
          startedAt: Date.now(),
          reason: event.reason,
        };
        const compactionStartUsage = entry.session.getContextUsage();
        logPiCore('event.compaction-start', {
          sessionKey: config.sessionKey,
          runId,
          attemptId: activeCompaction.attemptId,
          reason: event.reason,
          contextTokens: compactionStartUsage?.tokens ?? null,
          contextWindow: entry.session.model?.contextWindow ?? null,
          contextPercent: compactionStartUsage?.percent ?? null,
        });
        emit(config.sessionKey, {
          type: 'context.compaction.started',
          sessionKey: config.sessionKey,
          runId,
          attemptId: activeCompaction.attemptId,
          reason: event.reason,
        });
        break;
      }
      case 'compaction_end': {
        const attempt = activeCompaction ?? {
          attemptId: randomUUID(),
          startedAt: Date.now(),
          reason: event.reason,
        };
        const durationMs = Date.now() - attempt.startedAt;
        if (event.result && !event.aborted && !event.errorMessage) {
          emit(config.sessionKey, {
            type: 'context.compaction.completed',
            sessionKey: config.sessionKey,
            runId,
            attemptId: attempt.attemptId,
            reason: event.reason,
            tokensBefore: event.result.tokensBefore,
            tokensAfter: event.result.estimatedTokensAfter,
            durationMs,
          });
        } else {
          emit(config.sessionKey, {
            type: 'context.compaction.failed',
            sessionKey: config.sessionKey,
            runId,
            attemptId: attempt.attemptId,
            reason: event.reason,
            willRetry: event.willRetry,
            errorMessage: event.errorMessage ?? (event.aborted ? 'Context compaction was aborted' : undefined),
            durationMs,
          });
        }
        activeCompaction = null;
        const contextUsage = entry.session.getContextUsage();
        const resolvedContextWindow = contextUsage?.contextWindow ?? entry.session.model?.contextWindow ?? null;
        const resolvedPercent = contextUsage?.percent ?? computeFallbackPercent(contextUsage?.tokens, resolvedContextWindow);
        logPiCore('event.compaction-end', {
          sessionKey: config.sessionKey,
          runId,
          attemptId: attempt.attemptId,
          reason: event.reason,
          success: Boolean(event.result && !event.aborted && !event.errorMessage),
          aborted: event.aborted,
          willRetry: event.willRetry,
          durationMs,
          tokensBefore: event.result?.tokensBefore ?? null,
          tokensAfter: event.result?.estimatedTokensAfter ?? null,
          contextWindow: entry.session.model?.contextWindow ?? null,
          contextPercentAfter: resolvedPercent,
        });
        emit(config.sessionKey, {
          type: 'context.usage.updated',
          sessionKey: config.sessionKey,
          runId,
          usage: {
            tokens: contextUsage?.tokens ?? null,
            contextWindow: resolvedContextWindow,
            percent: resolvedPercent,
            accuracy: resolvedPercent != null ? 'exact' : 'unknown',
            updatedAt: Date.now(),
          },
        });
        break;
      }
    }
  });
  logPiCore('session.create.ready', {
    sessionKey: config.sessionKey,
    sessionId: entry.sessionId,
    sessionFile: entry.sessionFile ?? null,
    resumed: resumesExistingSession,
    messageCount: session.messages.length,
    durationMs: Date.now() - startedAt,
  });
  return entry;
}

async function ensureSession(config: PiSessionConfig): Promise<PiSession> {
  const existing = sessions.get(config.sessionKey);
  const nextKey = piSessionConfigurationKey(config);
  if (existing?.configKey === nextKey) {
    logPiCore('session.ensure.reuse', { sessionKey: config.sessionKey, sessionId: existing.sessionId });
    return existing;
  }
  if (existing?.activeRunId) throw new Error(`Pi session is currently running: ${config.sessionKey}`);
  if (existing) {
    logPiCore('session.ensure.replace', {
      sessionKey: config.sessionKey,
      sessionId: existing.sessionId,
      reason: 'configuration-changed',
    });
    await disposeSessionEntry(existing, {
      type: 'session_shutdown',
      // Configuration replacement keeps the same logical chat and activation state.
      reason: 'reload',
      targetSessionFile: existing.sessionFile,
    });
    sessions.delete(config.sessionKey);
  }
  const created = await createSession(config);
  sessions.set(config.sessionKey, created);
  logPiCore('session.ensure.stored', { sessionKey: config.sessionKey, sessionId: created.sessionId, sessionCount: sessions.size });
  return created;
}

async function handle(request: PiWorkerRequest): Promise<void> {
  const payload = request.payload ?? {};
  const commandStartedAt = Date.now();
  logPiCore('command.received', {
    requestId: request.requestId,
    command: request.command,
    sessionKey: request.sessionKey ?? null,
    payloadKeys: Object.keys(payload),
  });
  switch (request.command) {
    case 'runtime.initialize':
      respond(request.requestId, true, { ready: true });
      logPiCore('command.completed', { requestId: request.requestId, command: request.command, durationMs: Date.now() - commandStartedAt });
      return;
    case 'session.open': {
      const entry = await ensureSession(payload.config as unknown as PiSessionConfig);
      respond(request.requestId, true, { sessionId: entry.sessionId, sessionFile: entry.sessionFile });
      logPiCore('command.completed', { requestId: request.requestId, command: request.command, sessionKey: request.sessionKey ?? null, durationMs: Date.now() - commandStartedAt });
      return;
    }
    case 'session.prompt': {
      const promptPayload = payload as unknown as PiPromptPayload;
      const config = promptPayload.config;
      const entry = await ensureSession(config);
      if (entry.activeRunId) throw new Error(`Pi session is already running: ${config.sessionKey}`);
      const sdk = await loadPiSdk();
      const media = Array.isArray(promptPayload.media) ? promptPayload.media : [];
      let prepared: Awaited<ReturnType<typeof preparePiPromptAttachments>>;
      try {
        prepared = await preparePiPromptAttachments({
          message: String(promptPayload.message ?? ''),
          media,
          cwd: config.cwd,
          modelSupportsImages: entry.session.model.input.includes('image'),
          imageApi: sdk,
          referencesEmbedded: promptPayload.referencesEmbedded,
        });
      } catch (error) {
        logPiCore('session.prompt.attachments-failed', {
          requestId: request.requestId,
          sessionKey: config.sessionKey,
          attachmentCount: media.length,
          attachments: media.map((attachment) => ({
            fileName: attachment.fileName,
            suppliedMimeType: attachment.mimeType,
          })),
          failureReason: serializeError(error).message,
        });
        throw error;
      }
      logPiCore('session.prompt.attachments-prepared', {
        requestId: request.requestId,
        sessionKey: config.sessionKey,
        imageCount: prepared.imageCount,
        fileReferenceCount: prepared.fileReferenceCount,
        attachments: prepared.attachments,
      });
      const runId = String(promptPayload.runId || randomUUID());
      entry.activeRunId = runId;
      entry.settledRunId = undefined;
      entry.lastRunId = runId;
      entry.lastRunStatus = undefined;
      entry.lastRunError = undefined;
      entry.terminalAssistantError = undefined;
      entry.streamingAssistant = undefined;
      entry.setExtensionTurnContext({
        runId,
        systemPromptAppend: promptPayload.systemPromptAppend,
      });
      const result: PiPromptResult = { runId, sessionId: entry.sessionId, sessionFile: entry.sessionFile };
      respond(request.requestId, true, result);
      logPiCore('session.prompt.accepted', {
        requestId: request.requestId,
        sessionKey: config.sessionKey,
        runId,
        messageChars: prepared.message.length,
        imageCount: prepared.imageCount,
        fileReferenceCount: prepared.fileReferenceCount,
        durationMs: Date.now() - commandStartedAt,
      });
      void entry.session.prompt(prepared.message, { images: prepared.images, source: 'rpc' })
        .then(() => {
          if (!shouldCompletePiRun(entry.activeRunId, entry.settledRunId, runId)) return;
          const errorMessage = entry.terminalAssistantError;
          if (errorMessage) {
            entry.lastRunId = runId;
            entry.lastRunStatus = 'failed';
            entry.lastRunError = errorMessage;
            logPiCore('session.prompt.settled-with-error', {
              sessionKey: config.sessionKey,
              runId,
              error: errorMessage,
            });
            emit(config.sessionKey, {
              type: 'turn.failed',
              sessionKey: config.sessionKey,
              runId,
              errorMessage,
              ...(isRetryExhaustedNetworkError(errorMessage) ? {
                reason: 'network-retry-exhausted' as const,
                retryAttempts: PI_PROVIDER_MAX_RETRIES,
              } : {}),
            });
            entry.activeRunId = undefined;
            entry.settledRunId = undefined;
            entry.streamingAssistant = undefined;
            entry.terminalAssistantError = undefined;
            return;
          }
          logPiCore('session.prompt.completed', { sessionKey: config.sessionKey, runId });
          entry.lastRunId = runId;
          entry.lastRunStatus = 'completed';
          entry.lastRunError = undefined;
          emit(config.sessionKey, { type: 'turn.completed', sessionKey: config.sessionKey, runId });
          entry.activeRunId = undefined;
          entry.settledRunId = undefined;
          entry.streamingAssistant = undefined;
          entry.terminalAssistantError = undefined;
        })
        .catch((error: unknown) => {
          if (entry.activeRunId !== runId) return;
          const errorMessage = serializeError(error).message;
          entry.lastRunId = runId;
          entry.lastRunStatus = 'failed';
          entry.lastRunError = errorMessage;
          logPiCore('session.prompt.failed', { sessionKey: config.sessionKey, runId, error: errorMessage });
          emit(config.sessionKey, {
            type: 'turn.failed',
            sessionKey: config.sessionKey,
            runId,
            errorMessage,
            ...(isRetryExhaustedNetworkError(errorMessage) ? {
              reason: 'network-retry-exhausted' as const,
              retryAttempts: PI_PROVIDER_MAX_RETRIES,
            } : {}),
          });
          entry.activeRunId = undefined;
          entry.settledRunId = undefined;
          entry.streamingAssistant = undefined;
          entry.terminalAssistantError = undefined;
        });
      return;
    }
    case 'session.abort': {
      const entry = request.sessionKey ? sessions.get(request.sessionKey) : undefined;
      logPiCore('session.abort.start', { sessionKey: request.sessionKey ?? null, activeRunId: entry?.activeRunId ?? null });
      await abortPiActiveRun(entry, {
        emitAborted: (runId) => emit(request.sessionKey!, {
          type: 'turn.aborted', sessionKey: request.sessionKey, runId,
        }),
        respond: (aborted, runId) => {
          respond(request.requestId, true, {
            aborted,
            runIds: aborted && runId ? [runId] : [],
          });
          logPiCore('session.abort.accepted', {
            requestId: request.requestId,
            sessionKey: request.sessionKey ?? null,
            aborted,
            runId: runId ?? null,
            durationMs: Date.now() - commandStartedAt,
          });
        },
      });
      return;
    }
    case 'session.history': {
      const config = payload.config as unknown as PiSessionConfig;
      // A history read must never replace a live in-memory session. Send-time
      // system context (for example injected Memory) can differ from the base
      // config used by chat.history; reopening here races Pi's final JSONL flush
      // and briefly projects a stale transcript over the completed live reply.
      const entry = sessions.get(config.sessionKey) ?? await ensureSession(config);
      const limit = typeof payload.limit === 'number' && Number.isFinite(payload.limit) && payload.limit > 0
        ? Math.floor(payload.limit)
        : 50;
      const beforeId = typeof payload.beforeId === 'string' && payload.beforeId
        ? payload.beforeId
        : undefined;
      const branchEntries = entry.session.sessionManager.getBranch();
      const historyMessages = projectPiHistoryMessages(branchEntries);
      const page = buildPiHistoryPage(historyMessages, { limit, beforeId });
      respond(request.requestId, true, {
        messages: page.messages,
        isRunning: Boolean(entry.activeRunId),
        hasMore: page.hasMore,
        totalCount: page.totalCount,
      });
      logPiCore('session.history.completed', {
        sessionKey: config.sessionKey,
        messageCount: page.messages.length,
        branchEntryCount: branchEntries.length,
        totalCount: page.totalCount,
        hasMore: page.hasMore,
        beforeId: beforeId ?? null,
        isRunning: Boolean(entry.activeRunId),
        durationMs: Date.now() - commandStartedAt,
      });
      return;
    }
    case 'session.inspect': {
      const entry = request.sessionKey ? sessions.get(request.sessionKey) : undefined;
      if (!entry) {
        respond(request.requestId, true, { status: 'not_started' });
        logPiCore('session.inspect.completed', { sessionKey: request.sessionKey ?? null, status: 'not_started' });
        return;
      }
      const messages = entry.session.messages as unknown[];
      const status = entry.activeRunId
        ? 'active'
        : entry.lastRunStatus === 'failed'
          ? 'failed'
          : 'completed';
      respond(request.requestId, true, {
        status,
        runId: entry.activeRunId ?? entry.lastRunId,
        ...(status === 'failed' && entry.lastRunError ? { reason: entry.lastRunError } : {}),
        currentTurnMessages: messages,
        transcriptRevision: getPiTranscriptRevision(messages),
      });
      logPiCore('session.inspect.completed', {
        sessionKey: request.sessionKey ?? null,
        status,
        runId: entry.activeRunId ?? entry.lastRunId ?? null,
        messageCount: messages.length,
      });
      return;
    }
    case 'session.contextUsage': {
      const config = payload.config as unknown as PiSessionConfig;
      const entry = sessions.get(config.sessionKey) ?? await ensureSession(config);
      const usage = entry.session.getContextUsage();
      const result: PiContextUsageResult = {
        tokens: usage?.tokens ?? null,
        contextWindow: usage?.contextWindow ?? entry.session.model?.contextWindow ?? null,
        percent: usage?.percent ?? null,
      };
      respond(request.requestId, true, result);
      return;
    }
    case 'session.compact': {
      const config = payload.config as unknown as PiSessionConfig;
      const entry = sessions.get(config.sessionKey) ?? await ensureSession(config);
      if (entry.activeRunId) throw new Error('RUN_ACTIVE: wait for the current response to finish');
      if (entry.session.isCompacting) throw new Error('COMPACTION_IN_PROGRESS');
      const attemptId = randomUUID();
      const startedAt = Date.now();
      const before = entry.session.getContextUsage();
      logPiCore('event.compaction-start', {
        sessionKey: config.sessionKey,
        attemptId,
        reason: 'manual',
        contextTokens: before?.tokens ?? null,
        contextWindow: entry.session.model?.contextWindow ?? null,
        contextPercent: before?.percent ?? null,
      });
      emit(config.sessionKey, {
        type: 'context.compaction.started',
        sessionKey: config.sessionKey,
        attemptId,
        reason: 'manual',
        tokensBefore: before?.tokens ?? undefined,
      });
      try {
        const result = await entry.session.compact();
        const after = entry.session.getContextUsage();
        // PI SDK may return null tokens after compaction; fall back to
        // estimatedTokensAfter from the compact() result so the UI can show
        // a meaningful percentage instead of "--%".
        const resolvedTokens = after?.tokens ?? result.estimatedTokensAfter ?? null;
        const resolvedContextWindow = after?.contextWindow ?? entry.session.model?.contextWindow ?? null;
        const resolvedPercent = after?.percent ?? computeFallbackPercent(resolvedTokens, resolvedContextWindow);
        emit(config.sessionKey, {
          type: 'context.compaction.completed',
          sessionKey: config.sessionKey,
          attemptId,
          reason: 'manual',
          tokensBefore: result.tokensBefore,
          tokensAfter: resolvedTokens ?? undefined,
          durationMs: Date.now() - startedAt,
        });
        const usage: PiContextUsageResult = {
          tokens: resolvedTokens,
          contextWindow: resolvedContextWindow,
          percent: resolvedPercent,
        };
        emit(config.sessionKey, {
          type: 'context.usage.updated',
          sessionKey: config.sessionKey,
          usage: {
            ...usage,
            accuracy: usage.percent == null ? 'unknown' : 'exact',
            updatedAt: Date.now(),
          },
        });
        logPiCore('event.compaction-end', {
          sessionKey: config.sessionKey,
          attemptId,
          reason: 'manual',
          success: true,
          durationMs: Date.now() - startedAt,
          tokensBefore: result.tokensBefore ?? null,
          tokensAfter: resolvedTokens ?? null,
          contextWindow: resolvedContextWindow,
          contextPercentAfter: resolvedPercent,
        });
        respond(request.requestId, true, { compacted: true, usage });
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        logPiCore('event.compaction-end', {
          sessionKey: config.sessionKey,
          attemptId,
          reason: 'manual',
          success: false,
          durationMs,
          error: serializeError(error).message,
          contextWindow: entry.session.model?.contextWindow ?? null,
        });
        emit(config.sessionKey, {
          type: 'context.compaction.failed',
          sessionKey: config.sessionKey,
          attemptId,
          reason: 'manual',
          willRetry: false,
          errorMessage: serializeError(error).message,
          durationMs,
        });
        throw error;
      }
      return;
    }
    case 'session.delete': {
      const entry = request.sessionKey ? sessions.get(request.sessionKey) : undefined;
      if (entry) {
        logPiCore('session.delete.dispose', { sessionKey: request.sessionKey ?? null, sessionId: entry.sessionId });
        await entry.session.abort().catch(() => {});
        await disposeSessionEntry(entry, { type: 'session_shutdown', reason: 'quit' });
        sessions.delete(request.sessionKey!);
      }
      const sessionFile = typeof payload.sessionFile === 'string' ? payload.sessionFile : undefined;
      if (sessionFile) await rm(sessionFile, { force: true });
      respond(request.requestId, true, { deleted: true });
      logPiCore('session.delete.completed', { sessionKey: request.sessionKey ?? null, sessionFile: sessionFile ?? null, sessionCount: sessions.size });
      return;
    }
    case 'runtime.shutdown':
      logPiCore('runtime.shutdown.start', { sessionCount: sessions.size });
      for (const entry of sessions.values()) {
        await entry.session.abort().catch(() => {});
        await disposeSessionEntry(entry, { type: 'session_shutdown', reason: 'quit' });
      }
      sessions.clear();
      respond(request.requestId, true, { stopped: true });
      logPiCore('runtime.shutdown.completed');
      process.exit(0);
  }
}

parentPort?.on('message', (event) => {
  const request = event.data as PiWorkerRequest;
  const sessionKey = request.sessionKey?.trim();
  const operation = sessionKey
    ? sessionCommandQueue.run(sessionKey, () => handle(request))
    : handle(request);
  void operation.catch((error) => {
    logPiCore('command.failed', {
      requestId: request.requestId,
      command: request.command,
      sessionKey: request.sessionKey ?? null,
      error: serializeError(error).message,
    });
    respond(request.requestId, false, undefined, error);
  });
});

logPiCore('runtime.bootstrap.start', { cwd: process.cwd(), pid: process.pid });
void Promise.all([access(process.cwd()), stat(process.cwd()), loadPiSdk()])
  .then(() => {
    logPiCore('runtime.bootstrap.ready', { cwd: process.cwd(), pid: process.pid });
    post({ type: 'runtime.ready' });
  })
  .catch((error) => {
    logPiCore('runtime.bootstrap.failed', { error: serializeError(error).message });
    post({ type: 'runtime.failed', error: serializeError(error) });
  });
