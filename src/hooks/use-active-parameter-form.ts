/**
 * useActiveParameterForm - 只读 selector：当前会话待处理的 parameter_form
 *
 * 从 messages 倒序查找最近一条仍注册 handler 的表单块；
 * 不新增 store 写入，供 ParameterFormDock 浮层渲染。
 */
import { useEffect, useSyncExternalStore } from 'react';
import { useChatStore } from '@/stores/chat';
import { useCurrentChatDisplayMessages } from '@/stores/chat/display-selectors';
import { extractPlainTextFromContent } from '@/pages/Chat/message-utils';
import {
  ensureWorkflowParameterFormHandler,
  resolveParameterFormForAssistantMessage,
} from '@/stores/chat/parameter-form-recovery';
import {
  getParameterFormHandlersRevision,
  hasParameterFormHandler,
  subscribeParameterFormHandlers,
} from '@/components/parameter-form/form-handlers';

export interface ActiveParameterForm {
  formId: string;
  formConfig: import('@/types/user-form').UserFormConfig;
  formContext: {
    source: 'workflow' | 'tool' | 'skill';
    sourceId: string;
    schemaHash?: string;
  };
}

export function useActiveParameterForm(): ActiveParameterForm | null {
  const messages = useCurrentChatDisplayMessages();
  const pendingWorkflow = useChatStore(
    (s) => s.workflowChatUiBySessionKey[s.currentSessionKey]?.pendingWorkflow ?? null,
  );
  const sessionKey = useChatStore((s) => s.currentSessionKey);
  useSyncExternalStore(
    subscribeParameterFormHandlers,
    getParameterFormHandlersRevision,
    getParameterFormHandlersRevision,
  );

  let candidate: ActiveParameterForm | null = null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role !== 'assistant') continue;
    const extracted = resolveParameterFormForAssistantMessage(messages[i], {
      sessionMessages: messages,
      sessionKey,
      pendingWorkflow,
      getMessageText: extractPlainTextFromContent,
    });
    if (extracted) {
      candidate = extracted;
      break;
    }
  }

  useEffect(() => {
    if (!candidate || candidate.formContext.source !== 'workflow') return;
    ensureWorkflowParameterFormHandler(
      candidate.formId,
      candidate.formContext.sourceId,
      candidate.formContext.schemaHash ?? '',
      useChatStore.getState,
    );
  }, [candidate]);

  return candidate && hasParameterFormHandler(candidate.formId) ? candidate : null;
}
