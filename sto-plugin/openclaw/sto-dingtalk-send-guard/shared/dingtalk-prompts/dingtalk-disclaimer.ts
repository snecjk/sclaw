/**
 * Self-contained copy for Gateway extension install (~/.stoclaw/openclaw/extensions/...).
 * Keep in sync with repository root `shared/dingtalk-prompts/dingtalk-disclaimer.ts`.
 * Regenerate: `pnpm run sync:plugin-shared`
 */
export const DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER =
  '> *本消息由 SClaw 代为发送，非本人实时回复。*';

/** @deprecated 旧版 HTML 属性，规范化时会被替换 */
export const DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER_LEGACY =
  '<font color="#999999">本消息由 SClaw 代为发送，非本人实时回复。</font>';

export const DINGTALK_AGENT_SEND_DISCLAIMER_MARKER = 'SClaw 代为发送';

/** 聊天 UI 展示用纯文案（不含 HTML）。 */
export const DINGTALK_AGENT_SEND_DISCLAIMER_PLAIN_TEXT =
  '本消息由 SClaw 代为发送，非本人实时回复。';

/** @deprecated 使用 DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER */
export const DINGTALK_AGENT_SEND_DISCLAIMER_HTML = DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER;

/** @deprecated 使用 DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER */
export const DINGTALK_AGENT_SEND_DISCLAIMER_MARKDOWN = DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER;

const DISCLAIMER_FONT_BLOCK =
  /<font\s+color=['"]#999999['"][^>]*>[\s\S]*?<\/font>/gi;

/** 正文与代发说明之间已有 `---` 分隔线。 */
export function hasDingTalkDisclaimerDivider(text: string): boolean {
  return /\n---\n[\s\S]*S\s*Claw\s*代为发送/i.test(text);
}

/**
 * 发送路径：去掉已有代发底栏（含破损 HTML、重复文案），只保留正文。
 * 以末尾 `---` 分段为主，再清尾部残片。
 */
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
    .replace(/\n*>\s*\*?[^\n]*S\s*Claw\s*代为发送[^\n]*\*?\s*$/gi, '')
    .replace(/\n*#999999>[^\n]*S\s*Claw\s*代为发送[^\n]*\s*$/gi, '')
    .replace(/\n*[^\n<]*S\s*Claw\s*代为发送[^\n<]*\s*$/gi, '')
    .replace(DISCLAIMER_FONT_BLOCK, '')
    .trim();
}

/**
 * UI 展示：去掉全文中的代发底栏（含中间 echo）。
 * 与 stripBody（发送路径、砍末尾 --- 段）分开：展示需保留底栏后的追问句。
 */
export function stripDingTalkAgentSendDisclaimerForDisplay(text: string): string {
  if (!text) return text;

  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n*---\n*\s*<font color=['"]#999999['"]>[\s\S]*?<\/font>\s*/gi, '')
    .replace(/\n*---\n*\s*>\s*\*?[^\n]*S Claw[^*\n]*代为发送[^\n]*\*?\s*/gi, '')
    .replace(/<font color=['"]#999999['"]>[\s\S]*?<\/font>/gi, '')
    .replace(/\n*>\s*\*?[^*\n]*S Claw[^*\n]*代为发送[^*\n]*\*?\s*/gi, '')
    .replace(/\n{3,}/g, '\n\n')
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
