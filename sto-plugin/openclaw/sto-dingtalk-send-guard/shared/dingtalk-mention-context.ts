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
    .replace(/\n*---\n*\s*>\s*\*?[^\n]*S Claw[^*\n]*代为发送[^\n]*\*?\s*/gi, '')
    .replace(/<font color=['"]#999999['"]>[\s\S]*?<\/font>/gi, '')
    .replace(/\n*>\s*\*?[^*\n]*S Claw[^*\n]*代为发送[^*\n]*\*?\s*/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildDingTalkSendTextExample(userBody = '<正文>'): string {
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
  const textExample = buildDingTalkSendTextExample();
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

  // System-context injection only (no `用户消息：` body) — not human-visible text.
  return '';
}

export interface DingTalkMentionContextOptions {
  sendFileIntent?: boolean;
  attachedFiles?: DingTalkAttachedFileHint[];
  /** 收件人块语义场景。`'scheduled-task'` 为定时任务必发语义；默认 `'chat'` 为对话 @ 需明确发送意图。 */
  scenario?: 'chat' | 'scheduled-task';
}

/** 收件人 JSON 块头部 + 规则 1–3（对话 / 定时任务共用）。 */
function buildRecipientHeader(mentions: DingTalkMention[]): string[] {
  const recipients = buildRecipientPayload(mentions);
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
  ];
}

/** 发送格式与安全规则 6–11（对话 / 定时任务共用）。 */
function buildSendFormatRules(): string[] {
  return [
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
    '11. **安全**：禁止循环/批量调用 `dws chat message send`（含 shell `for`/`while`）；同一对话内 **文字** 与 **图片/文件** 分别限流：各 **每 20 秒最多发起 1 条**（**发起即计**：放行瞬间即记时间戳，失败/重试也占窗口；`--dry-run` 不计入）。**被挡时禁止绕过**——不要尝试 `sh -c`/heredoc/`2>&1` 套壳、`sai-cli message` 或换任何 CLI，StoClaw 钩子正则扫命令文本里的 `dws chat message send`，套壳照样命中、绕不过。正确处置：①若提示 `--text` 格式问题，改用 `--text "正文\\n\\n---\\n\\n> *代发说明*"` 双引号 + `\\n` 写法（勿用 `$\\\'...\\\'` / `$变量`）；②若提示"发送过于频繁"，等满 20 秒再发，或先 `--dry-run` 自检格式（不计窗口）。',
  ];
}

function buildCommandExampleHint(mentions: DingTalkMention[]): string[] {
  return [
    '',
    '命令格式示例（仅展示 `--text` 写法与代发说明格式，**禁止原样执行**；发送时把 `<正文>` 占位符替换为实际内容）：',
    ...buildSendCommandHints(mentions),
  ];
}

function buildFileSendContextIfAny(
  mentions: DingTalkMention[],
  options?: DingTalkMentionContextOptions,
): string[] {
  return options?.sendFileIntent
    ? [buildDingTalkFileSendWorkflowContext(mentions, options.attachedFiles)]
    : [];
}

/** 对话 @ 场景：@ 不等于要求发送，需用户明确发送意图；含读取群/单聊历史指引。 */
export function buildDingTalkMentionSystemContext(
  mentions: DingTalkMention[],
  options?: DingTalkMentionContextOptions,
): string {
  return [
    ...buildRecipientHeader(mentions),
    '4. **对话 @ 场景：@ 收件人仅表示用户已选定一个钉钉发送对象，不等于要求发送——是否发送完全取决于用户消息里有没有发送意图。** 出现"发送/转发/通知/告诉/发给/推送给/把…发给/把总结发给他/发给他/发给这个群"等（含指代收件人的"他/她/他们/这个群"等代词）即为**明确要求发送**，须按规则 5 发送。若用户只让你针对该收件人做总结、分析、查看、检索、回答等而**没有上述发送意图**，**禁止发送、也禁止追问"是否需要发送/要不要发"**，直接在对话中回复用户即可。你可以读取钉钉群/单聊历史消息：**单聊（如"@X 总结我们的聊天"）用 `dws chat message list-direct --user <userId> --time "<起始时间>" --forward=true --limit 50`**——`--user` 传对方 userId（取自本块 JSON），直接返回你们俩的私聊消息，**无需 jq 过滤**；`--forward=true` 从老往新、`=false` 从新往老；`--time` 是**起始时间**（最早边界，必填，格式 `yyyy-MM-dd HH:mm:ss`，**不要用 ISO `T`/`Z`**）。要"最近 N 个月/天"时，起始时间 = 今天往前推 N：先跑 `date -v-3m "+%Y-%m-%d %H:%M:%S"`（macOS）或 `date -d "3 months ago" "+%Y-%m-%d %H:%M:%S"`（linux）算出再填入 `--time`，**禁止写死旧日期**（写死会拉到无关老消息或漏掉近期）。**单聊读取同样偶发返空、短时内连读会被限流，间隔几秒重试 1-2 次再判定，禁止把"无聊天记录/无权限"当总结发到钉钉**。群聊用 `dws chat message list --group <openConversationId> --time "<1个月前>" --forward=true --limit 50`——`--time` 必填且**固定取最近一个月**（不要自由选取其他区间）：先跑 `date -v-1m "+%Y-%m-%d %H:%M:%S"`（macOS）或 `date -d "1 month ago" "+%Y-%m-%d %H:%M:%S"`（linux）算出 1 个月前时间填入 `--time`，`--forward=true` 从该时间往新读（老→新）、`--limit 50` 取当月最早 50 条（`hasMore=true` 说明当月还有更多）；**勿用 `--forward=false`——它是从 `--time` 往老读（取 `--time` 之前的老消息），拿 1 个月前当 `--time` 必然返空**。**不传 `--time` 也会返回空 `messages: []`、误判"无记录"**。按关键词用 `dws chat message search`（群 ID 用 `dws chat search --query` 查）。**若读取返回空或报权限/限流错误，先排查 `--time` 是否缺失/群 ID 是否正确；读接口偶发返空、短时间内连读会被限流，间隔几秒重试 1-2 次再判定——禁止把"无聊天记录/暂无记录/无权限"当总结发到钉钉**，确认真为空或真无权限再在对话里如实告知用户原因。**禁止用 `dws chat message list-all` 配 jq 按 userId 过滤单聊**——消息记录里是 `senderOpenDingTalkId`（形如 `D1sn...` 字母串），与 `userId`（数字串）不是同一个 ID，按 userId 过滤必然全空，会误判"无聊天记录"。若用户要求总结群/会话内容，**先读取真实历史再总结**，**不要编造内容、不要发送任何占位/示例文本**。',
    '5. **用户已明确要求发送时，直接发送，不要回头追问"需要我发送吗/是否发送"——用户已下指令，再问等于让用户重复一遍。** 正文由你根据上下文直接组织（如用户让你"把总结发给他"，就把你刚产出的总结作为正文，无需先确认内容）。发送前可用 `--dry-run` 自检 `--text` 格式与代发说明，但 `--dry-run` 仅用于自检、不许用它的输出来向用户请示是否发送。**禁止把本块下方的命令示例原样执行**——示例仅展示 `--text` 格式，占位符须替换为实际正文。',
    ...buildSendFormatRules(),
    ...buildCommandExampleHint(mentions),
    ...buildFileSendContextIfAny(mentions, options),
  ].join('\n');
}

/**
 * 定时任务场景：块内收件人**必须**发送，发送不是可选项，无需用户消息含发送意图词。
 * 去掉对话 @ 的"读历史/总结"指引（定时任务用不上，且是 agent 跑偏来源）。
 * 产物链接 / 本地产物上钉盘等规则见系统提示 `SCHEDULED_TASK_EXECUTION_SYSTEM_PROMPT` 的 P0 条目。
 */
export function buildDingTalkMentionSystemContextForScheduledTask(
  mentions: DingTalkMention[],
  options?: DingTalkMentionContextOptions,
): string {
  return [
    ...buildRecipientHeader(mentions),
    '4. **定时任务执行场景：以上 JSON 内收件人必须发送，发送不是可选项——无需用户消息含"发送/发给/推送给"等意图词，指定即必发。** 对每个收件人用 `dws chat message send`（`--user` / `--group` 取自上方 JSON）把任务/工作流结果发出去；多收件人逐个发送（每个一条命令）。正文先精炼一句话总结再发，不要把工作流原始 JSON 当 `--text`。产物链接 / 本地产物上钉盘等格式遵守系统提示 `SCHEDULED_TASK_EXECUTION_SYSTEM_PROMPT` 的【P0 产物链接格式】与【P0 本地产物上钉盘】条目（`file://` 禁入正文、用「label：裸 URL」、不再 `encodeURI`）。',
    '5. 正文由你根据任务/工作流结果直接组织，无需向用户确认是否发送或内容（定时任务无人在场交互）。发送前可用 `--dry-run` 自检 `--text` 格式与代发说明，但 `--dry-run` 仅用于自检、不许用来请示。**禁止把本块下方的命令示例原样执行**——示例仅展示 `--text` 格式，占位符须替换为实际正文。',
    ...buildSendFormatRules(),
    ...buildCommandExampleHint(mentions),
    ...buildFileSendContextIfAny(mentions, options),
  ].join('\n');
}

function resolveMentionSystemContextBuilder(
  scenario?: 'chat' | 'scheduled-task',
): (mentions: DingTalkMention[], options?: DingTalkMentionContextOptions) => string {
  return scenario === 'scheduled-task'
    ? buildDingTalkMentionSystemContextForScheduledTask
    : buildDingTalkMentionSystemContext;
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

  const buildContext = resolveMentionSystemContextBuilder(options?.scenario);
  const header = [
    buildContext(mentions!, options),
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
