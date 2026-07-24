import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { getDataDir } from '../../utils/paths';
import { prepareClaudeRuntime } from '../../engines/claude-sdk-runtime';
import { getDefaultProviderAccountId } from '../../services/providers/provider-store';
import { workflowExecLog } from './logging';

/**
 * agent-runner — a slim workflow-node runner that calls the Claude Agent SDK's
 * `query()` directly (no chat EngineAdapter), reusing the shared Claude SDK
 * runtime preparation for provider auth and the bundled native binary path.
 *
 * Excludes ALL 5 chat runtime extensions (no mcpServers / hooks / plugins /
 * systemPrompt / skills) so workflow nodes run with only the SDK's built-in
 * tools under `bypassPermissions`. Reads and writes are limited by the SDK to
 * the current workflow run workspace (NOT $HOME), so nodes can share artifacts
 * without gaining access to arbitrary user directories.
 *
 * Double-layer stuck protection:
 *   - no-progress watchdog (default 300s): kills if no message arrives.
 *   - hard deadline (default 960s): kills no matter what.
 * Cancel is exposed via `cancelAgent()`, which calls the active query's
 * `close()` and resolves the pending invocation as failed.
 */

export type AgentStatus = 'succeeded' | 'failed';

export interface InvokeResult {
  status: AgentStatus;
  rawText: string;
  output?: unknown;
  usage?: any;
  error?: string;
}

export interface AgentStreamEvent {
  type: 'agent.answer_delta' | 'agent.tool_start' | 'agent.tool_end' | 'agent.progress';
  message?: string;
  rawText?: string;
  toolId?: string;
  toolName?: string;
  callId?: string;
  isError?: boolean;
}

interface ActiveHandle {
  close?: () => void;
  finish?: (result: InvokeResult) => void;
}

const activeQueries = new Map<string, ActiveHandle>();
const CLAUDE_AUTH_REQUIRED_RE = /not\s+logged\s+in\s*[·:.-]?\s*please\s+run\s+\/login/i;
const CLAUDE_API_ERROR_RE = /(?:^|\n)API Error:\s*(\d{3})\b/i;

async function ensureDirectory(directory: string): Promise<void> {
  if (!directory || path.parse(directory).root === directory) {
    return;
  }
  await mkdir(directory, { recursive: true });
}

/**
 * Cancel an in-flight agent invocation. Calls the active query's `close()` and
 * resolves the pending `invokeAgent` promise as failed so callers don't have to
 * wait for the watchdog/deadline to fire after a cancel.
 */
export function cancelAgent(runId: string, nodeId: string): void {
  const entries = nodeId
    ? [[`${runId}:${nodeId}`, activeQueries.get(`${runId}:${nodeId}`)] as const]
    : [...activeQueries.entries()].filter(([key]) => key.startsWith(`${runId}:`));
  for (const [, handle] of entries) {
    if (!handle) continue;
    try {
      handle.close?.();
    } catch {
      /* ignore close errors — best-effort */
    }
    handle.finish?.({ status: 'failed', rawText: '', error: '节点执行已取消' });
  }
}

export interface InvokeArgs {
  /** Injected SDK ( `{ query }` ) so tests don't need the real binary. */
  sdk: any;
  /** Workflow execution context. Requires at least `runId` + `nodeId`. */
  ctx: { runId: string; nodeId: string } & Record<string, unknown>;
  prompt: string;
  /** Env override (skips shared Claude runtime preparation). Tests inject `{}`. */
  env?: Record<string, string>;
  /** cwd override (skips the per-run workspace default). Tests inject it. */
  cwd?: string;
  /** Override the run-sandbox additionalDirectories (defaults to cwd's parent). */
  additionalDirectories?: string[];
  /** Override the bundled executable path (defaults to the chat adapter's). */
  pathToClaudeCodeExecutable?: string;
  /** No-progress watchdog threshold (ms). Default 300_000 (300s). */
  noProgressMs?: number;
  /** Hard deadline (ms). Default 960_000 (960s). */
  deadlineMs?: number;
  /** Account id used by shared Claude runtime preparation when `env` is not injected. */
  accountId?: string;
  /** Explicit model id selected from the locally configured runtime catalog. */
  model?: string;
  /** Reserved for retry metadata; not consumed by the runner. */
  retryReason?: string;
  /** Streams Claude SDK partial events into the workflow runtime event log. */
  onStreamEvent?: (event: AgentStreamEvent) => void | Promise<void>;
  allowedTools?: string[];
  allowedSkills?: string[];
  permissionMode?: string;
  /** Passed to Claude Agent SDK outputFormat; the SDK, not prompt parsing, enforces the shape. */
  outputSchema?: Record<string, unknown>;
  /** Durable workflow execution-engine label for operational logs. */
  execEngine?: 'claude' | 'openclaw';
}

