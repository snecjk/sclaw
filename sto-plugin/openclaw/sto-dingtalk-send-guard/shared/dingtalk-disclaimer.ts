/**
 * DingTalk 代发说明底栏：纯 Markdown 引用，避免 IM 客户端把 HTML 当普通文本展示。
 */
export const DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER =
  '> *本消息由 STO Claw 代为发送，非本人实时回复。*';

/** @deprecated 旧版 HTML 属性，规范化时会被替换 */
export const DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER_LEGACY =
  '<font color="#999999">本消息由 STO Claw 代为发送，非本人实时回复。</font>';

export const DINGTALK_AGENT_SEND_DISCLAIMER_MARKER = 'STO Claw 代为发送';

const DISCLAIMER_FONT_BLOCK =
  /<font\s+color=['"]#999999['"][^>]*>[\s\S]*?<\/font>/gi;

/** 正文与代发说明之间已有 `---` 分隔线。 */
export function hasDingTalkDisclaimerDivider(text: string): boolean {
  return /\n---\n[\s\S]*STO Claw 代为发送/i.test(text);
}

/** 去掉已有代发底栏（含破损 HTML、重复文案），只保留正文。 */
export function stripDingTalkAgentSendDisclaimerBody(text: string): string {
  if (!text) return '';

  let result = text.replace(/\r\n/g, '\n').trim();
  const dividerIdx = result.lastIndexOf('\n---\n');
  if (dividerIdx >= 0) {
    result = result.slice(0, dividerIdx).trimEnd();
  }

  return result
    .replace(/\n*<font\s+color=[^\n>]*>[\s\S]*?<\/font>\s*$/gi, '')
    .replace(/\n*<font\s+color=[^\n>]*\s*$/gi, '')
    .replace(/\n*>\s*\*?[^\n]*STO Claw 代为发送[^\n]*\*?\s*$/gi, '')
    .replace(/\n*#999999>[^\n]*STO Claw 代为发送[^\n]*\s*$/gi, '')
    .replace(/\n*[^\n<]*STO Claw 代为发送[^\n<]*\s*$/gi, '')
    .replace(DISCLAIMER_FONT_BLOCK, '')
    .trim();
}

/**
 * 确保钉钉发送正文末尾为「--- + 唯一代发说明」标准格式。
 * 分割线下方只保留一句固定文案。
 */
export function ensureDingTalkAgentSendDisclaimerFormat(body: string): string {
  const bodyOnly = stripDingTalkAgentSendDisclaimerBody(body);
  if (!bodyOnly) return DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER;
  return `${bodyOnly}\n\n---\n\n${DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER}`;
}

/** 在 dws `chat message send --text` 正文末尾附加固定代发说明。 */
export function appendDingTalkAgentSendDisclaimer(body: string): string {
  return ensureDingTalkAgentSendDisclaimerFormat(body);
}
