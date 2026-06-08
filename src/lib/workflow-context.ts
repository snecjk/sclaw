/**
 * Workflow Context Injection Utilities
 *
 * Injects hidden workflow schema context into user messages so the AI can
 * guide parameter confirmation naturally. The injected block is stripped
 * before display in the chat UI.
 */
import type { WorkflowContextBlock } from '@/stores/chat/types';

export const WORKFLOW_CONTEXT_MARKER = '<!-- StoClaw-Workflow-Context -->';

export function messageHasWorkflowContext(message: string): boolean {
  return message.includes(WORKFLOW_CONTEXT_MARKER);
}

/**
 * Build the human-readable + machine-readable workflow context block.
 */
export function buildWorkflowContextText(context: WorkflowContextBlock): string {
  const fieldsDescription = context.fields
    .map((f, idx) => {
      const required = f.required ? '（必填）' : '（可选）';
      let lines = [`${idx + 1}. **${f.label}** \`${f.key}\` ${required}`];
      if (f.options && f.options.length > 0) {
        const opts = f.options.map((o) => `${o.label}(${o.value})`).join('、');
        lines.push(`   - 可选值：${opts}`);
      }
      if (f.defaultValue !== undefined) {
        lines.push(`   - 默认值：${JSON.stringify(f.defaultValue)}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');

  return [
    WORKFLOW_CONTEXT_MARKER,
    '',
    '```json',
    JSON.stringify(
      {
        version: 1,
        source: 'stoclaw-workflow-context',
        templateId: context.templateId,
        templateName: context.templateName,
        schemaHash: context.schemaHash,
        fields: context.fields,
      },
      null,
      2,
    ),
    '```',
    '',
    `## 工作流参数上下文：${context.templateName}`,
    '',
    '当前用户希望运行上述工作流。请根据以下字段信息，用自然语言引导用户确认参数。如果用户询问参数含义，请使用 JSON 中的字段定义进行解释。',
    '',
    fieldsDescription,
    '',
    '用户原始消息如下：',
    '---',
  ].join('\n');
}

/**
 * Append workflow context to the user message text.
 */
export function appendWorkflowContext(text: string, context?: WorkflowContextBlock | null): string {
  if (!context) return text;
  if (messageHasWorkflowContext(text)) return text;
  const ctxText = buildWorkflowContextText(context);
  return `${ctxText}\n${text}\n${WORKFLOW_CONTEXT_MARKER}`;
}

export const WORKFLOW_COMPLETE_TAG = '[workflow:complete]';

/**
 * Strip injected workflow context blocks for chat UI display.
 */
export function stripWorkflowContextForDisplay(message: string): string {
  if (!messageHasWorkflowContext(message)) return message;

  const startMarker = WORKFLOW_CONTEXT_MARKER;
  const startIdx = message.indexOf(startMarker);
  // The closing marker is always appended at the very end of the message by
  // appendWorkflowContext. Use lastIndexOf to avoid mismatches if the user's
  // original text happens to contain the same marker string.
  const endIdx = message.lastIndexOf(startMarker);

  if (startIdx >= 0 && endIdx > startIdx) {
    const before = message.slice(0, startIdx).trim();
    const after = message.slice(endIdx + startMarker.length).trim();
    return [before, after].filter(Boolean).join('\n');
  }

  // Fallback: remove everything from the first marker to the end if no closing marker
  if (startIdx >= 0) {
    return message.slice(0, startIdx).trim();
  }

  return message;
}

/**
 * Simplify the structured [workflow:complete] user message for display.
 * Returns a short user-friendly label while preserving the raw text for AI context.
 */
export function stripWorkflowCompleteForDisplay(message: string): string {
  if (!message.includes(WORKFLOW_COMPLETE_TAG)) return message;
  const statusMatch = message.match(/^工作流名称：(.+)$/m);
  const name = statusMatch ? statusMatch[1].trim() : '工作流';
  return `「${name}」执行完成，正在生成结果总结...`;
}