export async function invokeAgent(args: InvokeArgs): Promise<InvokeResult> {
  const { sdk, ctx, prompt } = args;

  // Default cwd is the run workspace directory. Nodes may share files within a
  // single run, but never receive a user-home or arbitrary-directory workspace.
  // Only computed when the caller (tests included) doesn't inject a cwd, so the
  // electron-backed getDataDir() is never called in tests.
  const cwd =
    args.cwd ?? path.join(getDataDir(), 'workflow-runtime', 'workspaces', ctx.runId);

  // Both cwd and additional directories are the run workspace, not $HOME.
  const additionalDirectories = args.additionalDirectories ?? [cwd];

  const accountId = args.accountId ?? await resolveDefaultAccountId();
  const preparedRuntime = args.env ? undefined : await prepareClaudeRuntime({
    agentId: 'workflow-runtime',
    requestedAccountId: accountId,
    requestedModel: args.model,
  });
  const env = args.env ?? preparedRuntime?.env ?? {};
  // Match the chat adapter exactly: the DSL/default value only expresses a
  // preference.  The Claude runtime selection resolves it against the active
  // provider account catalog and returns the one model identifier that may be
  // sent to the SDK.  Passing args.model here used to bypass that normalization
  // and caused provider/model-format 400 errors for workflow-only runs.
  const effectiveModel = preparedRuntime?.selection.model ?? args.model;
  const noProgressMs = args.noProgressMs ?? 300_000;
  const deadlineMs = args.deadlineMs ?? 960_000;

  await ensureDirectory(cwd);
  await Promise.all(additionalDirectories.map(ensureDirectory));

  // Desktop workflow runs do not have an interactive SDK approval bridge.
  // workspace_write therefore skips SDK confirmation only inside the already
  // sandboxed run workspace; it never grants an arbitrary user directory.
  const permissionMode = args.permissionMode === 'readonly' ? 'plan' : 'bypassPermissions';
  const options: Record<string, unknown> = {
    cwd,
    additionalDirectories,
    execEngine: args.execEngine ?? 'claude',
    env,
    permissionMode,
    allowDangerouslySkipPermissions: permissionMode === 'bypassPermissions',
    pathToClaudeCodeExecutable: args.pathToClaudeCodeExecutable ?? preparedRuntime?.pathToClaudeCodeExecutable,
    settingSources: [],
    // Workflow definitions can carry cloud-only model aliases such as "sonnet".
    // The local executor must instead use the model selected in the local
    // provider catalog, otherwise the SDK falls back to an unavailable Claude
    // model before the node prompt is even sent.
    settings: effectiveModel ? { model: effectiveModel } : undefined,
    includePartialMessages: true,
    allowedTools: args.allowedTools?.length ? args.allowedTools : undefined,
    outputFormat: args.outputSchema ? { type: 'json_schema', schema: args.outputSchema } : undefined,
    skills: args.allowedSkills?.length ? args.allowedSkills : undefined,
    // Deliberately exclude all 5 chat runtime extensions for the workflow agent:
    // no mcpServers, hooks, plugins, or systemPrompt. Do not pass `skills` here:
    // the SDK supports values like `all`, but `none` is not a valid sentinel in
    // current builds and causes an internal `*.map is not a function` failure.
  };

  workflowExecLog('debug', 'agent-input', prompt, {
    runId: ctx.runId,
    nodeId: ctx.nodeId,
    model: effectiveModel,
    cwd,
    additionalDirectories,
    execEngine: args.execEngine ?? 'claude',
  });
  const query = await sdk.query({ prompt, options });
  const key = `${ctx.runId}:${ctx.nodeId}`;

  let rawText = '';
  let streamedText = '';
  let usage: any;
  let structuredOutput: unknown;
  let lastMsgAt = Date.now();
  let settled = false;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;

  const result = await new Promise<InvokeResult>((resolve) => {
    const finish = (r: InvokeResult): void => {
      if (settled) return;
      settled = true;
      if (watchdog) clearInterval(watchdog);
      if (deadlineTimer) clearTimeout(deadlineTimer);
      activeQueries.delete(key);
      const finalText = r.rawText || streamedText;
      workflowExecLog('debug', 'agent-final-output', finalText, {
        runId: ctx.runId,
        nodeId: ctx.nodeId,
        status: r.status,
        // outputLength: finalText.length,
        // usage: r.usage,
        error: r.error,
        execEngine: args.execEngine ?? 'claude',
      });
      resolve({ ...r, rawText: finalText });
    };

    activeQueries.set(key, {
      close: typeof query?.close === 'function' ? query.close.bind(query) : undefined,
      finish,
    });

    // No-progress watchdog: poll frequently enough to actually catch the
    // threshold (adaptive interval, capped at 5s for production-scale thresholds).
    const interval = Math.min(5_000, Math.max(100, Math.floor(noProgressMs / 4)));
    watchdog = setInterval(() => {
      if (Date.now() - lastMsgAt > noProgressMs) {
        try {
          query?.close?.();
        } catch {
          /* ignore */
        }
        finish({ status: 'failed', rawText, error: '节点执行超时(无进度看门狗)' });
      }
    }, interval);

    // Hard deadline: kill no matter what once exceeded.
    deadlineTimer = setTimeout(() => {
      try {
        query?.close?.();
      } catch {
        /* ignore */
      }
      finish({ status: 'failed', rawText, error: '节点执行超时(硬截止)' });
    }, deadlineMs);

    // Consume the SDK stream. Runs detached from the executor so `finish` from
    // any path (result / cancel / watchdog / deadline / error) resolves the promise.
    void (async () => {
      try {
        for await (const msg of query) {
          lastMsgAt = Date.now();
          const streamDeltaText = extractStreamDeltaText(msg);
          if (streamDeltaText) {
            streamedText += streamDeltaText;
            workflowExecLog('debug', 'agent-stream_event', streamDeltaText, {
              runId: ctx.runId,
              nodeId: ctx.nodeId,
              execEngine: args.execEngine ?? 'claude',
            });
            await emitStreamEvent(args.onStreamEvent, {
              type: 'agent.answer_delta',
              message: streamDeltaText,
              rawText: streamedText,
            });
          }

          let deltaText = '';
          if (msg?.type === 'assistant' && msg.message?.content) {
            for (const block of msg.message.content) {
              if (block?.type === 'text' && typeof block.text === 'string') {
                rawText += block.text;
                deltaText += block.text;
                continue;
              }
              const toolEvent = toToolStreamEvent(block);
              if (toolEvent) {
                await emitStreamEvent(args.onStreamEvent, toolEvent);
              }
            }
          } else if (msg?.message?.content) {
            // The SDK returns tool_result blocks in a user message. Capture them
            // as well so the workflow timeline distinguishes a requested write
            // from a write that actually completed (or failed).
            for (const block of msg.message.content) {
              const toolEvent = toToolStreamEvent(block);
              if (toolEvent) await emitStreamEvent(args.onStreamEvent, toolEvent);
            }
          }
          if (deltaText && !streamedText) {
            workflowExecLog('debug', 'agent-stream-text', deltaText, {
              runId: ctx.runId,
              nodeId: ctx.nodeId,
              source: 'assistant_message',
              execEngine: args.execEngine ?? 'claude',
            });
            await emitStreamEvent(args.onStreamEvent, {
              type: 'agent.answer_delta',
              message: deltaText,
              rawText,
            });
          }
          if (msg?.type === 'result') {
            usage = msg.usage;
            structuredOutput = msg.structured_output;
            const agentError = detectAgentExecutionError(rawText);
            finish(agentError
              ? { status: 'failed', rawText, usage, error: agentError }
              : { status: 'succeeded', rawText, usage, output: structuredOutput });
          }
        }
        const agentError = detectAgentExecutionError(rawText);
        finish(agentError
          ? { status: 'failed', rawText, usage, error: agentError }
          : { status: 'succeeded', rawText, usage, output: structuredOutput });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        finish({ status: 'failed', rawText, error: message });
      }
    })();
  });

  return result;
}

