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
    '⚠️ **重要指令：当前已处于前端工作流引导模式，前端已加载参数表单供用户交互确认。请直接引导用户确认上述参数，不要调用 sai-cli、read、exec 或任何其他工具来探索业务系统命令。所有参数定义已在上文 JSON 中提供，无需额外查询。**',
    '',
    '⚠️ **重要指令：在你的回复末尾，必须输出一个结构化的工作流表单标记（单独一行），以便前端渲染参数表单。格式如下（必须完全一致）：**',
    '',
    '```',
    '<ParameterForm templateId="' + context.templateId + '" schemaHash="' + context.schemaHash + '" />',
    '```',
    '',
    fieldsDescription,
  ].join('\n');
}

/**
 * Append workflow context to the user message text.
 */
export function appendWorkflowContext(text: string, context?: WorkflowContextBlock | null): string {
  if (!context) return text;
  if (messageHasWorkflowContext(text)) return text;
  const ctxText = buildWorkflowContextText(context);
  // Format: [context block]\n<!-- StoClaw-Workflow-Context -->\n[user original text]
  // The user text is placed AFTER the closing marker so it survives stripWorkflowContextForDisplay.
  return `${ctxText}\n${WORKFLOW_CONTEXT_MARKER}\n${text}`;
}

export const WORKFLOW_COMPLETE_TAG = '[workflow:complete]';

/**
 * Strip injected workflow context blocks for chat UI display.
 */
export function stripWorkflowContextForDisplay(message: string): string {
  if (!messageHasWorkflowContext(message)) return message;

  const startMarker = WORKFLOW_CONTEXT_MARKER;
  const startIdx = message.indexOf(startMarker);
  // The closing marker is placed between the context block and user text by
  // appendWorkflowContext. Use lastIndexOf to find the one just before user text.
  const endIdx = message.lastIndexOf(startMarker);

  if (startIdx >= 0 && endIdx > startIdx) {
    // Return only the text AFTER the closing marker (user's original message)
    const after = message.slice(endIdx + startMarker.length).trim();
    return after;
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
  return '';
}
