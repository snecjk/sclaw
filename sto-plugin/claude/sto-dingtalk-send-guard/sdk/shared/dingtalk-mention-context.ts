import {
  buildDingTalkFileSendWorkflowContext,
  shouldIncludeDingTalkFileSendWorkflow,
  type DingTalkAttachedFileHint,
} from './dingtalk-file-send';
import {
  appendDingTalkAgentSendDisclaimer,
  DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER,
} from './dingtalk-disclaimer';
import {
  DINGTALK_RECIPIENTS_MARKER,
  hasResolvedDingTalkMentions,
  type DingTalkMention,
} from './dingtalk-mention';
import {
  buildDwsChatMessageSendAgentCommandExample,
  DWS_CHAT_MESSAGE_SEND_AGENT_FORMAT_RULE,
} from './dws-send-text';

export type { DingTalkAttachedFileHint };
export { shouldIncludeDingTalkFileSendWorkflow };

export { DINGTALK_RECIPIENTS_MARKER, hasResolvedDingTalkMentions };
export type { DingTalkMention };

export {
  appendDingTalkAgentSendDisclaimer,
  DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER,
  ensureDingTalkAgentSendDisclaimerFormat,
  hasDingTalkDisclaimerDivider,
} from './dingtalk-disclaimer';

/** @deprecated 使用 DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER */
export const DINGTALK_AGENT_SEND_DISCLAIMER_HTML = DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER;

/** @deprecated 使用 DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER */
export const DINGTALK_AGENT_SEND_DISCLAIMER_MARKDOWN = DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER;

