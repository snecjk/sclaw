/**
 * Self-contained copy for Gateway extension install (~/.stoclaw/openclaw/extensions/...).
 * Keep in sync with repository root `shared/dingtalk-prompts/dingtalk-mention-context.ts`.
 * Regenerate: `pnpm run sync:plugin-shared`
 */
import {
  DINGTALK_SEND_FORMAT_RULES,
  DINGTALK_SEND_FORMAT_RULES_FOR_SCHEDULED_TASK,
} from './dingtalk-send-rules';
import {
  buildDingTalkFileSendWorkflowContext,
  shouldIncludeDingTalkFileSendWorkflow,
  type DingTalkAttachedFileHint,
} from '../dingtalk-send/dingtalk-file-send';
import {
  appendDingTalkAgentSendDisclaimer,
} from './dingtalk-disclaimer';
import {
  DINGTALK_RECIPIENTS_MARKER,
  hasResolvedDingTalkMentions,
  normalizeDingTalkMentions,
  type DingTalkMention,
} from '../dingtalk-send/dingtalk-mention';
import {
  buildDwsChatMessageSendAgentCommandExample,
} from '../dingtalk-send/dws-send-text';

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

/** 文本是否含钉钉收件人块（marker / legacy 注释 / 新旧标题）。 */
export function messageHasDingTalkRecipientContext(message: string): boolean {
  return message.includes(DINGTALK_RECIPIENTS_MARKER)
    || message.includes('<!-- StoClaw-DingTalk-Recipients: do-not-search -->')
    || message.includes('## StoClaw DingTalk Recipients')
    || message.includes('## SClaw DingTalk Recipients');
}

/**
 * Parse the recipient JSON block injected by `buildDingTalkMentionSystemContext`
 * back into `DingTalkMention[]`. Used by the Claude scheduled-task worker's
 * timeout watchdog to recover recipients from a stored `promptTemplate` without
 * a separate recipients field on the definition.
 *
 * Returns `null` when no recipient block is found or the JSON is malformed.
 */
export function parseDingTalkRecipientsFromText(text: string): DingTalkMention[] | null {
  if (!text || !messageHasDingTalkRecipientContext(text)) return null;

  const markerIdx = text.indexOf(DINGTALK_RECIPIENTS_MARKER);
  const searchFrom = markerIdx >= 0 ? markerIdx + DINGTALK_RECIPIENTS_MARKER.length : 0;
  const fenceStart = text.indexOf('```json', searchFrom);
  if (fenceStart < 0) return null;
  const jsonStart = fenceStart + '```json'.length;
  const fenceEnd = text.indexOf('```', jsonStart);
  if (fenceEnd < 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(jsonStart, fenceEnd).trim());
  } catch {
    return null;
  }

  const recipients = (parsed as { recipients?: unknown }).recipients;
  const result = normalizeDingTalkMentions(recipients);
  return result.length > 0 ? result : null;
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
  /** 用户明确要求产物保存到钉盘/钉钉云盘时，跳过临时 OSS 工具。 */
  forceDingTalkDriveUpload?: boolean;
  /** 收件人块语义场景。`'scheduled-task'` 为定时任务必发语义；默认 `'chat'` 为对话 @ 需明确发送意图。 */
  scenario?: 'chat' | 'scheduled-task';
  /**
   * 对话 @：本轮用户是否明确要求发送。
   * false/缺省 → 只注入只读/总结指引，**不**附带 send 格式与命令示例（防「总结该群」误发）。
   * true → 注入完整发送规则。
   * 定时任务场景忽略本字段。
   */
  explicitSendIntent?: boolean;
}

/**
 * 对话 @ 场景：用户是否明确要求把内容发到钉钉收件人。
 * 「总结/分析/查看该群聊天记录」等只读句不算；单独的「通知/告诉」也不算。
 */
