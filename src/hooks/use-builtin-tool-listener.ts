/**
 * Registers scheduled-task UI callbacks for builtin tool dispatch.
 * Workflow tool results are handled in chat handleChatEvent via dispatchBuiltinToolResult
 * (tool_result rows are filtered from the visible message list).
 */
import { useEffect } from 'react';
import { registerScheduledTaskConfirmationHandler } from '@/lib/builtin-tool-dispatch';
import type { NlExtractedValues } from '@/hooks/use-scheduled-task-tool-listener';

export type { NlExtractedValues };

export interface UseBuiltinToolListenerOptions {
  onScheduledTaskConfirmation?: (values: NlExtractedValues) => void;
}

export function useBuiltinToolListener(options: UseBuiltinToolListenerOptions = {}): void {
  const { onScheduledTaskConfirmation } = options;

  useEffect(() => {
    registerScheduledTaskConfirmationHandler(onScheduledTaskConfirmation);
    return () => registerScheduledTaskConfirmationHandler(undefined);
  }, [onScheduledTaskConfirmation]);
}
