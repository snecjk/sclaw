/**
 * 口头「发给某人」意图：无输入框 @ 时，由宿主按需注入 dws 发送规则。
 * 与 share_to_dingtalk（唤起选人窗）互斥：有明确收件人姓名时走本规则。
 */

export const DINGTALK_ORAL_SEND_PROMPT = [
  '钉钉口头发送（本轮用户未使用输入框 @，但话里点名了收件人）：',
  '- **必须**用 dws 完成：先 `dws contact user search` / `dws aisearch person`（或群用 `dws chat search`）解析收件人，再 `dws chat message send --user <userId>` 或 `--group <openConversationId>`。',
  '- **禁止**调用 `share_to_dingtalk`（会唤起选人窗，无法按姓名直达发送）。',
  '- 多人重名时先列出候选让用户确认，再发送；不要猜测乱发。',
  '- 发送前宜确认正文；可用 `--dry-run` 预览。禁止循环/批量 send。',
  '- 成功后用一句中文确认即可，不要输出 openTaskId / 原始 JSON / 完整 CLI。',
].join('\n');

/**
 * 「发给文鹏」「发一条…给文鹏」「给文鹏发…」等：有明确收件人、应走 dws 而非选人窗。
 */
const ORAL_SEND_RE = [
  /发给[\u4e00-\u9fffA-Za-z0-9·•._-]{1,24}/,
  /发送给[\u4e00-\u9fffA-Za-z0-9·•._-]{1,24}/,
  /发消息给[\u4e00-\u9fffA-Za-z0-9·•._-]{1,24}/,
  /钉钉发给[\u4e00-\u9fffA-Za-z0-9·•._-]{1,24}/,
  /给[\u4e00-\u9fffA-Za-z0-9·•._-]{1,24}发(?:送|消息|一下|条|个)?/,
  /发(?:一条|个|份|条)?.{0,48}给[\u4e00-\u9fffA-Za-z0-9·•._-]{1,24}/,
  /(?:把|将).{0,48}(?:发给|发送给)[\u4e00-\u9fffA-Za-z0-9·•._-]{1,24}/,
];

export function looksLikeDingTalkOralSendIntent(text: string | undefined | null): boolean {
  const trimmed = text?.trim();
  if (!trimmed) return false;
  return ORAL_SEND_RE.some((re) => re.test(trimmed));
}