async function resolveDefaultAccountId(): Promise<string | undefined> {
  try {
    return await getDefaultProviderAccountId();
  } catch {
    return undefined;
  }
}

function detectAgentExecutionError(rawText: string): string | undefined {
  if (CLAUDE_AUTH_REQUIRED_RE.test(rawText)) {
    return 'Claude 账号未登录或鉴权环境缺失，请检查默认模型账号登录状态';
  }
  const apiError = rawText.match(CLAUDE_API_ERROR_RE);
  return apiError ? `模型调用失败（HTTP ${apiError[1]}）: ${rawText.slice(0, 500)}` : undefined;
}

async function emitStreamEvent(
  onStreamEvent: InvokeArgs['onStreamEvent'],
  event: AgentStreamEvent,
): Promise<void> {
  if (!onStreamEvent) return;
  await onStreamEvent(event);
}

function extractStreamDeltaText(msg: any): string {
  if (msg?.type !== 'stream_event') return '';
  const event = msg.event;
  if (event?.type !== 'content_block_delta') return '';
  const delta = event.delta;
  return delta?.type === 'text_delta' && typeof delta.text === 'string' ? delta.text : '';
}

function toToolStreamEvent(block: any): AgentStreamEvent | undefined {
  if (block?.type === 'tool_use') {
    const toolName = typeof block.name === 'string' ? block.name : undefined;
    return {
      type: 'agent.tool_start',
      toolId: toolName,
      toolName,
      callId: typeof block.id === 'string' ? block.id : undefined,
      message: stringifyToolPayload(block.input),
    };
  }
  if (block?.type === 'tool_result') {
    return {
      type: 'agent.tool_end',
      callId: typeof block.tool_use_id === 'string' ? block.tool_use_id : undefined,
      isError: Boolean(block.is_error),
      message: stringifyToolPayload(block.content),
    };
  }
  return undefined;
}

function stringifyToolPayload(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
