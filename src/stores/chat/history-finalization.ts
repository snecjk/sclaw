import { ensureWorkflowParameterFormInjected, patchLastAssistantWithWorkflowForm } from './parameter-form-recovery';
import { getMessageText, setLastChatEventAt } from './helpers';
import type { ChatGet, ChatSet } from './store-api';

export function finalizeMessagesFromHistoryLoad(
  get: ChatGet,
  set: ChatSet,
  _options?: { sessionKey?: string | null; agentId?: string | null; runId?: string | null },
): void {
  let messages = patchLastAssistantWithWorkflowForm(get().messages, getMessageText);
  if (messages !== get().messages) set({ messages });
  ensureWorkflowParameterFormInjected(getMessageText);
}

export function touchLastChatEventAt(set: ChatSet): void {
  const now = Date.now();
  setLastChatEventAt(now);
  set({ lastChatEventAt: now });
}
