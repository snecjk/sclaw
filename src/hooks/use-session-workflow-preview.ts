import { useMemo } from 'react';
import {
  filterSessionWorkflowCardStates,
  resolveSessionWorkflowId,
  shouldShowWorkflowPreviewTab,
} from '@/lib/session-workflow-context';
import { useChatStore } from '@/stores/chat';
import type { RawMessage } from '@/stores/chat/types';

/**
 * 会话工作流上下文（预览区不展示工作流详情，仅决定是否展示「编辑工作流」入口）。
 */
export function useSessionWorkflowPreview(
  messages: RawMessage[],
  sessionKey?: string,
) {
  const storeSessionKey = useChatStore((s) => s.currentSessionKey);
  const resolvedSessionKey = sessionKey ?? storeSessionKey;
  const workflowCardStates = useChatStore((s) => s.workflowCardStates);
  const sessionWorkflowCardStates = useMemo(
    () => filterSessionWorkflowCardStates(messages, workflowCardStates),
    [messages, workflowCardStates],
  );

  const workflowId = useMemo(
    () => resolveSessionWorkflowId(resolvedSessionKey, messages, sessionWorkflowCardStates),
    [resolvedSessionKey, messages, sessionWorkflowCardStates],
  );

  const showEditWorkflow = useMemo(() => {
    if (!workflowId) return false;
    return shouldShowWorkflowPreviewTab(resolvedSessionKey, messages, sessionWorkflowCardStates);
  }, [workflowId, resolvedSessionKey, messages, sessionWorkflowCardStates]);

  return { workflowId, showEditWorkflow };
}
