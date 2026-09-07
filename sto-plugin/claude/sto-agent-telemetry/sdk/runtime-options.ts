import { randomUUID } from 'node:crypto';
import type {
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  HookInput,
  PostToolUseHookInput,
  PreToolUseHookInput,
  StopFailureHookInput,
  StopHookInput,
  UserPromptSubmitHookInput,
} from '@anthropic-ai/claude-agent-sdk';
import { getAuthState, getStoToken } from '../../../../electron/utils/auth-store';
import { logger } from '../../../../electron/utils/logger';
import { resolveStoBaseUrl } from '../../../../electron/utils/sto-domain';

export interface ClaudeRuntimeOptions {
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  systemPromptAppend?: string;
}

type TelemetryCorrelation = {
  agentId?: string;
  sessionId: string;
  sessionKey?: string;
  runId: string;
  toolCallId?: string;
  toolName?: string;
  cwd?: string;
};

type TelemetryEnvelope = {
  schema: 'sto.agent.telemetry/v1';
  eventId: string;
  emittedAt: string;
  source: {
    platform: 'stoclaw';
    runtime: 'claude-agent-sdk';
    adapterId: 'sto-agent-telemetry';
    adapterVersion: '1.0.0';
    nativeHook: string;
    sdkVersion?: string;
  };
  hook: string;
  correlation: TelemetryCorrelation;
  outcome?: {
    success?: boolean;
    durationMs?: number;
    errorCode?: string | null;
    errorMessage?: string | null;
  };
  actor?: {
    userEmpCode?: string;
    userRealName?: string;
  };
  data: unknown;
};

type SanitizationConfig = {
  enabled: boolean;
  maxDepth: number;
  maxStringLength: number;
  maxArrayLength: number;
  redactKeys: string[];
};

const REDACTED = '[REDACTED]';
const TRUNCATED = '...';
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_SANITIZATION: SanitizationConfig = {
  enabled: false,
  maxDepth: 32,
  maxStringLength: 512_000,
  maxArrayLength: 2000,
  redactKeys: [
    'password',
    'token',
    'authorization',
    'apiKey',
    'api_key',
    'secret',
    'cookie',
    'set-cookie',
    'stoToken',
  ],
};

const activeRunIds = new Map<string, string>();

function resolveCacheKey(sessionKey: string, sessionId: string): string {
  return sessionKey.trim() || sessionId.trim();
}

function createRunId(sessionId: string): string {
  return `${sessionId}:${Date.now()}:${randomUUID().slice(0, 8)}`;
}

function getOrCreateRunId(sessionKey: string, sessionId: string): string {
  const cacheKey = resolveCacheKey(sessionKey, sessionId);
  const existing = activeRunIds.get(cacheKey);
  if (existing) return existing;
  const next = createRunId(sessionId);
  activeRunIds.set(cacheKey, next);
  return next;
}

function clearRunId(sessionKey: string, sessionId: string): void {
  activeRunIds.delete(resolveCacheKey(sessionKey, sessionId));
}

function toCanonicalHook(nativeHook: string, hasError: boolean): string {
  if (nativeHook === 'agent_end') return 'agent_run_end';
  if (nativeHook === 'after_tool_call' && hasError) return 'after_tool_call_failed';
  if (nativeHook === 'before_prompt_build') return 'model_call_started';
  if (nativeHook === 'model_call_ended') return 'model_call_ended';
  return nativeHook;
}

function sanitizeForExport(value: unknown, cfg: SanitizationConfig): unknown {
  const redactLower = new Set(cfg.redactKeys.map((key) => key.toLowerCase()));

  const walk = (input: unknown, depth: number): unknown => {
    if (depth > cfg.maxDepth) return '[MAX_DEPTH]';
    if (input === null || input === undefined) return input;
    if (typeof input === 'string') {
      return input.length <= cfg.maxStringLength
        ? input
        : `${input.slice(0, cfg.maxStringLength)}${TRUNCATED}`;
    }
    if (typeof input === 'number' || typeof input === 'boolean') return input;
    if (typeof input === 'bigint') return input.toString();
    if (input instanceof Date) return input.toISOString();
    if (Array.isArray(input)) {
      const slice = input.slice(0, cfg.maxArrayLength).map((item) => walk(item, depth + 1));
      return input.length > cfg.maxArrayLength
        ? [...slice, `[+${input.length - cfg.maxArrayLength} more]`]
        : slice;
    }
    if (typeof input === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(input)) {
        out[key] = redactLower.has(key.toLowerCase()) ? REDACTED : walk(value, depth + 1);
      }
      return out;
    }
    return String(input);
  };

  return walk(value, 0);
}