export function looksLikeDingTalkMentionSendIntent(text: string | undefined | null): boolean {
  const trimmed = text?.trim();
  if (!trimmed) return false;

  // 明确否定发送时，不得因后面的“发送给/发送到”字样误判。
  if (/(?:不要|不需要|无需|禁止|别|不准|暂不|先不)\s*(?:再|进行)?\s*(?:发|发送|转发|推送|分享)/u.test(trimmed)) {
    return false;
  }

  // 命令式“发送 + 任意业务内容 + 给/到目标”，覆盖“发送天气数据和截图到群聊”。
  // 限定在句首或分句边界，避免把“查看别人发送到群里的截图”误判成本轮发送。
  if (/(?:^|[，,。；;！!\n])\s*(?:请|再|然后|并|同时)?\s*(?:发|发送|转发|推送|分享).{0,100}(?:给|到|至)\s*(?:@|群|群聊|群里|钉钉|联系人|同事|部门|团队)/u.test(trimmed)) {
    return true;
  }

  // 明确「发给/发送给/推送给/转发给/分享给/发到群…」
  if (/(?:发给|发送给|推送给|转发给|转发到|分享给|发到(?:这个)?群|发到钉钉)/.test(trimmed)) {
    return true;
  }
  // 「把/将 … 发给/发到…」
  if (/(?:把|将).{0,48}(?:发给|发送给|发到|推送给|转发)/.test(trimmed)) {
    return true;
  }
  // 「给张三发 / 给他们发：…」（口语「给 X 发」）
  if (/给[\u4e00-\u9fffA-Za-z0-9·•._-]{1,24}发(?:送|消息|一下|条|个|：|:)?/.test(trimmed)) {
    return true;
  }
  // 「发送一下 / 发送出去」也须是句首或分句后的命令式表达。
  if (/(?:^|[，,。；;！!\n])\s*(?:请|再|然后|并|同时)?\s*发送(?:给|到|一下|出去|到群)/u.test(trimmed)) {
    return true;
  }
  // 「发总结/报告到群」类
  if (/发(?:送)?(?:总结|结果|报告|内容|纪要).{0,12}(?:给|到)/.test(trimmed)) {
    return true;
  }
  return false;
}

/** 用户是否明确要求把文件上传或保存到钉盘。否定表达不算。 */
export function looksLikeDingTalkDriveUploadIntent(text: string | undefined | null): boolean {
  const trimmed = text?.trim();
  if (!trimmed) return false;
  const drive = '(?:钉盘|钉钉云盘)';
  const negated = new RegExp(`(?:不要|不需要|无需|禁止|别|不准).{0,10}${drive}|${drive}.{0,10}(?:不要|不需要|无需|禁止|别|不准)`);
  if (negated.test(trimmed)) return false;
  return new RegExp(`(?:上传|传|放|存|保存|存储|同步)(?:到|至|进|入)?${drive}|(?:使用|用|走)${drive}|${drive}(?:里|中|上)?(?:上传|保存|存储|放|存|同步)`).test(trimmed);
}

/** 收件人 JSON 块头部 + 规则 1–3。chat-read 弱化「必须 send」措辞。 */
function buildRecipientHeader(
  mentions: DingTalkMention[],
  mode: 'chat-read' | 'chat-send' | 'scheduled-task',
): string[] {
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

  const title =
    mode === 'scheduled-task'
      ? '## SClaw DingTalk Recipients（定时任务已配置）'
      : '## SClaw DingTalk Recipients（对话 @ 已选定对象）';

  const rule3 =
    mode === 'chat-read'
      ? '3. **本轮默认禁止发送**：不要调用 `dws chat message send`。JSON 内 id 仅用于读取历史（`list` / `list-direct`）或后续用户明确要求发送时再用'
      : '3. **若向 JSON 内收件人发送**，必须使用 `dws chat message send`，收件人参数只能取自 JSON（`--user` / `--group`）；**禁止**用 OpenClaw `message` 工具（channel=dingtalk）或把 displayName 当作 target';

  return [
    DINGTALK_RECIPIENTS_MARKER,
    '```json',
    jsonBlock,
    '```',
    '',
    title,
    '',
    '以上 JSON 中的 userId / openConversationId 由用户在 SClaw 中**手动选定**，与显示名一一对应。',
    '',
    '**必须遵守：**',
    '1. **禁止**对 JSON 内收件人执行 `dws contact user search`、`dws aisearch person` 或任何搜人/搜群命令',
    '2. **禁止**使用 OpenClaw `message` 工具（channel=dingtalk）或把 displayName 当作 target',
    rule3,
  ];
}

