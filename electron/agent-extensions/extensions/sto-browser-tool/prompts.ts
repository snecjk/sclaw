import type { SclawPromptContribution } from '../../../../shared/agent-extensions';
import { isEmbedAppChatSessionKey } from '../../../../shared/session-type';
import { STO_BROWSER_BRIDGE_ACTIVATION } from './activation';

export const BRIDGE_SYSTEM_PROMPT = [
  '浏览器桥接工具（bridge_*，重要）：',
  '- **应用广场内嵌预览（左侧 webview）**：必须使用 bridge_*，且每次调用传入用户消息上下文中的 sessionId（embed-<runtimeId>）。禁止使用托管浏览器或 shell:openExternal 代替。',
  '- **简单点击/打开**：直接调用 bridge_click({ sessionId, name: "菜单名" })；需要精确定位时先 bridge_snapshot，再按 ref 点击。',
  '- **填写表单**：bridge_snapshot 定位 → bridge_fill 填写 → 再次 snapshot 验证页面状态。',
  // TODO(web-bridge): 上线前主聊天仍走托管浏览器 / pi-browser-use，不要强制 bridge_navigate。
  // '- **主聊天打开浏览器 / 打开网页**：调用 bridge_navigate；禁止使用托管浏览器、无痕 Chrome 或 shell:openExternal 代替。',
  '- **外部 Chrome 已登录标签**：可使用 bridge_*；不传 sessionId 时只会选择 Browser Bridge 扩展会话，不会误选其他内嵌应用。',
  '- 无登录态采集或隔离自动化测试应使用运行时提供的托管浏览器工具，不要使用 bridge_*。',
].join('\n');

export const EMBED_BRIDGE_SYSTEM_PROMPT = [
  '【当前为应用广场内嵌浏览器会话】左侧 webview 已连接 Browser Bridge。',
  '- 必须从用户消息的隐藏 JSON 上下文读取 bridgeSessionId，并在每次 bridge_* 调用中传入 sessionId。工具层会拒绝缺少 sessionId 的调用。',
  '- 简单操作和表单填写优先使用 bridge_*。如果当前运行时还提供 ba_* 且任务确实需要多步 checkpoint，可以选择 ba_*；同一任务不要混用两套工具。',
  '',
  BRIDGE_SYSTEM_PROMPT,
].join('\n');

export const browserBridgePrompt: SclawPromptContribution = {
  id: 'browser-bridge-guidance',
  activation: STO_BROWSER_BRIDGE_ACTIVATION,
  build(context) {
    return isEmbedAppChatSessionKey(context.sessionKey)
      ? EMBED_BRIDGE_SYSTEM_PROMPT
      : BRIDGE_SYSTEM_PROMPT;
  },
};
