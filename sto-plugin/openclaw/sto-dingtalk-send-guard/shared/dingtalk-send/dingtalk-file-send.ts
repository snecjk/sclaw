/**
 * Self-contained copy for Gateway extension install (~/.stoclaw/openclaw/extensions/...).
 * Keep in sync with repository root `shared/dingtalk-send/dingtalk-file-send.ts`.
 * Regenerate: `pnpm run sync:plugin-shared`
 */
import type { DingTalkMention } from './dingtalk-mention';
import {
  DINGTALK_ARTIFACT_URL_EMBED_RULE,
  DINGTALK_DRIVE_UPLOAD_CMD,
} from '../dingtalk-prompts/dingtalk-send-rules';

export interface DingTalkAttachedFileHint {
  fileName: string;
  filePath: string;
  mimeType: string;
  fileSize?: number;
}

export function isNonImageAttachment(mimeType: string): boolean {
  return !mimeType.startsWith('image/');
}

export function shouldIncludeDingTalkFileSendWorkflow(
  mentions: DingTalkMention[] | undefined,
  attachments: DingTalkAttachedFileHint[] | undefined,
): boolean {
  if (!mentions?.length || !attachments?.length) return false;
  return attachments.some((file) => isNonImageAttachment(file.mimeType));
}

/**
 * 对话 @ + 非图片附件时的钉盘合成流程。
 * 上传命令与 docUrl 嵌入格式复用模块 A，此处只补充「附件场景」专属约束。
 */
export function buildDingTalkFileSendWorkflowContext(
  _mentions: DingTalkMention[],
  attachedFiles?: DingTalkAttachedFileHint[],
): string {
  const fileLines = attachedFiles?.map(
    (file) => `- ${file.fileName}（${file.mimeType}）→ ${file.filePath}`,
  ) ?? [];

  return [
    '',
    '## SClaw DingTalk 文件发送（钉盘流程，本条含非图片附件）',
    '',
    '**仅当需要把附件发给上述 @ 收件人时启用**；纯文字消息仍用 `--text`（正文 Markdown + 底栏代发说明，见上文发送格式规则），不要套用本流程。',
    '',
    '**目标：文字 + 文件合成一条消息发送。** 钉钉 IM 不支持单条消息同时含文字和文件附件，所以采用「文字正文中嵌入钉盘文件下载链接」的方式，收件人点击链接即可下载文件。',
    '',
    '非图片文件（pdf/doc/ppt/zip 等）**必须**按顺序执行（命令与嵌入格式同发送格式规则 5–6）：',
    `1. \`${DINGTALK_DRIVE_UPLOAD_CMD}\`（**不需要 \`--space-id\`**）→ 从返回 JSON 取 \`docUrl\``,
    `2. 将 \`docUrl\` 按规则嵌入正文：${DINGTALK_ARTIFACT_URL_EMBED_RULE}`,
    '3. `dws chat message send --group|--open-dingtalk-id <收件人ID> --title "消息" --text <含文件链接的完整正文含代发说明> --format json`',
    '',
    '最终合成示例（`--text` 值）：',
    '```',
    '请查收本周项目汇报。',
    '',
    'Q3项目汇报.pptx：https://钉盘下载链接...',
    '',
    '---',
    '',
    '> *本消息由 SClaw 代为发送，非本人实时回复。*',
    '```',
    '',
    '**禁止**将文字和文件拆成两条消息发送；**禁止**先发消息再补文字。',
    '',
    ...(fileLines.length > 0
      ? ['本条附件：', ...fileLines]
      : ['附件本地路径见消息末尾 `[media attached: <path> ...]` 行。']),
  ].join('\n');
}
