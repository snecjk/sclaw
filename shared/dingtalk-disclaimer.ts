/**
 * DingTalk 代发说明底栏：分隔线 + 灰色字（仅 color，勿加 size，避免客户端乱版）。
 */

export const DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER =
  '<font color="#999999">本消息由 STO Claw 代为发送，非本人实时回复。</font>';

export const DINGTALK_AGENT_SEND_DISCLAIMER_MARKER = 'STO Claw 代为发送';

/** 正文与代发说明之间已有 `---` 分隔线。 */
export function hasDingTalkDisclaimerDivider(text: string): boolean {
  return /\n---\n[\s\S]*STO Claw 代为发送/i.test(text);
}

/**
 * 确保钉钉发送正文末尾为「--- + 代发说明」标准格式。
 * 若已有说明但缺分隔线（定时任务等场景常见），自动补上。
 */
export function ensureDingTalkAgentSendDisclaimerFormat(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER;

  if (!trimmed.includes(DINGTALK_AGENT_SEND_DISCLAIMER_MARKER)) {
    return `${trimmed}\n\n---\n\n${DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER}`;
  }

  if (hasDingTalkDisclaimerDivider(trimmed)) {
    return trimmed;
  }

  const htmlFooterMatch = trimmed.match(
    /^([\s\S]*?)(\n*)\s*(<font color="#999999">[\s\S]*?STO Claw 代为发送[\s\S]*?<\/font>)\s*$/i,
  );
  if (htmlFooterMatch) {
    const bodyPart = htmlFooterMatch[1].trimEnd();
    const footer = htmlFooterMatch[3];
    return `${bodyPart}\n\n---\n\n${footer}`;
  }

  const plainMatch = trimmed.match(/^([\s\S]*?)(\n*)([^\n<]*STO Claw 代为发送[^\n<]*)\s*$/i);
  if (plainMatch) {
    const bodyPart = plainMatch[1].trimEnd();
    return `${bodyPart}\n\n---\n\n${DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER}`;
  }

  return trimmed;
}

/** 在 dws `chat message send --text` 正文末尾附加固定代发说明。 */
export function appendDingTalkAgentSendDisclaimer(body: string): string {
  return ensureDingTalkAgentSendDisclaimerFormat(body);
}
