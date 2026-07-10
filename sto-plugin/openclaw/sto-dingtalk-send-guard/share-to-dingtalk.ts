import { Type } from './typebox-shim.js';
import type { OpenClawPluginApi } from './api.js';
import {
  assertDingTalkShareOpenUrl,
  buildDingTalkShareAppLinkUrl,
  type DingTalkShareContent,
} from './shared/dingtalk-share';
import { openExternalUrlInOs } from './open-external-url.js';

const TAG = 'sto-dingtalk-send-guard';

export const DINGTALK_SHARE_TOOL_PROMPT = [
  '钉钉分享内置工具（share_to_dingtalk）：',
  '- 用户要在钉钉里**选人发送**（如「分享到钉钉」「发给同事选一下」）且消息中**没有**已解析的 @ 收件人块时，调用 share_to_dingtalk。',
  '- 参数 text / url / imageUrls 至少填一项；imageUrls 须为可访问的 http(s) 地址（本地路径无效）。',
  '- 已有 [STOCLAW:DINGTALK_RECIPIENTS] 或用户已在输入框 @ 指定收件人时，用 dws chat message send，不要调用本工具。',
  '- 本工具会唤起 PC 钉钉选人窗口并预填正文；不支持在移动端钉钉使用。',
].join('\n');

/** Host-side heuristic: only inject share tool prompt when the turn looks like a DingTalk picker/share request. */
const DINGTALK_SHARE_INTENT_RE =
  /分享到钉钉|发到钉钉|钉钉里选|钉钉选人|share_to_dingtalk|share to dingtalk|发给同事选|选人发送|唤起钉钉/i;

export function looksLikeDingTalkShareIntent(text: string | undefined | null): boolean {
  const trimmed = text?.trim();
  if (!trimmed) return false;
  return DINGTALK_SHARE_INTENT_RE.test(trimmed);
}

export type ShareToDingTalkToolParams = {
  text?: string;
  url?: string;
  imageUrls?: string[];
  title?: string;
};

export type ShareToDingTalkToolResult = {
  openUrl: string;
  applinkUrl: string;
  defaultMsg: string;
  wndCaption: string;
  truncated: boolean;
  warnings: string[];
};

export function executeShareToDingTalk(params: ShareToDingTalkToolParams): ShareToDingTalkToolResult {
  const content: DingTalkShareContent = {
    text: params.text,
    url: params.url,
    imageUrls: params.imageUrls,
    title: params.title,
  };
  const built = buildDingTalkShareAppLinkUrl(content);
  assertDingTalkShareOpenUrl(built.url);
  openExternalUrlInOs(built.url);
  return {
    openUrl: built.url,
    applinkUrl: built.appLinkUrl,
    defaultMsg: built.defaultMsg,
    wndCaption: built.wndCaption,
    truncated: built.truncated,
    warnings: built.warnings,
  };
}

export function registerShareToDingTalkTool(api: OpenClawPluginApi): void {
  api.registerTool({
    id: 'share_to_dingtalk',
    name: 'share_to_dingtalk',
    label: '分享到钉钉（选人）',
    description: `唤起 PC 钉钉客户端的「选择员工发送消息」页面，并预填分享正文。

适用：用户要把文本、链接或图片链接发给钉钉同事，但尚未指定具体收件人（需在钉钉里自行搜索选人）。

参数（至少一项）：
- text：正文
- url：HTTP(S) 链接（以 Markdown 链接形式预填）
- imageUrls：一张或多张图片的 HTTP(S) URL（以 Markdown 图片链接预填）
- title：选人窗口标题，默认「分享」

限制：仅 macOS/Windows 钉钉客户端 ≥ 6.5.50；图片须为公网 URL，不能传本地路径。已有 @ 收件人时用 dws 发送，勿用本工具。`,
    parameters: Type.Object({
      text: Type.Optional(Type.String({ description: '分享正文' })),
      url: Type.Optional(Type.String({ description: 'HTTP(S) 链接' })),
      imageUrls: Type.Optional(
        Type.Array(Type.String({ description: '图片 HTTP(S) URL，可多张' })),
      ),
      title: Type.Optional(Type.String({ description: '钉钉选人窗口标题' })),
    }),
    execute: async (_toolCallId, params) => {
      api.logger.info?.(
        `[${TAG}] share_to_dingtalk invoked text=${Boolean(params.text)} url=${Boolean(params.url)} images=${params.imageUrls?.length ?? 0}`,
      );
      try {
        const data = executeShareToDingTalk(params as ShareToDingTalkToolParams);
        const envelope = {
          type: 'dingtalk_share_picker_opened',
          success: true,
          domain: 'dingtalk',
          message: '已唤起钉钉选人发送页面',
          data,
        };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(envelope) }],
          details: envelope,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        api.logger.warn?.(`[${TAG}] share_to_dingtalk failed: ${message}`);
        const envelope = {
          type: 'sto_tool_error',
          success: false,
          domain: 'dingtalk',
          message,
          error: { code: 'dingtalk_share_failed', message },
        };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(envelope) }],
          details: envelope,
        };
      }
    },
  });
}
