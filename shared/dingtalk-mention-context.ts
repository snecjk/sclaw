import {
  buildDingTalkFileSendWorkflowContext,
  shouldIncludeDingTalkFileSendWorkflow,
  type DingTalkAttachedFileHint,
} from './dingtalk-file-send';
import { shellQuoteDwsSendTextForBash } from './dws-send-text';
import {
  DINGTALK_RECIPIENTS_MARKER,
  hasResolvedDingTalkMentions,
  type DingTalkMention,
} from './dingtalk-mention';

export type { DingTalkAttachedFileHint };
export { shouldIncludeDingTalkFileSendWorkflow };

export { DINGTALK_RECIPIENTS_MARKER, hasResolvedDingTalkMentions };
export type { DingTalkMention };

/**
 * 代发说明底栏：分隔线 + 灰色字（仅 color，勿加 size，避免客户端乱版）。
 * 正文其余部分仍用 Markdown，勿在正文里混用 HTML。
 */
export const DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER =
  '<font color="#999999">本消息由 STO Claw 代为发送，非本人实时回复。</font>';

/** @deprecated 使用 DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER */
export const DINGTALK_AGENT_SEND_DISCLAIMER_HTML = DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER;

/** @deprecated 使用 DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER */
export const DINGTALK_AGENT_SEND_DISCLAIMER_MARKDOWN = DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER;

const DINGTALK_AGENT_SEND_DISCLAIMER_MARKER = 'STO Claw 代为发送';

/** 从 StoClaw 对话展示中移除钉钉代发底栏（实际发送仍保留）。 */
export function stripDingTalkAgentSendDisclaimerForDisplay(text: string): string {
  if (!text) return text;

  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n*---\n*\s*<font color="#999999">[\s\S]*?<\/font>\s*/gi, '')
    .replace(/<font color="#999999">[\s\S]*?<\/font>/gi, '')
    .replace(/\n*>\s*\*?[^*\n]*STO Claw[^*\n]*代为发送[^*\n]*\*?\s*/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 在 dws `chat message send --text` 正文末尾附加固定代发说明。 */
export function appendDingTalkAgentSendDisclaimer(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER;
  if (trimmed.includes(DINGTALK_AGENT_SEND_DISCLAIMER_MARKER)) return trimmed;
  return `${trimmed}\n\n---\n\n${DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER}`;
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
        `- ${mention.displayName}: dws chat message send --user ${mention.userId} --title "消息" --text ${shellQuoteDwsSendTextForBash(textExample)} --format json`,
      ];
    }
    if (mention.type === 'group' && mention.openConversationId) {
      return [
        `- ${mention.displayName}: dws chat message send --group ${mention.openConversationId} --title "消息" --text ${shellQuoteDwsSendTextForBash(textExample)} --format json`,
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
    '## StoClaw DingTalk Recipients（输入框 @ 已选定）',
    '',
    '以上 JSON 中的 userId / openConversationId 由用户在 StoClaw 输入框通过 @ 搜索并**手动选定**，与显示名一一对应，可直接用于发送。',
    '',
    '**必须遵守：**',
    '1. **禁止**对 JSON 内收件人执行 `dws contact user search`、`dws aisearch person` 或任何搜人/搜群命令',
    '2. **禁止**使用 OpenClaw `message` 工具（channel=dingtalk）或把 displayName 当作 target',
    '3. **必须**使用 `dws chat message send`，收件人参数只能取自 JSON（`--user` / `--group`）',
    '4. 发送前可与用户确认正文，或使用 `--dry-run`',
    '5. **`--title` 必填**（单聊/群聊均需）；无特定标题时用 `消息`',
    '6. **正文**用钉钉 IM Markdown：`###` 标题、`**加粗**`、`-` 列表等；段落之间用**真实换行**（空一行）；**禁止**在 `--text` 里写字面量 `\\n` 两个字符；正文内**禁止** HTML（`<br>` 等会乱版，代发说明行的 `<font color>` 除外）',
    '7. **正文末尾必须附加代发说明**（`---` 分隔线 + 灰色说明，固定格式；说明行仅此一处可用 `<font color>`，**禁止** `size` 属性）：',
    '   ```',
    '   {用户正文}',
    '',
    '   ---',
    '',
    `   ${DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER}`,
    '   ```',
    '   将 `{用户正文}` 替换为实际内容；分隔线与说明文案不得改写或省略。',
    '8. 发送成功后，最终回复可简短确认即可；**完整发送正文**会在 StoClaw 对话卡片中自动展示，无需在回复里重复粘贴全文。',
    '9. **安全**：禁止循环/批量调用 `dws chat message send`（含 shell `for`/`while`）；同一对话 **每分钟最多实际发送 1 条**（`--dry-run` 不计入）。',
    '',
    '预填命令示例（`--text` 已含代发说明，发送时把示例中的「你好」换成实际正文）：',
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
