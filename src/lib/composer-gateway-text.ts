import type { FileAttachment } from '@/components/attachments/types';
import type { ComposerSegment, PersistedComposerSegment } from '@/lib/dingtalk-mention-composer';
import type { SkillMeta } from '@/types/skill-meta';
import type {
  ModelMessageCompositionSegment,
  ModelMessageCompositionV1,
} from '../../shared/model-message-composition';
import {
  createModelMessageComposition,
  renderModelWorkflowInstruction,
} from '../../shared/model-message-composition';

function gatewayBodyPartForSegment(seg: ComposerSegment): string {
  switch (seg.type) {
    case 'text':
      return seg.text;
    case 'mention':
      return `@${seg.mention.displayName}`;
    case 'file':
    case 'skill':
      // 文件/技能占位符在遍历中生成（需要注册表 / 标题）。
      return '';
    case 'workflow':
      // Bake 句与 source 解耦：mine / 模版 / 学习中心 handoff 都写同一句，
      // 以便 stripComposerModelBakeForDisplay 能还原 displayText，完成乐观↔echo 配对。
      // source 仍由 dispatchChatSend 决定执行路径，不参与正文编码。
      return renderModelWorkflowInstruction(seg.id, seg.name);
    default:
      return '';
  }
}

function displayPartForSegment(seg: ComposerSegment): string {
  switch (seg.type) {
    case 'text':
      return seg.text;
    case 'mention':
      return `@${seg.mention.displayName}`;
    case 'file':
    case 'skill':
    case 'workflow':
      return '';
    default:
      return '';
  }
}

export async function buildComposerGatewayPayload(input: {
  segments: ComposerSegment[];
  plainText: string;
  attachments: FileAttachment[];
}): Promise<{
  gatewayText: string;
  composition: ModelMessageCompositionV1;
  displayText: string;
  attachments: FileAttachment[];
  skillMetas: SkillMeta[];
  workflows: Array<{ id: string; name: string; source?: string }>;
  persistedSegments: PersistedComposerSegment[];
}> {
  const { segments, plainText, attachments } = input;
  const readyById = new Map(
    attachments.filter((att) => att.status === 'ready').map((att) => [att.id, att]),
  );

  const orderedAttachments: FileAttachment[] = [];
  const skillMetas: SkillMeta[] = [];
  const workflows: Array<{ id: string; name: string; source?: string }> = [];
  const bodyParts: string[] = [];
  const displayParts: string[] = [];
  const modelSegments: ModelMessageCompositionSegment[] = [];
  let mentionIndex = 0;

  for (const seg of segments) {
    switch (seg.type) {
      case 'file': {
        const att = readyById.get(seg.attachmentId);
        if (!att) break;
        const mediaIndex = orderedAttachments.length;
        orderedAttachments.push(att);
        modelSegments.push({
          type: 'attachment',
          mediaIndex,
          displayName: att.fileName,
        });
        break;
      }
      case 'skill': {
        skillMetas.push({ slug: seg.slug, title: seg.title });
        modelSegments.push({ type: 'skill', slug: seg.slug, title: seg.title });
        break;
      }
      case 'workflow': {
        workflows.push({ id: seg.id, name: seg.name, source: seg.source });
        const instruction = gatewayBodyPartForSegment(seg);
        bodyParts.push(instruction);
        modelSegments.push({ type: 'workflow', id: seg.id, name: seg.name, source: seg.source });
        break;
      }
      case 'text':
        bodyParts.push(gatewayBodyPartForSegment(seg));
        displayParts.push(displayPartForSegment(seg));
        modelSegments.push({ type: 'text', text: seg.text });
        break;
      case 'mention':
        bodyParts.push(gatewayBodyPartForSegment(seg));
        displayParts.push(displayPartForSegment(seg));
        modelSegments.push({
          type: 'mention',
          displayName: seg.mention.displayName,
          mentionIndex,
        });
        mentionIndex += 1;
        break;
      default:
        break;
    }
  }

  let bodyFromSegments = bodyParts.join('');
  if (segments.length === 0 && plainText.trim()) {
    bodyFromSegments = plainText;
    displayParts.push(plainText);
    modelSegments.push({ type: 'text', text: plainText });
  }

  const gatewayText = bodyFromSegments.trim();

  const displayText = displayParts.join('').trim();

  const persistedSegments: PersistedComposerSegment[] = [];
  for (const seg of segments) {
    if (seg.type === 'file') {
      const att = readyById.get(seg.attachmentId);
      if (!att) continue;
      persistedSegments.push({
        type: 'file',
        fileName: att.fileName,
        mimeType: att.mimeType,
        fileSize: att.fileSize,
        preview: att.preview,
        filePath: att.stagedPath,
        stagedPath: att.stagedPath,
        provenance: att.provenance,
      });
      continue;
    }
    persistedSegments.push(seg);
  }

  return {
    gatewayText,
    composition: createModelMessageComposition(modelSegments),
    displayText,
    attachments: orderedAttachments,
    skillMetas,
    workflows,
    persistedSegments,
  };
}
