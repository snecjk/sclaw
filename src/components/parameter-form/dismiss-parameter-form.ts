/**
 * Remove inline parameter forms from chat messages after successful submit.
 */
import { updateCurrentChatDisplayProjection } from '@/stores/chat/display-selectors';
import type { ContentBlock } from '@/stores/chat';
import { PARAM_FORM_MARKER_REGEX } from '@/lib/parameter-form-marker';
import { resolveParameterFormId } from './form-handlers';

function formIdsMatch(blockFormId: string | undefined, targetFormId: string): boolean {
  if (!blockFormId) return false;
  if (blockFormId === targetFormId) return true;
  const resolvedTarget = resolveParameterFormId(targetFormId);
  if (blockFormId === resolvedTarget) return true;
  return blockFormId.startsWith(`${resolvedTarget}-`) || resolvedTarget.startsWith(`${blockFormId}-`);
}

function parseWorkflowTemplateId(formId: string): string | null {
  const tsMatch = formId.match(/^workflow-form-(.+)-(\d{10,})$/);
  if (tsMatch) return tsMatch[1];
  const simple = formId.match(/^workflow-form-(.+)$/);
  return simple?.[1] ?? null;
}

/** Hide all inline forms for a workflow template (e.g. after text-based confirmation). */
export function dismissWorkflowParameterFormsForTemplate(templateId: string): void {
  updateCurrentChatDisplayProjection((messages) => messages.map((msg) => {
      if (msg.role !== 'assistant' || !Array.isArray(msg.content)) return msg;

      let changed = false;
      const nextContent: ContentBlock[] = [];

      for (const block of msg.content as ContentBlock[]) {
        if (
          block.type === 'parameter_form'
          && block.formContext?.source === 'workflow'
          && block.formContext.sourceId === templateId
        ) {
          changed = true;
          continue;
        }

        if (block.type === 'text' && typeof block.text === 'string') {
          const markerMatch = block.text.match(PARAM_FORM_MARKER_REGEX);
          if (markerMatch?.[1] === templateId) {
            changed = true;
            const stripped = block.text.replace(PARAM_FORM_MARKER_REGEX, '').trim();
            if (stripped) {
              nextContent.push({ ...block, text: stripped });
            }
            continue;
          }
        }

        nextContent.push(block);
      }

      return changed ? { ...msg, content: nextContent } : msg;
    }));
}

/** Strip parameter_form blocks and ParameterForm markers for a submitted workflow form. */
export function dismissParameterFormInChat(formId: string): void {
  const resolvedId = resolveParameterFormId(formId);
  const templateId = parseWorkflowTemplateId(resolvedId) ?? parseWorkflowTemplateId(formId);

  updateCurrentChatDisplayProjection((messages) => messages.map((msg) => {
      if (msg.role !== 'assistant' || !Array.isArray(msg.content)) return msg;

      let changed = false;
      const nextContent: ContentBlock[] = [];

      for (const block of msg.content as ContentBlock[]) {
        if (block.type === 'parameter_form' && formIdsMatch(block.formId, resolvedId)) {
          changed = true;
          continue;
        }

        if (block.type === 'text' && typeof block.text === 'string' && templateId) {
          const markerMatch = block.text.match(PARAM_FORM_MARKER_REGEX);
          if (markerMatch?.[1] === templateId) {
            changed = true;
            const stripped = block.text.replace(PARAM_FORM_MARKER_REGEX, '').trim();
            if (stripped) {
              nextContent.push({ ...block, text: stripped });
            }
            continue;
          }
        }

        nextContent.push(block);
      }

      return changed ? { ...msg, content: nextContent } : msg;
    }));
}
