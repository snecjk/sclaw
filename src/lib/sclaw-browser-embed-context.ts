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
    version: 3,
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
    '**必须遵守：**',
    `- 所有页面操作只用 bridge_* 工具，且每次调用必须传 sessionId: "${context.bridgeSessionId}"`,
    '- 典型流程：bridge_snapshot({ sessionId }) → bridge_click({ sessionId, name: "菜单文案" }) 或 bridge_click({ sessionId, ref: "@e5" })',
    '- 禁止 browser 工具（会单独打开托管 Chrome，不是左侧预览）',
    '- 禁止 shell:openExternal、exec open、curl 调 sclaw-browser API',
    '- 禁止引用本地 workspace 源码，除非用户明确要求',
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
