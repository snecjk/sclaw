import path from 'node:path';
import { getDataDir } from '../../utils/paths';
import { buildClaudeEnvForAccount, getBundledClaudeExecutablePath } from '../../engines/claude-adapter';

/**
 * agent-runner — a slim workflow-node runner that calls the Claude Agent SDK's
 * `query()` directly (no chat EngineAdapter), reusing `buildClaudeEnvForAccount`
 * for auth and the bundled native binary path from the chat adapter.
 *
 * Excludes ALL 5 chat runtime extensions (no mcpServers / hooks / plugins /
 * systemPrompt / skills) so workflow nodes run with only the SDK's built-in
 * tools under `bypassPermissions`. `additionalDirectories` is constrained to
 * the run workspace root (NOT $HOME) so the agent can't escape the run sandbox.
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
  usage?: any;
  error?: string;
}

interface ActiveHandle {
  close?: () => void;
  finish?: (result: InvokeResult) => void;
}

const activeQueries = new Map<string, ActiveHandle>();

/**
 * Cancel an in-flight agent invocation. Calls the active query's `close()` and
 * resolves the pending `invokeAgent` promise as failed so callers don't have to
 * wait for the watchdog/deadline to fire after a cancel.
 */
export function cancelAgent(runId: string, nodeId: string): void {
  const handle = activeQueries.get(`${runId}:${nodeId}`);
  if (!handle) return;
  try {
    handle.close?.();
  } catch {
    /* ignore close errors — best-effort */
  }
  handle.finish?.({ status: 'failed', rawText: '', error: '节点执行已取消' });
}

export interface InvokeArgs {
  /** Injected SDK ( `{ query }` ) so tests don't need the real binary. */
  sdk: any;
  /** Workflow execution context. Requires at least `runId` + `nodeId`. */
  ctx: { runId: string; nodeId: string } & Record<string, unknown>;
  prompt: string;
  /** Env override (skips `buildClaudeEnvForAccount`). Tests inject `{}`. */
  env?: Record<string, string>;
  /** cwd override (skips the per-node workspace default). Tests inject it. */
  cwd?: string;
  /** Override the run-sandbox additionalDirectories (defaults to cwd's parent). */
  additionalDirectories?: string[];
  /** Override the bundled executable path (defaults to the chat adapter's). */
  pathToClaudeCodeExecutable?: string;
  /** No-progress watchdog threshold (ms). Default 300_000 (300s). */
  noProgressMs?: number;
  /** Hard deadline (ms). Default 960_000 (960s). */
  deadlineMs?: number;
  /** Account id forwarded to `buildClaudeEnvForAccount` when `env` is not injected. */
  accountId?: string;
  /** Reserved for retry metadata; not consumed by the runner. */
  retryReason?: string;
}

export async function invokeAgent(args: InvokeArgs): Promise<InvokeResult> {
  const { sdk, ctx, prompt } = args;

  // Default cwd is the per-node workspace dir under the run workspace root.
  // Only computed when the caller (tests included) doesn't inject a cwd, so the
  // electron-backed getDataDir() is never called in tests.
  const cwd =
    args.cwd ?? path.join(getDataDir(), 'workflow-runtime', 'workspaces', ctx.runId, ctx.nodeId);

  // additionalDirectories limited to the run workspace root (parent of the node
  // cwd) — NOT $HOME — so the agent can't wander outside the run sandbox. Derived
  // from cwd so no second getDataDir() call is needed (keeps tests electron-free).
  const additionalDirectories = args.additionalDirectories ?? [path.dirname(cwd)];

  const env = args.env ?? (await buildClaudeEnvForAccount(args.accountId));
  const noProgressMs = args.noProgressMs ?? 300_000;
  const deadlineMs = args.deadlineMs ?? 960_000;

  const options: Record<string, unknown> = {
    cwd,
    additionalDirectories,
    env,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    pathToClaudeCodeExecutable: args.pathToClaudeCodeExecutable ?? getBundledClaudeExecutablePath(),
    settingSources: [],
    skills: 'none',
    includePartialMessages: true,
    // Deliberately exclude all 5 chat runtime extensions for the workflow agent:
    // no mcpServers, hooks, plugins, systemPrompt, or skills.
  };

  const query = await sdk.query({ prompt, options });
  const key = `${ctx.runId}:${ctx.nodeId}`;

  let rawText = '';
  let usage: any;
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
      resolve(r);
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
          if (msg?.type === 'assistant' && msg.message?.content) {
            for (const block of msg.message.content) {
              if (block?.type === 'text' && typeof block.text === 'string') {
                rawText += block.text;
              }
            }
          }
          if (msg?.type === 'result') {
            usage = msg.usage;
            finish({ status: 'succeeded', rawText, usage });
          }
        }
        finish({ status: 'succeeded', rawText, usage });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        finish({ status: 'failed', rawText, error: message });
      }
    })();
  });

  return result;
}