/** 对话发送格式规则 — 模块 A。 */
function buildSendFormatRules(): string[] {
  return ['', DINGTALK_SEND_FORMAT_RULES];
}

/** 定时任务发送格式规则 — 模块 A + 规则 8 禁回执覆盖。 */
function buildScheduledTaskSendFormatRules(): string[] {
  return ['', DINGTALK_SEND_FORMAT_RULES_FOR_SCHEDULED_TASK];
}

function buildCommandExampleHint(
  mentions: DingTalkMention[],
  opts?: { scheduledTask?: boolean },
): string[] {
  const intro = opts?.scheduledTask
    ? '命令格式示例（**仅语法参考，非完整收件人清单**；JSON 外若任务描述还点名了其他人，须一并发送且 `--text` 与发给 JSON 收件人的业务正文相同；**禁止原样执行**；`<正文>` 只能是业务结果，禁止填确认回执）：'
    : '命令格式示例（仅展示 `--text` 写法与代发说明格式，**禁止原样执行**；发送时把 `<正文>` 占位符替换为实际内容）：';
  return ['', intro, ...buildSendCommandHints(mentions)];
}

function buildFileSendContextIfAny(
  mentions: DingTalkMention[],
  options?: DingTalkMentionContextOptions,
): string[] {
  return options?.sendFileIntent
    ? [buildDingTalkFileSendWorkflowContext(mentions, options.attachedFiles, {
        forceDingTalkDriveUpload: options.forceDingTalkDriveUpload,
      })]
    : [];
}

/** 读群/单聊历史指引（总结/分析场景）。 */
function buildDingTalkReadHistoryGuidance(): string {
  return [
    '你可以读取钉钉群/单聊历史消息：',
    '**单聊**（如"@X 总结我们的聊天"）用 `dws chat message list-direct --user <userId> --time "<起始时间>" --forward=true --limit 50`——`--user` 传对方 userId（取自本块 JSON），直接返回你们俩的私聊消息，**无需 jq 过滤**；`--forward=true` 从老往新、`=false` 从新往老；`--time` 是**起始时间**（最早边界，必填，格式 `yyyy-MM-dd HH:mm:ss`，**不要用 ISO `T`/`Z`**）。要"最近 N 个月/天"时，起始时间 = 今天往前推 N：先跑 `date -v-3m "+%Y-%m-%d %H:%M:%S"`（macOS）或 `date -d "3 months ago" "+%Y-%m-%d %H:%M:%S"`（linux）算出再填入 `--time`，**禁止写死旧日期**。**单聊读取偶发返空、短时内连读会被限流，间隔几秒重试 1-2 次再判定，禁止把"无聊天记录/无权限"当总结发到钉钉**。',
    '**群聊**用 `dws chat message list --group <openConversationId> --time "<1个月前>" --forward=true --limit 50`——`--time` 必填且**固定取最近一个月**：先跑 `date -v-1m "+%Y-%m-%d %H:%M:%S"`（macOS）或 `date -d "1 month ago" "+%Y-%m-%d %H:%M:%S"`（linux）算出填入；`--forward=true` 从该时间往新读；**勿用 `--forward=false`**（会取 `--time` 之前的老消息）。**不传 `--time` 会返回空 `messages: []`**。按关键词用 `dws chat message search`（群 ID 用 `dws chat search --query` 查）。读空或权限/限流时先排查参数，间隔几秒重试 1-2 次——**禁止把"无记录"当总结发到钉钉**。',
    '**禁止用 `dws chat message list-all` 配 jq 按 userId 过滤单聊**——记录里是 `senderOpenDingTalkId`，与数字 `userId` 不同。若用户要求总结群/会话内容，**先读取真实历史再总结**，**不要编造内容、不要发送任何占位/示例文本**。',
  ].join('\n');
}

