/**
 * Hidden context for ephemeral embed-browser chat sessions.
 * Injected into user messages so the model answers about the left iframe, not the local workspace.
 */
export const SCLAW_BROWSER_EMBED_CONTEXT_MARKER = '<!-- StoClaw-Embed-Browser-Context -->';

export interface SclawBrowserEmbedContextBlock {
  embedRuntimeId: string;
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

export function buildSclawBrowserEmbedContextText(context: SclawBrowserEmbedContextBlock): string {
  const payload = {
    version: 2,
    source: 'stoclaw-embed-browser',
    embedRuntimeId: context.embedRuntimeId,
    appTitle: context.appTitle,
    pageUrl: context.pageUrl,
    pageTitle: context.pageTitle,
    visibleTextExcerpt: context.visibleTextExcerpt,
    capturedAt: context.capturedAt,
    recentNetworkRequests: context.recentNetworkRequests ?? [],
    hostApi: {
      capturePage: `POST /api/sclaw-browser/runtime/${context.embedRuntimeId}/capture`,
      executeScript: `POST /api/sclaw-browser/runtime/${context.embedRuntimeId}/execute`,
      networkLog: `GET /api/sclaw-browser/runtime/${context.embedRuntimeId}/network-log`,
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
    '【应用内嵌预览上下文】用户正在 SClaw 应用广场左侧内嵌页面中操作。'
    + '本对话 session 已绑定 embedRuntimeId，请围绕左侧页面内容与用户问题作答；'
    + '读取页面、执行脚本、查看接口请通过 hostApi 路由操作该 runtime，'
    + '不要默认引用本地开发项目文件（AGENTS.md、SOUL.md、workspace 源码等），除非用户明确要求。',
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
): string {
  if (!context) return text;
  if (messageHasSclawBrowserEmbedContext(text)) return text;
  const ctxText = buildSclawBrowserEmbedContextText(context);
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
