import { upgradeWorkflowParamUserMessages } from '@/lib/workflow-param-messages';
import type { ChatGet, ChatSet } from './store-api';
import type { RawMessage } from './types';
import { useChatRuntimeV2Store } from './runtime-v2-store';

export function localizeAndHydrateWorkflowForms(input: {
  get: ChatGet;
  set: ChatSet;
  sessionKey: string;
  messages: RawMessage[];
  rawMessages: RawMessage[];
  patchWorkflowForm?: boolean;
  onLocalized?: (messages: RawMessage[]) => void;
}): void {
  const {
    get,
    messages,
    onLocalized,
    patchWorkflowForm = false,
    rawMessages,
    sessionKey,
    set: _set,
  } = input;
  void _set;

  void (async () => {
    const localized = await upgradeWorkflowParamUserMessages(messages, sessionKey);
    if (get().currentSessionKey !== sessionKey) return;

    if (localized !== messages) {
      useChatRuntimeV2Store.getState().setDisplayProjection(sessionKey, localized);
      onLocalized?.(localized);
    }

    // Parameter forms are display decorations resolved by ChatMessage. History
    // localization must never write synthetic blocks back into ChatStore.messages.
    void patchWorkflowForm;
    void rawMessages;

  })();
}
