/**
 * showInlineParameterForm - Generic API to show a parameter form inline in chat
 *
 * Usage:
 *   const result = await showInlineParameterForm(config, { source: 'tool', sourceId: 'my-tool' });
 *   if (!result.cancelled) {
 *     console.log(result.values);
 *   }
 */
import { useChatStore } from '@/stores/chat';
import { registerParameterFormHandler } from './form-handlers';
import type { UserFormConfig, FormResult } from '@/types/user-form';
import type { ParameterFormContext } from './ParameterFormCard';

export interface InlineFormResult {
  cancelled: boolean;
  values?: FormResult;
}

/**
 * Show an inline parameter form in the current chat session.
 * Returns a Promise that resolves when the user submits or cancels.
 */
export function showInlineParameterForm(
  config: UserFormConfig,
  context: ParameterFormContext,
): Promise<InlineFormResult> {
  return new Promise((resolve) => {
    const chatStore = useChatStore;
    const now = Date.now() / 1000;
    const formId = config.id || `inline-form-${Date.now()}`;

    // Insert assistant message with parameter_form block
    chatStore.setState((s) => ({
      messages: [
        ...s.messages,
        {
          role: 'assistant',
          content: [
            ...(config.description ? [{ type: 'text', text: config.description }] : []),
            {
              type: 'parameter_form',
              formId,
              formConfig: config,
              formContext: context,
            },
          ],
          timestamp: now,
          id: crypto.randomUUID(),
        } as import('@/stores/chat').RawMessage,
      ],
    }));

    // Register one-time handler
    registerParameterFormHandler(formId, (values) => {
      resolve({ cancelled: false, values });
    });
  });
}
