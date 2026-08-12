import type { FileAttachment } from '@/components/attachments/types';
import type { ComposerSegment, PersistedComposerSegment } from '@/lib/dingtalk-mention-composer';
import { appendSkillTranscriptMarker } from '@/lib/skill-transcript-marker';
import type { SkillMeta } from '@/types/skill-meta';

/** 标签名含 `]` 时保持占位符括号完整。 */
function escapeGatewayPlaceholderLabel(value: string): string {
  return value.replace(/]/g, '］');
}

function formatFilePlaceholder(fileName: string | undefined): string {
  const name = escapeGatewayPlaceholderLabel((fileName ?? '').trim() || '未知文件');
  return `[文件: ${name}]`;
}

function formatSkillPlaceholder(title: string | undefined, slug: string): string {
  const label = escapeGatewayPlaceholderLabel((title || slug).trim() || '未知技能');
  return `[技能: ${label}]`;
}

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
      if (seg.source === 'mine') {
        return `帮我执行 id 为：${seg.id} 的工作流 【${seg.name}】`;
      }
      return seg.name;
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
  resolveSkillPrompt: (slug: string) => Promise<{ defaultPrompt: string; title: string }>;
}): Promise<{
  gatewayText: string;
  displayText: string;
  attachments: FileAttachment[];
  skillMetas: SkillMeta[];
  workflows: Array<{ id: string; name: string; source?: string }>;
  persistedSegments: PersistedComposerSegment[];
}> {
  const { segments, plainText, attachments, resolveSkillPrompt } = input;
  const readyById = new Map(
    attachments.filter((att) => att.status === 'ready').map((att) => [att.id, att]),
  );

  const orderedAttachments: FileAttachment[] = [];
  const skillMetas: SkillMeta[] = [];
  const workflows: Array<{ id: string; name: string; source?: string }> = [];
  const skillPrompts: string[] = [];
  const bodyParts: string[] = [];
  const displayParts: string[] = [];

  for (const seg of segments) {
    switch (seg.type) {
      case 'file': {
        const att = readyById.get(seg.attachmentId);
        if (!att) break;
        orderedAttachments.push(att);
        bodyParts.push(formatFilePlaceholder(att.fileName));
        break;
      }
      case 'skill': {
        skillMetas.push({ slug: seg.slug, title: seg.title });
        bodyParts.push(formatSkillPlaceholder(seg.title, seg.slug));
        const { defaultPrompt } = await resolveSkillPrompt(seg.slug);
        const prompt = defaultPrompt.trim();
        if (prompt) skillPrompts.push(prompt);
        break;
      }
      case 'workflow': {
        workflows.push({ id: seg.id, name: seg.name, source: seg.source });
        bodyParts.push(gatewayBodyPartForSegment(seg));
        break;
      }
      case 'text':
      case 'mention':
        bodyParts.push(gatewayBodyPartForSegment(seg));
        displayParts.push(displayPartForSegment(seg));
        break;
      default:
        break;
    }
  }

  let bodyFromSegments = bodyParts.join('');
  if (segments.length === 0 && plainText.trim()) {
    bodyFromSegments = plainText;
    displayParts.push(plainText);
  }

  const bodyTrimmed = bodyFromSegments.trim();
  let gatewayBody = bodyTrimmed;
  if (skillPrompts.length > 0) {
    gatewayBody = skillPrompts.join('\n\n');
    if (bodyTrimmed) gatewayBody += `\n\n${bodyTrimmed}`;
  }

  let gatewayText = gatewayBody;
  for (let i = 0; i < skillMetas.length; i += 1) {
    gatewayText = appendSkillTranscriptMarker(
      gatewayText,
      skillMetas[i],
      i === 0 ? displayParts.join('').trim() : undefined,
    );
  }

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
    displayText,
    attachments: orderedAttachments,
    skillMetas,
    workflows,
    persistedSegments,
  };
}
