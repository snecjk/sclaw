/**
 * useActiveParameterForm - 只读 selector：当前会话待处理的 parameter_form
 *
 * 从 messages 倒序查找最近一条仍注册 handler 的表单块；
 * 不新增 store 写入，供 ParameterFormDock 浮层渲染。
 */
import { useMemo } from 'react';
import { useChatStore } from '@/stores/chat';
import { useCurrentChatDisplayMessages } from '@/stores/chat/display-selectors';
import { extractParameterForm } from '@/pages/Chat/message-utils';
import { hasParameterFormHandler } from '@/components/parameter-form/form-handlers';

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

  return useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const extracted = extractParameterForm(messages[i], pendingWorkflow);
      if (extracted && hasParameterFormHandler(extracted.formId)) {
        return extracted;
      }
    }
    return null;
  }, [messages, pendingWorkflow]);
}
