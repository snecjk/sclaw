/**
 * Local-only chat turns for workflow execution.
 *
 * After create/start via Agent Workflow API, execution is client-driven.
 * Do NOT forward these turns to Gateway chat.send — the model may incorrectly
 * try sai-cli or other tools to "run" the workflow again.
 */
import { useChatStore } from '@/stores/chat';
import type { ContentBlock, RawMessage } from '@/stores/chat/types';

function toMs(ts?: number): number {
  if (!ts) return 0;
  return ts < 1e12 ? ts * 1000 : ts;
}

function messageHasWorkflowCard(msg: RawMessage): boolean {
  return Array.isArray(msg.content)
    && (msg.content as ContentBlock[]).some((b) => b.type === 'workflow_card');
}

/** Keep local workflow execution turns when Gateway history reload wipes them. */
export function mergeLocalWorkflowTurnsFromCurrent(
  loaded: RawMessage[],
  current: RawMessage[],
): RawMessage[] {
  if (current.length === 0) return loaded;

  const loadedIds = new Set(loaded.map((m) => m.id).filter(Boolean));
  const extras: RawMessage[] = [];

  for (let i = 0; i < current.length; i++) {
    const msg = current[i];
    if (msg.id && loadedIds.has(msg.id)) continue;
    if (!messageHasWorkflowCard(msg)) continue;

    const prev = i > 0 ? current[i - 1] : undefined;
    if (prev?.role === 'user' && (!prev.id || !loadedIds.has(prev.id))) {
      if (!extras.some((e) => e.id && e.id === prev.id)) {
        extras.push(prev);
      }
    }
    extras.push(msg);
  }

  if (extras.length === 0) return loaded;
  return [...loaded, ...extras].sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));
}

export interface WorkflowStartedLocalTurnParams {
  userText: string;
  templateName: string;
  runId: string;
  assistantText?: string;
}

export function appendWorkflowStartedLocalTurn(params: WorkflowStartedLocalTurnParams): void {
  const {
    userText,
    templateName,
    runId,
    assistantText = '参数已确认，工作流已在后台启动执行，请稍候查看执行进度。',
  } = params;

  const now = Date.now() / 1000;
  useChatStore.setState((s) => ({
    messages: [
      ...s.messages,
      {
        role: 'user',
        content: userText,
        timestamp: now,
        id: crypto.randomUUID(),
      } as RawMessage,
      {
        role: 'assistant',
        content: [
          { type: 'text', text: assistantText },
          { type: 'workflow_card', runId, templateName },
        ],
        timestamp: now + 0.001,
        id: crypto.randomUUID(),
      } as RawMessage,
    ],
    lastUserMessageAt: Date.now(),
    sending: false,
  }));
}
