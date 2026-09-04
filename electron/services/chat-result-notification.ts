import type { BrowserWindow } from 'electron';
import type { CanonicalChatEvent } from '../../shared/chat-runtime-protocol';
import { isSidebarVisibleChatSessionKey } from '../../shared/sidebar-chat-session';
import { notifyTaskResult } from './task-result-notification';

interface AssistantOutputState {
  messageId: string | null;
  text: string;
}

interface RunNotificationState {
  assistantOutput?: AssistantOutputState;
  userQuestion?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function extractAssistantNotificationText(payload: unknown): {
  messageId: string | null;
  text: string;
} | null {
  const message = asRecord(payload);
  if (!message || String(message.role ?? '').toLowerCase() !== 'assistant') return null;
  const content = message.content;
  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (typeof message.text === 'string') {
    text = message.text;
  } else if (Array.isArray(content)) {
    text = content.map((block) => {
      const record = asRecord(block);
      return typeof record?.text === 'string' ? record.text : '';
    }).join('');
  }
  const messageId = [message.id, message.messageId, message.uuid]
    .find((value) => typeof value === 'string' && value.trim()) as string | undefined;
  return text ? { messageId: messageId?.trim() ?? null, text } : null;
}

export function extractUserQuestionNotificationText(payload: unknown): string {
  const dispatch = asRecord(payload);
  const optimisticUserMessage = asRecord(dispatch?.optimisticUserMessage);
  if (String(optimisticUserMessage?.role ?? '').toLowerCase() !== 'user') return '';
  return typeof optimisticUserMessage?.content === 'string'
    ? optimisticUserMessage.content
    : '';
}

function mergeStreamText(previous: string, next: string): string {
  if (!previous) return next;
  if (!next) return previous;
  if (next.startsWith(previous)) return next;
  if (previous.endsWith(next)) return previous;
  return previous + next;
}

export function summarizeTaskNotificationText(text: string, maxCharacters = 20): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const characters = Array.from(normalized);
  if (characters.length <= maxCharacters) return normalized;
  return `${characters.slice(0, maxCharacters).join('')}…`;
}

function terminalMessage(event: CanonicalChatEvent, assistantText: string, userQuestion: string): {
  title: string;
  body: string;
} | null {
  const payload = asRecord(event.payload);
  if (event.type === 'run.completed') {
    return {
      title: 'AI 回复已完成',
      body: summarizeTaskNotificationText(userQuestion)
        || summarizeTaskNotificationText(assistantText)
        || 'AI 已完成回复，点击查看会话。',
    };
  }
  if (event.type === 'run.failed') {
    const error = typeof payload?.error === 'string' ? payload.error : '';
    return {
      title: 'AI 回复失败',
      body: summarizeTaskNotificationText(userQuestion)
        || summarizeTaskNotificationText(error)
        || 'AI 回复失败，点击查看会话详情。',
    };
  }
  if (event.type === 'run.interrupted') {
    const reason = typeof payload?.reason === 'string'
      ? payload.reason
      : typeof payload?.error === 'string' ? payload.error : '';
    return {
      title: 'AI 回复异常中断',
      body: summarizeTaskNotificationText(userQuestion)
        || summarizeTaskNotificationText(reason)
        || 'AI 回复异常中断，点击查看会话详情。',
    };
  }
  return null;
}

function runStateKey(event: CanonicalChatEvent): string {
  return `${event.sessionKey}\u0000${event.epoch}`;
}

export function createChatResultNotificationObserver(
  getMainWindow: () => BrowserWindow | null,
): (event: CanonicalChatEvent) => void {
  const notificationStateByRun = new Map<string, RunNotificationState>();

  return (event) => {
    const stateKey = runStateKey(event);
    if (event.type === 'run.dispatching') {
      const userQuestion = extractUserQuestionNotificationText(event.payload);
      if (userQuestion) notificationStateByRun.set(stateKey, { userQuestion });
      return;
    }
    if (event.type === 'message.delta' || event.type === 'message.final') {
      const output = extractAssistantNotificationText(event.payload);
      if (!output) return;
      const current = notificationStateByRun.get(stateKey);
      const currentOutput = current?.assistantOutput;
      notificationStateByRun.set(stateKey, {
        ...current,
        assistantOutput: {
          messageId: output.messageId,
          text: currentOutput?.messageId && output.messageId && currentOutput.messageId !== output.messageId
            ? output.text
            : mergeStreamText(currentOutput?.text ?? '', output.text),
        },
      });
      return;
    }

    if (
      event.type !== 'run.completed'
      && event.type !== 'run.failed'
      && event.type !== 'run.interrupted'
      && event.type !== 'run.aborted'
    ) return;

    const state = notificationStateByRun.get(stateKey);
    const assistantOutput = state?.assistantOutput;
    const assistantText = assistantOutput?.text ?? '';
    notificationStateByRun.delete(stateKey);
    if (event.type === 'run.aborted' || !isSidebarVisibleChatSessionKey(event.sessionKey)) return;

    const message = terminalMessage(event, assistantText, state?.userQuestion ?? '');
    if (!message) return;
    const mainWindow = getMainWindow();
    notifyTaskResult(mainWindow, {
      id: `chat-result:${event.runId ?? `${event.sessionKey}:${event.epoch}`}`,
      ...message,
      onClick: () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send('chat:result-open', {
          sessionKey: event.sessionKey,
          runId: event.runId,
          messageId: assistantOutput?.messageId ?? null,
        });
      },
    });
  };
}
