/**
 * Hidden context for ephemeral embed-browser chat sessions.
 * Injected into user messages so the model answers about the left iframe, not the local workspace.
 */
export const SCLAW_BROWSER_EMBED_CONTEXT_MARKER = '<!-- StoClaw-Embed-Browser-Context -->';

export interface SclawBrowserEmbedContextBlock {
  embedRuntimeId: string;
  bridgeSessionId: string;
  appTitle: string;
  pageUrl: string;
  pageTitle: string;
  visibleTextExcerpt: string;
  capturedAt: number;
  recentNetworkRequests?: Array<{
    method: string;
    url: string;
    statusCode?: number;
  }>;
}

export function messageHasSclawBrowserEmbedContext(message: string): boolean {
  return message.includes(SCLAW_BROWSER_EMBED_CONTEXT_MARKER);
}

export function buildSclawBrowserEmbedContextText(
  context: SclawBrowserEmbedContextBlock,
  options?: { longSessionNotice?: string | null },
): string {
  const payload = {
    version: 4,
    source: 'stoclaw-embed-browser',
    embedRuntimeId: context.embedRuntimeId,
    bridgeSessionId: context.bridgeSessionId,
    appTitle: context.appTitle,
    pageUrl: context.pageUrl,
    pageTitle: context.pageTitle,
    visibleTextExcerpt: context.visibleTextExcerpt,
    capturedAt: context.capturedAt,
    recentNetworkRequests: context.recentNetworkRequests ?? [],
    bridgeTools: {
      snapshot: 'bridge_snapshot',
      click: 'bridge_click',
      fill: 'bridge_fill',
      navigate: 'bridge_navigate',
      screenshot: 'bridge_screenshot',
      listSessions: 'bridge_list_sessions',
    },
    automationTools: {
      observe: 'ba_observe',
      act: 'ba_act',
      wait: 'ba_wait',
      validate: 'ba_validate',
      startRun: 'ba_start_run',
      createSession: 'ba_create_session',
      sessionId: context.bridgeSessionId,
      embedRuntimeId: context.embedRuntimeId,
    },
  };

  const excerptBlock = context.visibleTextExcerpt.trim()
    ? `页面可见文字摘要（截断）：\n${context.visibleTextExcerpt.trim()}`
    : '（无法读取页面正文，仅提供 URL 与标题）';

  const networkBlock = (context.recentNetworkRequests?.length ?? 0) > 0
    ? `最近网络请求（60s 内，最多 20 条）：\n${
      context.recentNetworkRequests!.map((item) => (
        `- ${item.method} ${item.statusCode ?? '?'} ${item.url}`
      )).join('\n')
    }`
    : '';

  return [
    SCLAW_BROWSER_EMBED_CONTEXT_MARKER,
    '',
    options?.longSessionNotice ?? null,
    '【应用内嵌预览上下文】用户正在 SClaw 应用广场左侧**内置浏览器（webview）**中操作，不是外部 Chrome。',
    '左侧页面已通过 Browser Bridge 连接，bridgeSessionId 见下方 JSON。',
    '',
    '**必须遵守（浏览器自动化 Step 1）：**',
    '- 用户说「打开/进入/点击 XXX」= **你必须用工具在左侧 webview 内操作**，不是口头告诉用户自己去点。',
    '- **禁止**在未产生 bridge_* / ba_* 工具调用的情况下声称「已成功打开/已进入」。',
    '- **简单单步（打开/点击一个菜单或卡片）**：直接 `bridge_click({ sessionId, name: "目标名" })`；返回的 url/navigated 即结果，**不要再调 ba_observe、ba_wait、bridge_snapshot**。',
    '- **需要用户输入（填表、textarea）**：`bridge_snapshot` 或 `ba_observe` 定位 ref → `bridge_fill` 或 `ba_act fill`（CDP 真实输入，填后校验）→ `ba_validate` 确认保存按钮可用或文本已出现。',
    '- **需要用户输入（填表、textarea）**：`bridge_snapshot` 或 `ba_observe` 定位 ref → `bridge_fill` 或 `ba_act fill`（CDP 真实输入，填后校验）→ `ba_validate` 确认保存按钮可用或文本已出现。',
    '- **不要混用 bridge_* 与 ba_***：同一任务选一套即可；内嵌预览优先 bridge_*。',
    '- 多步流程（连续跳转、需 checkpoint）用 ba_*（ba_observe → ba_act → ba_validate）。',
    `- bridge_* 必须传 sessionId: "${context.bridgeSessionId}"`,
    '- 禁止 browser 工具（会单独打开托管 Chrome，不是左侧预览）',
    '- 禁止 shell:openExternal、exec open、curl 调 sclaw-browser API',
    '- 禁止引用本地 workspace 源码，除非用户明确要求',
    '- 若 bridge_click 返回 navigated=false 或 url 未变化，再 bridge_snapshot 定位 ref 重试；仍失败则如实说明',
    '',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    '',
    excerptBlock,
    networkBlock,
    '',
    SCLAW_BROWSER_EMBED_CONTEXT_MARKER,
  ].filter(Boolean).join('\n');
}

export function appendSclawBrowserEmbedContext(
  text: string,
  context?: SclawBrowserEmbedContextBlock | null,
  options?: { longSessionNotice?: string | null },
): string {
  if (!context) return text;
  if (messageHasSclawBrowserEmbedContext(text)) return text;
  const ctxText = buildSclawBrowserEmbedContextText(context, options);
  return `${ctxText}\n${text}`;
}

export function stripSclawBrowserEmbedContextForDisplay(message: string): string {
  if (!messageHasSclawBrowserEmbedContext(message)) return message;

  const marker = SCLAW_BROWSER_EMBED_CONTEXT_MARKER;
  const startIdx = message.indexOf(marker);
  const endIdx = message.lastIndexOf(marker);

  if (startIdx >= 0 && endIdx > startIdx) {
    const after = message.slice(endIdx + marker.length).trim();
    return after;
  }

  if (startIdx >= 0) {
    return message.slice(0, startIdx).trim();
  }

  return message;
}
