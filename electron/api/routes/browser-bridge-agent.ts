import type { CanonicalChatEvent, CanonicalChatEventType } from '../../../shared/chat-runtime-protocol';
import { WEB_BRIDGE_CHAT_SESSION_KEY } from '../../../shared/session-type';
import { BROWSER_BRIDGE_POLL_WAIT_MAX_MS } from '../../../shared/browser-bridge/types';
import type { ChatRuntimeSupervisor } from '../../services/chat-runtime-supervisor';

const WEB_BRIDGE_AGENT_EVENT_TYPES = new Set<CanonicalChatEventType>([
  'run.dispatching',
  'run.accepted',
  'run.started',
  'message.delta',
  'message.final',
  'tool.updated',
  'run.awaiting_transcript',
  'run.completed',
  'run.failed',
  'run.aborted',
  'run.interrupted',
]);

export interface WebBridgeAgentEventDto {
  sequence: number;
  type: CanonicalChatEventType;
  runId: string | null;
  text?: string;
  toolName?: string;
  error?: string;
}

function runtimeRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function extractWebBridgeMessageText(payload: unknown): string {
  const message = runtimeRecord(payload);
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (typeof message.text === 'string') return message.text;
  if (Array.isArray(message.content)) {
    return message.content.map((block) => {
      const record = runtimeRecord(block);
      return typeof record?.text === 'string' ? record.text : '';
    }).join('');
  }
  return '';
}

export function projectWebBridgeAgentEvent(event: CanonicalChatEvent): WebBridgeAgentEventDto | null {
  if (event.sessionKey !== WEB_BRIDGE_CHAT_SESSION_KEY) return null;
  if (!WEB_BRIDGE_AGENT_EVENT_TYPES.has(event.type)) return null;
  const payload = runtimeRecord(event.payload);
  const dto: WebBridgeAgentEventDto = {
    sequence: event.sequence,
    type: event.type,
    runId: event.runId,
  };
  if (event.type === 'message.delta' || event.type === 'message.final') {
    const text = extractWebBridgeMessageText(event.payload);
    if (text) dto.text = text;
  }
  if (event.type === 'tool.updated') {
    const toolName = typeof payload?.toolName === 'string'
      ? payload.toolName
      : typeof payload?.name === 'string'
        ? payload.name
        : '';
    if (toolName) dto.toolName = toolName;
  }
  if (event.type === 'run.failed' || event.type === 'run.interrupted') {
    const error = typeof payload?.error === 'string'
      ? payload.error
      : typeof payload?.reason === 'string'
        ? payload.reason
        : undefined;
    if (error) dto.error = error;
  }
  return dto;
}

export function buildWebBridgeSystemPromptAppend(input: {
  sessionId: string;
  url?: string;
  title?: string;
}): string {
  const url = input.url?.trim() || '(unknown)';
  const title = input.title?.trim() || '';
  return [
    '当前请求来自 Chrome Side Panel（SClaw Web Bridge）。',
    `当前标签 url: ${url}`,
    title ? `当前标签 title: ${title}` : '',
    `bridge sessionId: ${input.sessionId}`,
    '只使用 bridge_*，每次调用传入上述 sessionId，且必须 source=extension。',
    '禁止 embed-*、ba_create_session、无痕窗口或托管 Chrome。',
  ].filter(Boolean).join('\n');
}

const EVENT_BUFFER_MAX = 200;

export function createWebBridgeAgentEventHub() {
  const buffer: WebBridgeAgentEventDto[] = [];
  const waiters: Array<(events: WebBridgeAgentEventDto[]) => void> = [];
  let attached: ChatRuntimeSupervisor | null = null;

  const onEvent = (event: CanonicalChatEvent) => {
    const projected = projectWebBridgeAgentEvent(event);
    if (!projected) return;
    buffer.push(projected);
    if (buffer.length > EVENT_BUFFER_MAX) {
      buffer.splice(0, buffer.length - EVENT_BUFFER_MAX);
    }
    const pending = waiters.splice(0, waiters.length);
    for (const waiter of pending) waiter([projected]);
  };

  return {
    attach(supervisor: ChatRuntimeSupervisor): void {
      if (attached === supervisor) return;
      if (attached) attached.off('event', onEvent);
      attached = supervisor;
      supervisor.on('event', onEvent);
    },
    lastSequence(): number {
      return buffer.length > 0 ? buffer[buffer.length - 1].sequence : 0;
    },
    eventsAfter(afterSequence: number): WebBridgeAgentEventDto[] {
      return buffer.filter((event) => event.sequence > afterSequence);
    },
    async wait(afterSequence: number, waitMs: number): Promise<WebBridgeAgentEventDto[]> {
      const ready = this.eventsAfter(afterSequence);
      if (ready.length > 0 || waitMs <= 0) return ready;
      const cap = Math.min(waitMs, BROWSER_BRIDGE_POLL_WAIT_MAX_MS);
      return new Promise((resolve) => {
        let settled = false;
        const finish = (events: WebBridgeAgentEventDto[]) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const index = waiters.indexOf(onEvents);
          if (index >= 0) waiters.splice(index, 1);
          resolve(events);
        };
        const onEvents = (events: WebBridgeAgentEventDto[]) => {
          const matched = events.filter((event) => event.sequence > afterSequence);
          finish(matched.length > 0 ? matched : this.eventsAfter(afterSequence));
        };
        const timer = setTimeout(() => finish(this.eventsAfter(afterSequence)), cap);
        waiters.push(onEvents);
      });
    },
  };
}

export const webBridgeAgentEventHub = createWebBridgeAgentEventHub();
