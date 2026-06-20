import type { DingTalkMention } from './dingtalk-mention';

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

export function buildDingTalkFileSendWorkflowContext(
  mentions: DingTalkMention[],
  attachedFiles?: DingTalkAttachedFileHint[],
): string {
  const conversationInfoHints = mentions.flatMap((mention) => {
    if (mention.type === 'group' && mention.openConversationId) {
      return [
        `- ${mention.displayName}: dws chat conversation-info --group ${mention.openConversationId} --format json`,
      ];
    }
    if (mention.type === 'user' && mention.userId) {
      return [
        `- ${mention.displayName}: dws chat conversation-info --open-dingtalk-id ${mention.userId} --format json`,
      ];
    }
    return [];
  });

  const fileLines = attachedFiles?.map(
    (file) => `- ${file.fileName}（${file.mimeType}）→ ${file.filePath}`,
  ) ?? [];

  return [
    '',
    '## StoClaw DingTalk 文件发送（钉盘流程，本条含非图片附件）',
    '',
    '**仅当需要把附件发给上述 @ 收件人时启用**；纯文字消息仍用 `--text`（正文 Markdown + 底栏代发说明，见上文规则 6–7），不要套用本流程。',
    '',
    '**目标：文字 + 文件合成一条消息发送。** 钉钉 IM 不支持单条消息同时含文字和文件附件，所以采用「文字正文中嵌入钉盘文件下载链接」的方式，收件人点击链接即可下载文件。',
    '',
    '非图片文件（pdf/doc/ppt/zip 等）**必须**按顺序执行，禁止猜测 dentryId/spaceId：',
    '1. `dws chat conversation-info` 取 `newCSpaceIdIM` 作为 `--space-id`（群用 `--group`，单聊用 `--open-dingtalk-id`）→ **必须**使用返回的 `newCSpaceIdIM`，这是会话共享空间，收件人天然有访问权限',
    '2. `dws drive upload --file <本地路径> --space-id <newCSpaceIdIM> -y --format json` → 从返回 JSON 中取 `fileId` 和 `downloadUrl`（钉盘文件下载链接）',
    '3. 将 `downloadUrl` 用 **DingTalk IM Markdown 链接格式** 嵌入文字正文：`[📎 文件名.pptx](downloadUrl)`',
    '4. `dws chat message send --group|--open-dingtalk-id <收件人ID> --title "消息" --text <含文件链接的完整正文含代发说明> --format json`',
    '',
    '最终合成示例（`--text` 值）：',
    '```',
    '请查收本周项目汇报。',
    '',
    '📎 [Q3项目汇报.pptx](https://钉盘下载链接...)',
    '',
    '---',
    '',
    '> *本消息由 STO Claw 代为发送，非本人实时回复。*',
    '```',
    '',
    '**禁止**将文字和文件拆成两条消息发送；**禁止**先发消息再补文字。',
    '',
    '预查会话共享空间：',
    ...conversationInfoHints,
    '',
    ...(fileLines.length > 0
      ? ['本条附件：', ...fileLines]
      : ['附件本地路径见消息末尾 `[media attached: <path> ...]` 行。']),
  ].join('\n');
}
