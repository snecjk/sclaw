/**
 * Hook for listening to scheduled task tool calls
 * 
 * Listens for create_scheduled_task tool calls from the AI model,
 * extracts parameters, and shows confirmation modal.
 */

import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useChatStore } from '@/stores/chat';
import { useScheduledTasksStore } from '@/stores/scheduledTasks';
import type { ScheduledTaskCreateInput } from '@/types/scheduled-task';

interface ToolCallData {
  toolCallId?: string;
  params?: Record<string, unknown>;
}

interface ExtractedParams {
  name?: string;
  cronExpr?: string;
  description?: string;
  notifyMode?: string;
}

interface UseScheduledTaskToolListenerReturn {
  toolModalOpen: boolean;
  extractedParams: ExtractedParams;
  toolCallId?: string;
  openToolModal: (params: ExtractedParams, toolCallId?: string) => void;
  closeToolModal: () => void;
  handleConfirmCreation: (input: ScheduledTaskCreateInput) => Promise<void>;
}

/**
 * Parse tool call content to extract scheduled task parameters
 */
function parseToolContent(content: string | unknown): ExtractedParams & { type?: string; success?: boolean } {
  if (typeof content !== 'string') return {};
  
  try {
    const parsed = JSON.parse(content);
    if (parsed.type === 'scheduled_task_confirmation') {
      return {
        type: parsed.type,
        success: parsed.success,
        ...parsed.extractedParams,
      };
    }
  } catch {
    // Not JSON, try to extract from plain text
  }
  
  return {};
}

export function useScheduledTaskToolListener(): UseScheduledTaskToolListenerReturn {
  const navigate = useNavigate();
  const createTask = useScheduledTasksStore((s) => s.createTask);
  const fetchTasks = useScheduledTasksStore((s) => s.fetchTasks);
  
  const [toolModalOpen, setToolModalOpen] = useState(false);
  const [extractedParams, setExtractedParams] = useState<ExtractedParams>({});
  const [toolCallId, setToolCallId] = useState<string | undefined>();

  const openToolModal = useCallback((params: ExtractedParams, callId?: string) => {
    setExtractedParams(params);
    setToolCallId(callId);
    setToolModalOpen(true);
  }, []);

  const closeToolModal = useCallback(() => {
    setToolModalOpen(false);
    setExtractedParams({});
    setToolCallId(undefined);
  }, []);

  const handleConfirmCreation = useCallback(async (input: ScheduledTaskCreateInput) => {
    try {
      const task = await createTask(input);
      toast.success(`任务"${task.name}"已创建`);
      
      // 刷新任务列表
      await fetchTasks();
      
      // 跳转到定时任务列表页
      navigate('/scheduled-tasks');
      
      closeToolModal();
    } catch (err) {
      const message = String(err);
      toast.error(`创建失败：${message}`);
      throw err;
    }
  }, [createTask, fetchTasks, navigate, closeToolModal]);

  // Listen for tool calls
  useEffect(() => {
    // Subscribe to chat store to detect tool calls
    const unsubscribe = useChatStore.subscribe(
      (state) => state.streamingTools, // Subscribe to streamingTools state
      (tools) => {
        if (!tools || tools.length === 0) return;
        
        // Find the latest completed scheduled task tool call
        const scheduledTaskTool = tools.find(
          (tool: any) =>
            tool.name === 'create_scheduled_task' &&
            tool.status === 'completed' &&
            tool.summary
        );
        
        if (!scheduledTaskTool) return;
        
        // Parse the tool result to extract parameters
        const parsed = parseToolContent(scheduledTaskTool.summary);
        
        if (parsed.type === 'scheduled_task_confirmation' && parsed.name && parsed.cronExpr) {
          openToolModal({
            name: parsed.name,
            cronExpr: parsed.cronExpr,
            description: parsed.description,
            notifyMode: parsed.notifyMode,
          }, scheduledTaskTool.toolCallId);
        }
      }
    );
    
    return unsubscribe;
  }, [openToolModal]);

  return {
    toolModalOpen,
    extractedParams,
    toolCallId,
    openToolModal,
    closeToolModal,
    handleConfirmCreation,
  };
}
