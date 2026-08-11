/**
 * Agent 终态检测谓词（engine-agnostic）。渠道卡片推送（`delivery.ts`）与
 * legacy delivery 路径使用；定时任务终态已改由 ChatRuntimeSupervisor canonical event 驱动。
 *
 * 终态语义与 `gateway/normalized-engine-event.ts` 对齐——真终态只认 agent
 * notification（或同源的 chat `done`/`error`/`aborted`），**绝不在 `final`
 * 片段收尾**：双引擎口播 / tool 片段都会带 `final`，在此收尾会截口播或误
 * 「无回复内容」。
 */
import type { AgentEngineType } from './types';

/** 过程态文案截断上限（与 `delivery.ts` 一致）。 */
export const STATUS_MAX_CHARS = 3500;

/**
 * 拆出正文与过程；过程只用于尚无正文时占位，finalize 时会被正文覆盖。
 * content[] 里 type=thinking 当过程、tool_use/toolCall 当工具口播、其余
 * text 块拼正文；OpenClaw 部分帧用顶层 text 而非 content[]。
 */
export function extractAssistantParts(message: unknown): { answer: string; status: string } {
  if (!message || typeof message !== 'object') {
    return { answer: '', status: '' };
  }
  const record = message as { content?: unknown; text?: unknown };
  const raw = record.content;
  if (typeof raw === 'string') {
    return { answer: raw, status: '' };
  }
  if (!Array.isArray(raw)) {
    // OpenClaw 部分帧用顶层 text，而不是 content[]
    if (typeof record.text === 'string' && record.text) {
      return { answer: record.text, status: '' };
    }
    return { answer: '', status: '' };
  }

  const texts: string[] = [];
  const statuses: string[] = [];

  for (const block of raw) {
    if (!block || typeof block !== 'object') continue;
    const item = block as {
      type?: string;
      text?: string;
      thinking?: string;
      name?: string;
    };
    // 仅 type=thinking 才当过程态；不要用 `thinking` 字段存在与否误伤 text 块
    if (item.type === 'thinking') {
      if (typeof item.thinking === 'string' && item.thinking.trim()) {
        statuses.push(item.thinking.trim());
      }
      continue;
    }
    if (item.type === 'tool_use' || item.type === 'toolCall') {
      const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : '工具';
      statuses.push(`🔧 正在调用 ${name}...`);
      continue;
    }
    if (typeof item.text === 'string' && item.text) {
      texts.push(item.text);
    }
  }

  if (texts.length === 0 && typeof record.text === 'string' && record.text) {
    return { answer: record.text, status: statuses.join('\n\n').slice(0, STATUS_MAX_CHARS) };
  }

  return {
    answer: texts.join(''),
    status: statuses.join('\n\n').slice(0, STATUS_MAX_CHARS),
  };
}

/** sessionKey 比对（大小写不敏感）；undefined 永远不匹配。 */
export function isSameSessionKey(left: string | undefined, right: string): boolean {
  if (!left) return false;
  return left === right || left.toLowerCase() === right.toLowerCase();
}

export type ChatMessageClassification =
  | { kind: 'started' }
  | { kind: 'fragment'; state: 'delta' | 'final'; answer: string; status: string }
  | {
      kind: 'terminal';
      state: 'done' | 'error' | 'aborted';
      isError: boolean;
      errorMessage?: string;
    };

/**
 * 分类 `chat:message` 事件的**内层 payload**（即 `eventArg.message`，形状
 * `{ sessionKey, state, errorMessage, message }`）。渠道与 watcher 都传
 * `data.message` 进来。
 *
 * - `delta`/`final`：assistant 片段——累积正文；`final` 也只是片段（绝不在
 *   此收尾），caller 自行区分是否需要为 `final` 打日志。
 * - `done`：OpenClaw lifecycle 后偶发（与 agent end 同源终态）→ 终态（非错）。
 * - `error`/`aborted`：终态（isError=true）。
 * - `started`：仅占位。
 *
 * @returns null = sessionKey 不匹配或未知 state。
 */
export function classifyChatMessage(
  payload: unknown,
  sessionKey: string,
): ChatMessageClassification | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as {
    sessionKey?: string;
    state?: string;
    errorMessage?: string;
    message?: unknown;
  };
  if (!isSameSessionKey(record.sessionKey, sessionKey)) return null;
  const state = record.state;
  switch (state) {
    case 'started':
      return { kind: 'started' };
    case 'delta':
    case 'final': {
      const parts = extractAssistantParts(record.message);
      return { kind: 'fragment', state, answer: parts.answer, status: parts.status };
    }
    case 'done':
      return { kind: 'terminal', state: 'done', isError: false };
    case 'error':
      return {
        kind: 'terminal',
        state: 'error',
        isError: true,
        errorMessage: typeof record.errorMessage === 'string' ? record.errorMessage : undefined,
      };
    case 'aborted':
      return { kind: 'terminal', state: 'aborted', isError: true };
    default:
      return null;
  }
}

export type AgentNotificationClassification =
  | { kind: 'tool'; toolName: string }
  | { kind: 'terminal'; isError: boolean; phase: string };

/**
 * 分类 agent `notification` 事件（engine-agnostic 终态检测）。
 *
 * - Claude：`method=agent` 顶层 `params.phase=completed`（adapter 在 result 后
 *   发出；不带 stopReason/isError——须沿路从 chat 片段累积正文）。
 * - OpenClaw：`method=agent`，`data.phase=end|error` 且 `stream=lifecycle`。
 *
 * 工具事件也带 `data.phase=start|end`，必须靠 `stream=tool`（或 `phase=tool*`）
 * 排除，否则把 tool end 当成整轮结束。返回 `{ kind: 'tool', toolName }` 让
 * caller 更新过程态文案（卡片用；watcher 可忽略）。
 *
 * @returns null = 非 agent method / sessionKey 不匹配 / 非终态 phase（started 等）。
 */
export function classifyAgentNotification(
  notification: unknown,
  sessionKey: string,
): AgentNotificationClassification | null {
  if (!notification || typeof notification !== 'object') return null;
  const n = notification as {
    method?: string;
    params?: {
      phase?: string;
      stream?: string;
      sessionKey?: string;
      data?: { phase?: string; name?: string; toolName?: string };
      name?: string;
    };
  };
  if (n.method !== 'agent') return null;
  const params = n.params;
  if (!params || !isSameSessionKey(params.sessionKey, sessionKey)) return null;

  const data = params.data && typeof params.data === 'object' ? params.data : undefined;
  const phase = String(data?.phase ?? params.phase ?? '').toLowerCase();
  const stream = String(params.stream ?? '').toLowerCase();

  // 工具事件也带 data.phase=start|end，必须靠 stream=tool 排除，否则会误 finalize
  if (
    stream === 'tool'
    || phase === 'tool'
    || phase === 'tool_start'
    || phase === 'tool_call'
  ) {
    const toolName = data?.name || data?.toolName || params.name || '工具';
    return { kind: 'tool', toolName: typeof toolName === 'string' ? toolName : '工具' };
  }

  if (
    phase === 'completed'
    || phase === 'done'
    || phase === 'finished'
    || phase === 'end'
  ) {
    return { kind: 'terminal', isError: false, phase };
  }

  if (phase === 'error') {
    return { kind: 'terminal', isError: true, phase };
  }

  return null;
}

/** 给 watcher/渠道打日志时用的引擎标签。 */
export function engineLabel(engineType: AgentEngineType | undefined): string {
  return engineType === 'openclaw' ? 'openclaw' : 'claude';
}