/** 从 StoClaw 对话展示中移除钉钉代发底栏（实际发送仍保留）。 */
export function stripDingTalkAgentSendDisclaimerForDisplay(text: string): string {
  if (!text) return text;

  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n*---\n*\s*<font color=['"]#999999['"]>[\s\S]*?<\/font>\s*/gi, '')
    .replace(/\n*---\n*\s*>\s*\*?[^\n]*STO Claw[^*\n]*代为发送[^\n]*\*?\s*/gi, '')
    .replace(/<font color=['"]#999999['"]>[\s\S]*?<\/font>/gi, '')
    .replace(/\n*>\s*\*?[^*\n]*STO Claw[^*\n]*代为发送[^*\n]*\*?\s*/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildDingTalkSendTextExample(userBody = '你好'): string {
  return appendDingTalkAgentSendDisclaimer(userBody);
}

function buildRecipientPayload(mentions: DingTalkMention[]) {
  return mentions.map((mention) => {
    if (mention.type === 'user') {
      return {
        type: 'user' as const,
        displayName: mention.displayName,
        userId: mention.userId,
        corpId: mention.corpId,
      };
    }
    return {
      type: 'group' as const,
      displayName: mention.displayName,
      openConversationId: mention.openConversationId,
      corpId: mention.corpId,
    };
  });
}

function buildSendCommandHints(mentions: DingTalkMention[]): string[] {
  const textExample = buildDingTalkSendTextExample('你好');
  return mentions.flatMap((mention) => {
    if (mention.type === 'user' && mention.userId) {
      return [
        `- ${mention.displayName}: ${buildDwsChatMessageSendAgentCommandExample({
          recipientKind: 'user',
          recipientId: mention.userId,
          text: textExample,
        })}`,
      ];
    }
    if (mention.type === 'group' && mention.openConversationId) {
      return [
        `- ${mention.displayName}: ${buildDwsChatMessageSendAgentCommandExample({
          recipientKind: 'group',
          recipientId: mention.openConversationId,
          text: textExample,
        })}`,
      ];
    }
    return [];
  });
}

export function messageHasDingTalkRecipientContext(message: string): boolean {
  return message.includes(DINGTALK_RECIPIENTS_MARKER)
    || message.includes('<!-- StoClaw-DingTalk-Recipients: do-not-search -->')
    || message.includes('## StoClaw DingTalk Recipients');
}

/** Strip injected DingTalk recipient blocks for chat UI display. */
export function stripDingTalkMentionContextForDisplay(message: string): string {
  if (!messageHasDingTalkRecipientContext(message)) return message;

  const userMsgMarker = '\n用户消息：\n';
  const markerIndex = message.indexOf(userMsgMarker);
  if (markerIndex >= 0) {
    return message.slice(markerIndex + userMsgMarker.length).trim();
  }

  const legacySplit = message.split('\n---\n');
  if (legacySplit.length >= 2) {
    return legacySplit[legacySplit.length - 1].replace(/^用户消息：\n?/, '').trim();
  }

  return message;
}

export interface DingTalkMentionContextOptions {
  sendFileIntent?: boolean;
  attachedFiles?: DingTalkAttachedFileHint[];
}

export function buildDingTalkMentionSystemContext(
  mentions: DingTalkMention[],
  options?: DingTalkMentionContextOptions,
): string {
  const recipients = buildRecipientPayload(mentions);
  const sendCommandHints = buildSendCommandHints(mentions);
  const jsonBlock = JSON.stringify(
    {
      version: 1,
      source: 'stoclaw-input-mention',
      recipients,
    },
    null,
    2,
  );

  return [
    DINGTALK_RECIPIENTS_MARKER,
    '```json',
    jsonBlock,
    '```',
    '',
    '## StoClaw DingTalk Recipients（对话 @ 或定时任务已配置）',
    '',
    '以上 JSON 中的 userId / openConversationId 由用户在 StoClaw（对话 @ 或定时任务收件人）中**手动选定**，与显示名一一对应，可直接用于发送。',
    '',
    '**必须遵守：**',
    '1. **禁止**对 JSON 内收件人执行 `dws contact user search`、`dws aisearch person` 或任何搜人/搜群命令',
    '2. **禁止**使用 OpenClaw `message` 工具（channel=dingtalk）或把 displayName 当作 target',
    '3. **必须**使用 `dws chat message send`，收件人参数只能取自 JSON（`--user` / `--group`）',
    '4. **对话 @ 场景默认是“代用户转发/发送消息”**：`用户消息：` 后面的内容就是要发给钉钉收件人的原文。除非用户明确要求你改写/总结/生成文案，否则不得先回答这个问题、不得把你的回复当作 `--text` 正文发送。',
    '5. 发送前可与用户确认正文，或使用 `--dry-run`；但如果用户消息已经是可直接发送的问候/问题/通知，直接发送原文即可。',
    '6. **`--title` 必填**（单聊/群聊均需）；无特定标题时用 `消息`',
    '7. **正文**用钉钉 IM Markdown：`###` 标题、`**加粗**`、`-` 列表等；段落之间要换行空一行；正文内**禁止** HTML（`<font>`、`<br>` 等会乱版）',
    `8. ${DWS_CHAT_MESSAGE_SEND_AGENT_FORMAT_RULE}`,
    '9. **正文末尾必须附加代发说明**（`---` 分隔线 + Markdown 引用说明，固定格式）：',
    '   ```',
    '   {用户正文}',
    '',
    '   ---',
    '',
    `   ${DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER}`,
    '   ```',
    '   将 `{用户正文}` 替换为 `用户消息：` 后面的原文；分隔线与说明文案不得改写或省略。',
    '10. 发送成功后，最终回复可简短确认即可；**完整发送正文**会在 StoClaw 对话卡片中自动展示，无需在回复里重复粘贴全文。',
    '11. **安全**：禁止循环/批量调用 `dws chat message send`（含 shell `for`/`while`）；同一对话内 **文字** 与 **图片/文件** 分别限流：各 **每 20 秒最多成功发送 1 条**（仅 `dws` 返回成功才计入；`--dry-run` 不计入）。',
    '',
    '预填命令示例（格式与 StoClaw 自动修正逻辑一致；`--text` 已含代发说明，发送时把示例中的「你好」换成实际正文）：',
    ...sendCommandHints,
    ...(options?.sendFileIntent
      ? [buildDingTalkFileSendWorkflowContext(mentions, options.attachedFiles)]
      : []),
  ].join('\n');
}

/**
 * Wraps the user message with machine-readable DingTalk recipient metadata.
 * Recipients are placed at the top so the agent sees IDs before acting.
 */
export function appendDingTalkMentionContext(
  text: string,
  mentions?: DingTalkMention[],
  options?: DingTalkMentionContextOptions,
): string {
  if (!hasResolvedDingTalkMentions(mentions)) return text;

  const header = [
    buildDingTalkMentionSystemContext(mentions!, options),
    '',
    '---',
    '',
    '用户消息：',
    text,
  ].join('\n');

  return header;
}

export function ensureChatSendMessageWithDingTalkMentions(
  message: string,
  mentions?: DingTalkMention[],
  options?: DingTalkMentionContextOptions,
): string {
  if (!hasResolvedDingTalkMentions(mentions)) return message;
  if (messageHasDingTalkRecipientContext(message)) return message;
  return appendDingTalkMentionContext(message, mentions, options);
}

/** IPC/Main-only metadata; stripped before OpenClaw Gateway chat.send. */
export function buildDingTalkMentionRpcExtras(
  mentions?: DingTalkMention[],
  attachedFiles?: DingTalkAttachedFileHint[],
): Record<string, unknown> | undefined {
  if (!hasResolvedDingTalkMentions(mentions)) return undefined;

  const extras: Record<string, unknown> = { dingTalkMentions: mentions! };
  if (shouldIncludeDingTalkFileSendWorkflow(mentions, attachedFiles)) {
    extras.dingTalkSendFileIntent = true;
    extras.dingTalkAttachedFiles = attachedFiles!.filter((file) => !file.mimeType.startsWith('image/'));
  }
  return extras;
}
