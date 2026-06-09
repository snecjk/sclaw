import { useEffect, useMemo, useState } from 'react';
import { getWorkflowDetail } from '@/lib/workflow-api';
import {
  resolveSessionWorkflowId,
  shouldShowWorkflowPreviewTab,
} from '@/lib/session-workflow-context';
import { useChatStore } from '@/stores/chat';
import type { RawMessage } from '@/stores/chat/types';
import type { WorkflowDetailResponse } from '@/types/workflow';

export function useSessionWorkflowPreview(messages: RawMessage[]) {
  const sessionKey = useChatStore((s) => s.currentSessionKey);
  const workflowCardStates = useChatStore((s) => s.workflowCardStates);

  const workflowId = useMemo(
    () => resolveSessionWorkflowId(sessionKey, messages, workflowCardStates),
    [sessionKey, messages, workflowCardStates],
  );

  const showWorkflowTab = useMemo(
    () => shouldShowWorkflowPreviewTab(sessionKey, messages, workflowCardStates),
    [sessionKey, messages, workflowCardStates],
  );

  const [detail, setDetail] = useState<WorkflowDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!showWorkflowTab || !workflowId) {
      setDetail(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getWorkflowDetail(workflowId)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setDetail(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [showWorkflowTab, workflowId]);

  return { workflowId, showWorkflowTab, detail, loading, error };
}
