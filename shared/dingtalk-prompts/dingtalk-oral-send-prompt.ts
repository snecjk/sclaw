/**
 * 口头「发给某人」意图检测与护栏导出。
 * 护栏正文 SSOT：`dingtalk-send-rules.ts` → `DINGTALK_ORAL_SEND_GUARD`。
 */
export { DINGTALK_ORAL_SEND_GUARD } from './dingtalk-send-rules';
import { DINGTALK_ORAL_SEND_GUARD } from './dingtalk-send-rules';

/**
 * @deprecated 使用 `DINGTALK_ORAL_SEND_GUARD`。旧常量语义过宽且缺 id 来源护栏；现与 GUARD 同内容作过渡别名。
 */
export const DINGTALK_ORAL_SEND_PROMPT = DINGTALK_ORAL_SEND_GUARD;

/**
 * 「发给文鹏」「发一条…给文鹏」「给文鹏发…」等：有明确收件人、应走 dws 而非选人窗。
 * 仍可用于与 share_to_dingtalk 意图互斥判断；口头护栏本身改为对话常驻注入，不再依赖本函数决定是否注入。
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
