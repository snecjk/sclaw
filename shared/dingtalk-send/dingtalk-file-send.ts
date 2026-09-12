import type { DingTalkMention } from './dingtalk-mention';
import {
  DINGTALK_ARTIFACT_URL_EMBED_RULE,
  DINGTALK_DRIVE_UPLOAD_CMD,
  DINGTALK_TEMP_OSS_UPLOAD_TOOL,
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
  return true;
}

/**
 * 对话 @ + 图片/文件附件时的在线链接合成流程。
 * 上传工具、兜底命令与 URL 嵌入格式复用模块 A，此处只补充「附件场景」专属约束。
 */
export function buildDingTalkFileSendWorkflowContext(
  _mentions: DingTalkMention[],
  attachedFiles?: DingTalkAttachedFileHint[],
  options?: { forceDingTalkDriveUpload?: boolean },
): string {
  const fileLines = attachedFiles?.map(
    (file) => `- ${file.fileName}（${file.mimeType}）→ ${file.filePath}`,
  ) ?? [];

  const uploadSteps = options?.forceDingTalkDriveUpload
    ? [
        '**用户已明确要求上传到钉盘/钉钉云盘：禁止调用 `upload_file_to_temp_oss`。**',
        `1. 调用 \`${DINGTALK_DRIVE_UPLOAD_CMD}\`（**不需要 \`--space-id\`**）→ 从返回 JSON 取 \`docUrl\``,
        `2. 将 \`docUrl\` 按规则嵌入正文：${DINGTALK_ARTIFACT_URL_EMBED_RULE}`,
        '3. `dws chat message send --group|--open-dingtalk-id <收件人ID> --title "消息" --text <含文件链接的完整正文含代发说明> --format json`',
      ]
    : [
        '图片和普通文件（png/jpg/pdf/doc/ppt/zip 等）**必须**按顺序执行（工具与嵌入格式同发送格式规则 5–6）：',
        `1. 优先调用 Agent 工具 \`${DINGTALK_TEMP_OSS_UPLOAD_TOOL}\` → 从返回结果取 \`data.url\``,
        `2. 将 \`data.url\` 按规则嵌入正文：${DINGTALK_ARTIFACT_URL_EMBED_RULE}`,
        '3. `dws chat message send --group|--open-dingtalk-id <收件人ID> --title "消息" --text <含文件链接的完整正文含代发说明> --format json`',
        `4. 仅当 Agent 上传工具不可用或失败时，才用 \`${DINGTALK_DRIVE_UPLOAD_CMD}\`（**不需要 \`--space-id\`**）取 \`docUrl\` 兜底`,
      ];

  return [
    '',
    '## SClaw DingTalk 图片/文件发送（在线链接流程）',
    '',
    '**仅当需要把附件发给上述 @ 收件人时启用**；纯文字消息仍用 `--text`（正文 Markdown + 底栏代发说明，见上文发送格式规则），不要套用本流程。',
    '',
    '**目标：文字 + 图片/文件合成一条消息发送。** 先把本地附件转换为在线地址，再将地址嵌入文字正文，收件人点击链接即可查看或下载。',
    '',
    ...uploadSteps,
    '',
    '最终合成示例（`--text` 值）：',
    '```',
    '请查收本周项目汇报。',
    '',
    '[Q3项目汇报.pptx](https://临时在线地址...)',
    '',
    '![项目截图.png](https://临时图片地址...)',
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