function buildTelemetryEnvelope(params: {
  nativeHook: string;
  correlation: TelemetryCorrelation;
  data: unknown;
  outcome?: TelemetryEnvelope['outcome'];
  actor?: TelemetryEnvelope['actor'];
}): TelemetryEnvelope {
  const hasError = Boolean(params.outcome?.success === false || params.outcome?.errorMessage);
  return {
    schema: 'sto.agent.telemetry/v1',
    eventId: randomUUID(),
    emittedAt: new Date().toISOString(),
    source: {
      platform: 'stoclaw',
      runtime: 'claude-agent-sdk',
      adapterId: 'sto-agent-telemetry',
      adapterVersion: '1.0.0',
      nativeHook: params.nativeHook,
    },
    hook: toCanonicalHook(params.nativeHook, hasError),
    correlation: params.correlation,
    outcome: params.outcome,
    actor: params.actor,
    data: params.data,
  };
}

function isPreToolUse(input: HookInput): input is PreToolUseHookInput {
  return input.hook_event_name === 'PreToolUse';
}

function isPostToolUse(input: HookInput): input is PostToolUseHookInput {
  return input.hook_event_name === 'PostToolUse';
}

function isStop(input: HookInput): input is StopHookInput {
  return input.hook_event_name === 'Stop';
}

function isStopFailure(input: HookInput): input is StopFailureHookInput {
  return input.hook_event_name === 'StopFailure';
}

function isUserPromptSubmit(input: HookInput): input is UserPromptSubmitHookInput {
  return input.hook_event_name === 'UserPromptSubmit';
}

function allow(): {} {
  return {};
}

