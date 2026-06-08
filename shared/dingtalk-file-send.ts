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
        `- ${mention.displayName}: dws chat conversation-info --user ${mention.userId} --format json`,
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
    '**仅当需要把附件发给上述 @ 收件人时启用**；纯文字消息仍用 `--text`，不要套用本流程。',
    '',
    '非图片文件（pdf/doc/js/zip 等）**必须**按顺序执行，禁止猜测 dentryId/spaceId：',
    '1. `dws chat conversation-info` 取 `newCSpaceIdIM` 作为 `--space-id`（群用 `--group`，单聊用 `--user`）',
    '2. `dws drive upload --file <本地路径> --space-id <spaceId> -y --format json` → 取 `fileId`',
    '3. `dws drive info --node <fileId> --format json` → 取 `dentryId`（发送 file 消息必需）',
    '4. `dws chat message send --group|--user <收件人ID> --msg-type file --dentry-id <dentryId> --space-id <spaceId> --file-name "<名>" --file-type "<扩展名>" --file-path "/<名>" --file-size <字节> --format json`',
    '',
    '预查会话共享空间：',
    ...conversationInfoHints,
    '',
    ...(fileLines.length > 0
      ? ['本条附件：', ...fileLines]
      : ['附件本地路径见消息末尾 `[media attached: <path> ...]` 行。']),
    '',
    '图片附件走 image/mediaId 路径，**不要**对图片套用钉盘 file 流程。',
  ].join('\n');
}
