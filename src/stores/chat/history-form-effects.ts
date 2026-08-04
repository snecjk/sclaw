import { upgradeWorkflowParamUserMessages } from '@/lib/workflow-param-messages';
import { getMessageText } from './helpers';
import { patchLastAssistantWithWorkflowForm } from './parameter-form-recovery';
import type { ChatGet, ChatSet } from './store-api';
import type { RawMessage } from './types';

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
    set,
  } = input;

  void (async () => {
    const localized = await upgradeWorkflowParamUserMessages(messages, sessionKey);
    if (get().currentSessionKey !== sessionKey) return;

    const nextMessages = localized !== messages ? localized : messages;
    if (localized !== messages) {
      set({ messages: localized });
      onLocalized?.(localized);
    }

    if (patchWorkflowForm) {
      const patched = patchLastAssistantWithWorkflowForm(nextMessages, getMessageText, { rawMessages });
      if (patched !== nextMessages) {
        set({ messages: patched });
        onLocalized?.(patched);
      }
    }

  })();
}
