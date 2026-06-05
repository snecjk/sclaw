/**
 * Hook for listening to scheduled task tool calls from AI
 *
 * Listens for create_scheduled_task tool calls, extracts parameters
 * from the raw tool result message content, and triggers the
 * TaskCreateModal with pre-filled values.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useChatStore } from '@/stores/chat';

export interface NlExtractedValues {
  name?: string;
  message?: string;
  schedule?: string;
}

interface UseScheduledTaskToolListenerReturn {
  nlModalOpen: boolean;
  nlInitialValues: NlExtractedValues;
  openNlModal: (values: NlExtractedValues) => void;
  closeNlModal: () => void;
}

/**
 * Parse tool result content to extract scheduled task parameters.
 * Content may be a string, an array of content blocks, or already parsed JSON.
 */
function parseToolContent(content: unknown): NlExtractedValues | null {
  let text: string | undefined;

  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    // ContentBlock[] — find text block
    for (const block of content) {
      if (block && typeof block === 'object' && 'text' in block && typeof block.text === 'string') {
        text = block.text;
        break;
      }
      if (block && typeof block === 'object' && 'content' in block && typeof block.content === 'string') {
        text = block.content;
        break;
      }
    }
  } else if (content && typeof content === 'object') {
    text = JSON.stringify(content);
  }

  if (!text) return null;

  try {
    const parsed = JSON.parse(text);
    if (parsed.type === 'scheduled_task_confirmation' && parsed.success !== false) {
      const params = parsed.extractedParams || {};
      return {
        name: params.name || undefined,
        message: params.description || undefined,
        schedule: params.cronExpr || undefined,
      };
    }
  } catch {
    // Not valid JSON — ignore
  }

  return null;
}

export function useScheduledTaskToolListener(): UseScheduledTaskToolListenerReturn {
  const [nlModalOpen, setNlModalOpen] = useState(false);
  const [nlInitialValues, setNlInitialValues] = useState<NlExtractedValues>({});

  // Track processed messages to avoid duplicate modals
  const processedMsgIdsRef = useRef<Set<string>>(new Set());

  const openNlModal = useCallback((values: NlExtractedValues) => {
    setNlInitialValues(values);
    setNlModalOpen(true);
  }, []);

  const closeNlModal = useCallback(() => {
    setNlModalOpen(false);
    setNlInitialValues({});
  }, []);

  // Listen for tool result messages in chat history
  useEffect(() => {
    const unsubscribe = useChatStore.subscribe((state) => {
      const messages = state.messages;
      if (!messages || messages.length === 0) return;

      // Scan from the end to find the latest create_scheduled_task tool result
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role !== 'toolresult') continue;
        if (msg.toolName !== 'create_scheduled_task') continue;

        const msgId = msg.id || msg.toolCallId;
        if (msgId && processedMsgIdsRef.current.has(msgId)) {
          // Already processed this message
          break;
        }
        if (msgId) {
          processedMsgIdsRef.current.add(msgId);
        }

        const values = parseToolContent(msg.content);
        if (values && values.name && values.schedule) {
          openNlModal(values);
        }
        break; // Only process the latest one per update
      }
    });

    return unsubscribe;
  }, [openNlModal]);

  return {
    nlModalOpen,
    nlInitialValues,
    openNlModal,
    closeNlModal,
  };
}
