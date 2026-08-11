/**
 * 方案 A：表单提交后将助手 intro 消息替换为分组参数摘要，并移除 parameter_form。
 */
import { PARAM_FORM_MARKER_REGEX } from '@/lib/parameter-form-marker';
import {
  isWorkflowParameterIntroText,
} from '@/lib/workflow-form-utils';
import { updateCurrentChatDisplayProjection } from '@/stores/chat/display-selectors';
import type { ContentBlock, RawMessage } from '@/stores/chat/types';

function assistantMessageMatchesWorkflowTemplate(
  msg: RawMessage,
  templateId: string,
): boolean {
  if (msg.role !== 'assistant') return false;

  const content = msg.content;
  if (typeof content === 'string') {
    if (isWorkflowParameterIntroText(content)) return true;
    const markerMatch = content.match(PARAM_FORM_MARKER_REGEX);
    return markerMatch?.[1] === templateId;
  }

  if (!Array.isArray(content)) return false;

  let hasForm = false;
  let hasIntro = false;
  let hasMarker = false;

  for (const block of content as ContentBlock[]) {
    if (
      block.type === 'parameter_form'
      && block.formContext?.source === 'workflow'
      && block.formContext.sourceId === templateId
    ) {
      hasForm = true;
    }
    if (block.type === 'text' && typeof block.text === 'string') {
      if (isWorkflowParameterIntroText(block.text)) hasIntro = true;
      const markerMatch = block.text.match(PARAM_FORM_MARKER_REGEX);
      if (markerMatch?.[1] === templateId) hasMarker = true;
    }
  }

  return hasForm || hasIntro || hasMarker;
}

function replaceAssistantContentWithParamsSummary(
  msg: RawMessage,
  templateId: string,
  paramsSummary: string,
): RawMessage {
  const content = msg.content;
  if (typeof content === 'string') {
    return { ...msg, content: paramsSummary };
  }
  if (!Array.isArray(content)) {
    return { ...msg, content: paramsSummary };
  }

  const nextContent: ContentBlock[] = [];
  let inserted = false;

  for (const block of content as ContentBlock[]) {
    if (
      block.type === 'parameter_form'
      && block.formContext?.source === 'workflow'
      && block.formContext.sourceId === templateId
    ) {
      continue;
    }

    if (block.type === 'text' && typeof block.text === 'string') {
      const markerMatch = block.text.match(PARAM_FORM_MARKER_REGEX);
      const hadMarker = markerMatch?.[1] === templateId;
      const stripped = hadMarker
        ? block.text.replace(PARAM_FORM_MARKER_REGEX, '').trim()
        : block.text;

      if (hadMarker || isWorkflowParameterIntroText(stripped)) {
        if (!inserted) {
          nextContent.push({ type: 'text', text: paramsSummary });
          inserted = true;
        }
        continue;
      }
    }

    nextContent.push(block);
  }

  if (!inserted) {
    nextContent.unshift({ type: 'text', text: paramsSummary });
  }

  return { ...msg, content: nextContent };
}

/** 在消息列表中回溯替换工作流 intro（原地修改，返回是否命中）。 */
export function replaceWorkflowIntroWithParamsSummary(
  messages: RawMessage[],
  templateId: string,
  paramsSummary: string,
): boolean {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (!assistantMessageMatchesWorkflowTemplate(messages[i], templateId)) continue;
    messages[i] = replaceAssistantContentWithParamsSummary(
      messages[i],
      templateId,
      paramsSummary,
    );
    return true;
  }
  return false;
}

/** 对当前 chat store 执行 intro → 分组参数摘要替换。 */
export function patchWorkflowIntroInChatStore(
  templateId: string,
  paramsSummary: string,
): boolean {
  let patched = false;
  updateCurrentChatDisplayProjection((current) => {
    const messages = [...current];
    patched = replaceWorkflowIntroWithParamsSummary(messages, templateId, paramsSummary);
    return patched ? messages : current;
  });
  return patched;
}