/** 对话 @ 只读/总结：禁止发送，不附带 send 格式与示例。 */
function buildDingTalkMentionSystemContextForChatRead(
  mentions: DingTalkMention[],
): string {
  return [
    ...buildRecipientHeader(mentions, 'chat-read'),
    '4. **【P0 本轮禁止发送】** 用户消息没有明确发送意图（如发给/发送给/推送给/把…发给…）。@ 只表示选定对象。若用户只要求总结、分析、查看、检索、回答，**禁止**调用 `dws chat message send`，也**禁止**追问"是否需要发送"；读完后**只在 SClaw 对话中回复**。',
    '5. ' + buildDingTalkReadHistoryGuidance(),
  ].join('\n');
}

/** 对话 @ 且用户明确要求发送。 */
function buildDingTalkMentionSystemContextForChatSend(
  mentions: DingTalkMention[],
  options?: DingTalkMentionContextOptions,
): string {
  return [
    ...buildRecipientHeader(mentions, 'chat-send'),
    '4. **对话 @ 且用户已明确要求发送**：出现发给/发送给/推送给/转发给/分享给/把…发给…/发到群，或本轮已携带待发送附件，即为发送意图；须按下方【钉钉发送格式规则】执行。**单独的「总结/分析/查看该群」不算发送意图。**「通知/告诉」单独出现也不算（除非同时有发给/发送给等）。',
    '5. **已明确要求发送时，直接发送，不要回头追问**。正文由你根据上下文组织；`--dry-run` 仅自检。**禁止原样执行**下方命令示例。',
    '6. ' + buildDingTalkReadHistoryGuidance(),
    ...buildSendFormatRules(),
    ...buildCommandExampleHint(mentions),
    ...buildFileSendContextIfAny(mentions, options),
  ].join('\n');
}

/** 对话 @ 场景：按是否明确发送意图选择只读块或发送块。 */
export function buildDingTalkMentionSystemContext(
  mentions: DingTalkMention[],
  options?: DingTalkMentionContextOptions,
): string {
  if (options?.explicitSendIntent) {
    return buildDingTalkMentionSystemContextForChatSend(mentions, options);
  }
  return buildDingTalkMentionSystemContextForChatRead(mentions);
}

/**
 * 定时任务场景：块内收件人**必须**发送；格式用定时任务版模块 A（禁回执上钉钉）。
 * 必发长规则见模块 C（执行期 hook/append）；此处保留收件人块 + 短必发/并集/同正文句。
 */
export function buildDingTalkMentionSystemContextForScheduledTask(
  mentions: DingTalkMention[],
  options?: DingTalkMentionContextOptions,
): string {
  return [
    ...buildRecipientHeader(mentions, 'scheduled-task'),
    '4. **定时任务：以上 JSON 内收件人必须发送，发送不是可选项（指定即必发）**——无需意图词；用块内 `userId` / `openConversationId` 逐个 `dws chat message send`；须等业务**完成或失败后再发**，禁止提前发送。**不要假设系统会自动发。**',
    '5. **【P0 收件人并集 + 同一正文】** JSON 为列配置结构化 id；若任务描述还自然语言点名了其他人（如「发给我自己 / 用户工号」），须一并发送。所有收件人的 `--text` 必须是**同一份业务结果**；每位只发 1 次。',
    '6. **【P0 禁止回执上钉钉】** `--text` 禁止写「任务完成」「消息已发送至」「执行成功」等会话确认或回执清单；确认只留在 SClaw 对话。正文由任务结果直接组织；`--dry-run` 仅自检；**禁止原样执行**下方命令示例。',
    ...buildScheduledTaskSendFormatRules(),
    ...buildCommandExampleHint(mentions, { scheduledTask: true }),
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

  const forceDingTalkDriveUpload =
    options?.forceDingTalkDriveUpload ?? looksLikeDingTalkDriveUploadIntent(text);
  const resolvedOptions: DingTalkMentionContextOptions = {
    ...options,
    forceDingTalkDriveUpload,
    ...(options?.scenario === 'scheduled-task'
      ? {}
      : {
          explicitSendIntent:
            options?.explicitSendIntent
            ?? (options?.sendFileIntent === true || forceDingTalkDriveUpload
              ? true
              : looksLikeDingTalkMentionSendIntent(text)),
        }),
  };

  const buildContext = resolveMentionSystemContextBuilder(options?.scenario);
  const header = [
    buildContext(mentions!, resolvedOptions),
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
    extras.dingTalkAttachedFiles = attachedFiles;
  }
  return extras;
}