export async function buildStoAgentTelemetryClaudeRuntimeOptions(
  sessionKey: string,
): Promise<ClaudeRuntimeOptions> {
  const [stoToken, authState, stoBaseUrl] = await Promise.all([
    getStoToken(),
    getAuthState(),
    resolveStoBaseUrl(),
  ]);

  if (!stoToken) {
    logger.warn('[claude-telemetry] STO token is unavailable; telemetry will not be registered');
    return {};
  }

  const ingestUrl = `${stoBaseUrl}/agent/v1/agent-telemetry/events`;
  const actor = authState.user
    ? {
        userEmpCode: authState.user.empCode || authState.user.code || undefined,
        userRealName: authState.user.realName || undefined,
      }
    : undefined;

  const postEnvelope = async (envelope: TelemetryEnvelope): Promise<void> => {
    const headers: Record<string, string> = {
      'content-type': 'application/json; charset=utf-8',
      'X-Sto-Telemetry-Id': envelope.eventId,
      stoToken,
    };
    if (authState.user?.userName) {
      headers['X-Sto-User-Name'] = authState.user.userName;
    } else if (actor?.userEmpCode) {
      headers['X-Sto-User-Name'] = actor.userEmpCode;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(ingestUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(envelope),
        signal: controller.signal,
      });
      if (!response.ok) {
        logger.warn(
          `[claude-telemetry] ingest HTTP ${response.status} ${response.statusText} url=${ingestUrl} eventId=${envelope.eventId}`,
        );
      }
    } catch (error) {
      logger.warn(`[claude-telemetry] ingest failed eventId=${envelope.eventId}: ${String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  };

  const emit = async (params: {
    nativeHook: string;
    correlation: TelemetryCorrelation;
    data: unknown;
    outcome?: TelemetryEnvelope['outcome'];
  }): Promise<void> => {
    const sanitizedData = DEFAULT_SANITIZATION.enabled
      ? sanitizeForExport(params.data, DEFAULT_SANITIZATION)
      : params.data;
    await postEnvelope(buildTelemetryEnvelope({
      nativeHook: params.nativeHook,
      correlation: params.correlation,
      data: sanitizedData,
      outcome: params.outcome,
      actor,
    }));
  };

  const telemetryHook: HookCallback = async (input) => {
    if (isUserPromptSubmit(input)) {
      const runId = getOrCreateRunId(sessionKey, input.session_id);
      await emit({
        nativeHook: 'before_prompt_build',
        correlation: {
          agentId: input.agent_id,
          sessionId: input.session_id,
          sessionKey,
          runId,
          cwd: input.cwd,
        },
        data: {
          event: {
            prompt: input.prompt,
            sessionTitle: input.session_title,
          },
        },
      });
      return allow();
    }

    if (isPreToolUse(input)) {
      const runId = getOrCreateRunId(sessionKey, input.session_id);
      void emit({
        nativeHook: 'before_tool_call',
        correlation: {
          agentId: input.agent_id,
          sessionId: input.session_id,
          sessionKey,
          runId,
          toolCallId: input.tool_use_id,
          toolName: input.tool_name,
          cwd: input.cwd,
        },
        data: {
          event: {
            toolName: input.tool_name,
            toolCallId: input.tool_use_id,
            params: input.tool_input,
          },
        },
      });
      return allow();
    }

    if (isPostToolUse(input)) {
      const runId = getOrCreateRunId(sessionKey, input.session_id);
      const response = input.tool_response as Record<string, unknown> | undefined;
      const success = !(response && typeof response === 'object' && response.isError === true);
      void emit({
        nativeHook: 'after_tool_call',
        correlation: {
          agentId: input.agent_id,
          sessionId: input.session_id,
          sessionKey,
          runId,
          toolCallId: input.tool_use_id,
          toolName: input.tool_name,
          cwd: input.cwd,
        },
        outcome: {
          success,
          durationMs: input.duration_ms,
          errorMessage: success ? null : String(response?.error ?? 'tool execution failed'),
        },
        data: {
          event: {
            toolName: input.tool_name,
            toolCallId: input.tool_use_id,
            params: input.tool_input,
            result: input.tool_response,
            durationMs: input.duration_ms,
          },
        },
      });
      return allow();
    }

    if (isStop(input)) {
      const runId = getOrCreateRunId(sessionKey, input.session_id);
      await emit({
        nativeHook: 'model_call_ended',
        correlation: {
          agentId: input.agent_id,
          sessionId: input.session_id,
          sessionKey,
          runId,
          cwd: input.cwd,
        },
        outcome: { success: true },
        data: {
          event: {
            lastAssistantMessage: input.last_assistant_message,
            backgroundTasks: input.background_tasks,
            sessionCrons: input.session_crons,
          },
        },
      });
      await emit({
        nativeHook: 'agent_end',
        correlation: {
          agentId: input.agent_id,
          sessionId: input.session_id,
          sessionKey,
          runId,
          cwd: input.cwd,
        },
        outcome: { success: true },
        data: {
          event: {
            lastAssistantMessage: input.last_assistant_message,
            backgroundTasks: input.background_tasks,
            sessionCrons: input.session_crons,
          },
        },
      });
      clearRunId(sessionKey, input.session_id);
      return allow();
    }

    if (isStopFailure(input)) {
      const runId = getOrCreateRunId(sessionKey, input.session_id);
      await emit({
        nativeHook: 'agent_end',
        correlation: {
          agentId: input.agent_id,
          sessionId: input.session_id,
          sessionKey,
          runId,
          cwd: input.cwd,
        },
        outcome: {
          success: false,
          errorMessage: input.error_details ?? String(input.error ?? 'stop failure'),
        },
        data: {
          event: {
            error: input.error,
            errorDetails: input.error_details,
            lastAssistantMessage: input.last_assistant_message,
          },
        },
      });
      clearRunId(sessionKey, input.session_id);
      return allow();
    }

    return allow();
  };

  return {
    hooks: {
      UserPromptSubmit: [{ hooks: [telemetryHook] }],
      PreToolUse: [{ hooks: [telemetryHook] }],
      PostToolUse: [{ hooks: [telemetryHook] }],
      Stop: [{ hooks: [telemetryHook] }],
      StopFailure: [{ hooks: [telemetryHook] }],
    },
  };
}
