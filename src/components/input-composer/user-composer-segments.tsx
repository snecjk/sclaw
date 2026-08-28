/**
 * Composer segments 的共用用户气泡渲染。
 * 当前 Chat 使用；Task / 其他场景可复用同一棵树（无页面耦合）。
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  DingTalkMentionTag,
  renderUserMessageMentionNodes,
} from '@/components/dingtalk/DingTalkMentionTag';
import { SkillMessageTag } from '@/components/skill-plaza/SkillMessageTag';
import { WorkflowNodesIcon } from '@/components/icons/composer-toolbar-icons';
import { FileIcon } from '@/components/attachments';
import {
  ATTACHMENT_CHIP_SURFACE_CLASS,
  middleEllipsisFileName,
} from '@/components/attachments/file-type-icon';
import { ATTACHMENT_SPAN_CLASS } from '@/lib/dingtalk-mention-composer';
import type { PersistedComposerSegment } from '@/lib/dingtalk-mention-composer';
import {
  normalizeUserMessageForDisplay,
  stripComposerGatewayPlaceholders,
  stripGatewayMediaAttached,
  stripUserNoiseKeepComposerBake,
} from '@/lib/user-message-display';
import {
  deriveSkillUserDisplayText,
  parseSkillTranscriptMarker,
  stripSkillGatewayPrefix,
  stripSkillTranscriptMarker,
} from '@/lib/skill-transcript-marker';
import { resolveSkillFromPlaza } from '@/lib/skill-plaza-resolve';
import { getMessageText } from '@/stores/chat/helpers';
import type { AttachedFileMeta } from '@/stores/chat/types';
import type { SkillMeta } from '@/types/skill-meta';
import type { RawMessage } from '@/stores/chat/types';

export interface WorkflowRunDisplayMeta {
  workflowId: string;
  workflowName: string;
  beforeText?: string;
  accompanyingText?: string;
}

export function UserComposerFileChip({
  fileName,
  mimeType,
}: {
  fileName: string;
  mimeType: string;
  fileSize?: number;
}) {
  return (
    <span
      className={cn(ATTACHMENT_SPAN_CLASS, ATTACHMENT_CHIP_SURFACE_CLASS, 'ml-1 mt-1 w-max align-top')}
      title={fileName}
    >
      <FileIcon fileName={fileName} mimeType={mimeType} />
      <span className="min-w-0 flex-1 whitespace-nowrap">{middleEllipsisFileName(fileName)}</span>
    </span>
  );
}

export function UserWorkflowMessageTag({ workflowName }: { workflowName: string }) {
  return (
    <span
      className={cn(
        'inline-flex box-border h-6 max-w-[280px] ml-1 mt-1 items-center gap-0.5 overflow-hidden rounded-[4px]',
        'bg-[#EEF3FF] px-1 align-top text-[12px] font-medium leading-none text-[#4E6FFF]',
      )}
    >
      <WorkflowNodesIcon className="h-3 w-3 shrink-0 text-current" />
      <span className="workflow-token-label min-w-0 flex-1 truncate whitespace-nowrap">{workflowName}</span>
    </span>
  );
}

/**
 * 将持久化 segments 展成复制 / 快捷输入用的纯文本：按 inline 顺序保留
 * 文件名、技能名、工作流名、@提及，避免仅用 displayText 时 chip 位变空、技能标题被前置。
 */
export function serializePersistedComposerSegmentsToActionText(
  segments: PersistedComposerSegment[],
): string {
  const parts: string[] = [];

  const appendLabel = (label: string) => {
    const next = label.trim();
    if (!next) return;
    const prev = parts.join('');
    const padBefore = prev.length > 0 && !/\s$/.test(prev) ? ' ' : '';
    // 尾随空格对齐气泡里 chip 后的 NBSP，避免与后文粘连
    parts.push(`${padBefore}${next} `);
  };

  for (const seg of segments) {
    switch (seg.type) {
      case 'text':
        parts.push(stripGatewayMediaAttached((seg.text ?? '').replace(/\u00A0/g, ' ')));
        break;
      case 'mention':
        appendLabel(`@${seg.mention.displayName}`);
        break;
      case 'skill':
        appendLabel(seg.title);
        break;
      case 'workflow':
        appendLabel(seg.name);
        break;
      case 'file':
        appendLabel(seg.fileName);
        break;
      default:
        break;
    }
  }

  return parts
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** 渲染已持久化的 composer segments（mention → DingTalkMentionTag 蓝色 token）。 */
export function UserComposerSegmentsContent({
  segments,
}: {
  segments: PersistedComposerSegment[];
}): ReactNode {
  return (
    <>
      {segments.map((seg, index) => {
        switch (seg.type) {
          case 'text': {
            const cleaned = stripGatewayMediaAttached(seg.text ?? '').replace(/\u00A0/g, ' ');
            return cleaned
              ? <span key={`seg-${index}`}>{renderUserMessageMentionNodes(cleaned)}</span>
              : null;
          }
          case 'mention':
            return (
              <span key={`seg-${index}`}>
                <DingTalkMentionTag
                  name={seg.mention.displayName}
                  kind={seg.mention.type === 'group' ? 'group' : 'user'}
                />
                {'\u00A0'}
              </span>
            );
          case 'skill':
            return (
              <span key={`seg-${index}`}>
                <SkillMessageTag title={seg.title} />
                {'\u00A0'}
              </span>
            );
          case 'workflow':
            return (
              <span key={`seg-${index}`}>
                <UserWorkflowMessageTag workflowName={seg.name} />
                {'\u00A0'}
              </span>
            );
          case 'file':
            return (
              <span key={`seg-${index}`}>
                <UserComposerFileChip
                  fileName={seg.fileName}
                  mimeType={seg.mimeType}
                  fileSize={seg.fileSize}
                />
                {'\u00A0'}
              </span>
            );
          default:
            return null;
        }
      })}
    </>
  );
}

export function parseWorkflowRunDisplayText(text: string): WorkflowRunDisplayMeta | null {
  const trimmed = text.trim();
  // 允许执行指令前后保留用户原文，气泡按「前文 + 标签 + 后文」还原。
  const execMatch = trimmed.match(
    /^(.*?)帮我执行\s*id\s*为\s*[:：]?\s*([A-Za-z0-9_-]+)\s*的工作流\s*(?:【([^】]*)】)?\s*([\s\S]*)$/,
  );
  if (!execMatch) return null;

  const beforeText = (execMatch[1] ?? '').trim() || undefined;
  const workflowId = execMatch[2]?.trim();
  if (!workflowId) return null;

  const bracketName = (execMatch[3] ?? '').trim();
  let accompanyingText = (execMatch[4] ?? '').trim() || undefined;
  let workflowName = bracketName || workflowId;

  if (!bracketName && accompanyingText) {
    // 兼容旧格式：无【】时整段视为名称
    workflowName = accompanyingText;
    accompanyingText = undefined;
  }

  return { workflowId, workflowName, beforeText, accompanyingText };
}

function cleanTextForSynth(text: string): string {
  return stripGatewayMediaAttached(stripComposerGatewayPlaceholders(text))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

const COMPOSER_BAKE_EVIDENCE_RE =
  /\[文件:\s*[^\]]*\]|\[技能:\s*[^\]]*\]|帮我执行\s*id\s*为\s*[:：]?\s*[A-Za-z0-9_-]+\s*的工作流/;

function fileLabelMatches(file: AttachedFileMeta, label: string): boolean {
  const normalizedLabel = label.replace(/］/g, ']').trim();
  if (!normalizedLabel) return false;
  const name = (file.fileName || '').replace(/］/g, ']').trim();
  if (name === normalizedLabel) return true;
  const base = name.split(/[/\\]/).pop() ?? name;
  if (base === normalizedLabel) return true;
  const pathBase = (file.filePath || '').split(/[/\\]/).pop() ?? '';
  return Boolean(pathBase) && pathBase === normalizedLabel;
}

/**
 * 缺少 `_composerSegments` 时构建气泡 segments（旧数据 / 未 patch 的 history）。
 * 文本 segment 中不得残留 stage-6 `[文件:]` / `[技能:]`。
 * 优先按占位符 + 工作流执行句重建顺序；否则文件 chip 可能前置（顺序未知），但正文须剥离占位符。
 */
export function synthesizeComposerSegments(
  message: RawMessage,
  text: string,
  skillMeta?: SkillMeta,
  attachedFiles: AttachedFileMeta[] = [],
): PersistedComposerSegment[] | null {
  if (message._composerSegments?.length) {
    return message._composerSegments;
  }

  const segments: PersistedComposerSegment[] = [];
  const workflowDisplay = parseWorkflowRunDisplayText(text);
  const skillMetas = message._skillMetas ?? (skillMeta ? [skillMeta] : []);
  const hasFilePlaceholders = /\[文件:\s*[^\]]*\]/.test(text);
  const hasSkillPlaceholders = /\[技能:\s*[^\]]*\]/.test(text);
  const hasWorkflowBake = /帮我执行\s*id\s*为\s*[:：]?\s*[A-Za-z0-9_-]+\s*的工作流/.test(text);

  if (hasFilePlaceholders || hasSkillPlaceholders || hasWorkflowBake) {
    const reconstructed = reconstructSegmentsFromGatewayPlaceholders(
      text,
      attachedFiles,
      skillMetas,
    );
    if (reconstructed?.length) return reconstructed;
  }

  // 旧数据 / 无顺序信息：文件可能在最前；正文不得残留占位符。
  for (const file of attachedFiles) {
    segments.push({
      type: 'file',
      fileName: file.fileName,
      mimeType: file.mimeType,
      fileSize: file.fileSize,
      preview: file.preview,
      filePath: file.filePath,
      stagedPath: file.filePath,
    });
  }

  if (workflowDisplay) {
    if (workflowDisplay.beforeText) {
      const before = cleanTextForSynth(workflowDisplay.beforeText);
      if (before) segments.push({ type: 'text', text: `${before}\u00A0` });
    }
    segments.push({
      type: 'workflow',
      id: workflowDisplay.workflowId,
      name: workflowDisplay.workflowName,
      source: 'mine',
    });
    if (workflowDisplay.accompanyingText) {
      const after = cleanTextForSynth(workflowDisplay.accompanyingText);
      if (after) segments.push({ type: 'text', text: `\u00A0${after}` });
    }
    return segments.length ? segments : null;
  }

  const cleaned = cleanTextForSynth(text);

  if (skillMetas.length === 1 && skillMeta) {
    const offset = Math.min(Math.max(skillMeta.tagOffset ?? 0, 0), cleaned.length);
    const before = cleaned.slice(0, offset);
    const after = cleaned.slice(offset);
    if (before) segments.push({ type: 'text', text: before });
    segments.push({ type: 'skill', slug: skillMeta.slug, title: skillMeta.title });
    if (after) segments.push({ type: 'text', text: after });
    return segments.length ? segments : null;
  }

  if (cleaned) {
    segments.push({ type: 'text', text: cleaned });
  }

  return segments.length ? segments : null;
}

/**
 * 遍历 gateway bake 文本，按 `[文件:]` / `[技能:]` / 工作流执行句重建行内顺序。
 */
function reconstructSegmentsFromGatewayPlaceholders(
  text: string,
  attachedFiles: AttachedFileMeta[],
  skillMetas: SkillMeta[],
): PersistedComposerSegment[] | null {
  const tokenRe =
    /\[文件:\s*([^\]]*)\]|\[技能:\s*([^\]]*)\]|帮我执行\s*id\s*为\s*[:：]?\s*([A-Za-z0-9_-]+)\s*的工作流\s*(?:【([^】]*)】)?/g;
  const segments: PersistedComposerSegment[] = [];
  const unusedFiles = [...attachedFiles];
  const unusedSkills = [...skillMetas];
  let lastIndex = 0;
  let match: RegExpExecArray | null = tokenRe.exec(text);

  while (match) {
    const before = text.slice(lastIndex, match.index);
    const cleanedBefore = cleanTextForSynth(before);
    if (cleanedBefore) segments.push({ type: 'text', text: cleanedBefore });

    if (match[1] !== undefined) {
      const label = match[1].trim();
      const fileIndex = unusedFiles.findIndex((file) => fileLabelMatches(file, label));
      const file = fileIndex >= 0
        ? unusedFiles.splice(fileIndex, 1)[0]
        : unusedFiles.shift();
      if (file) {
        const displayName = label
          || file.fileName.split(/[/\\]/).pop()
          || file.fileName;
        segments.push({
          type: 'file',
          fileName: displayName,
          mimeType: file.mimeType,
          fileSize: file.fileSize,
          preview: file.preview,
          filePath: file.filePath,
          stagedPath: file.filePath,
        });
      } else if (label) {
        segments.push({
          type: 'file',
          fileName: label,
          mimeType: 'application/octet-stream',
          fileSize: 0,
          preview: null,
          filePath: '',
          stagedPath: '',
        });
      }
    } else if (match[2] !== undefined) {
      const label = match[2].trim();
      const skillIndex = unusedSkills.findIndex((skill) => (
        skill.title === label || skill.slug === label
      ));
      const skill = skillIndex >= 0
        ? unusedSkills.splice(skillIndex, 1)[0]
        : unusedSkills.shift();
      if (skill) {
        segments.push({ type: 'skill', slug: skill.slug, title: skill.title });
      } else if (label) {
        segments.push({ type: 'skill', slug: label, title: label });
      }
    } else if (match[3] !== undefined) {
      const workflowId = match[3].trim();
      const workflowName = (match[4] ?? '').trim() || workflowId;
      segments.push({
        type: 'workflow',
        id: workflowId,
        name: workflowName,
        source: 'mine',
      });
    }

    lastIndex = match.index + match[0].length;
    match = tokenRe.exec(text);
  }

  const tail = cleanTextForSynth(text.slice(lastIndex));
  if (tail) segments.push({ type: 'text', text: tail });

  // 无匹配占位符的剩余附件——追加到末尾（顺序未知）。
  for (const file of unusedFiles) {
    segments.push({
      type: 'file',
      fileName: file.fileName,
      mimeType: file.mimeType,
      fileSize: file.fileSize,
      preview: file.preview,
      filePath: file.filePath,
      stagedPath: file.filePath,
    });
  }
  for (const skill of unusedSkills) {
    segments.push({ type: 'skill', slug: skill.slug, title: skill.title });
  }

  return segments.length ? segments : null;
}

export function prepareGatewayTextForComposerSynth(raw: string, skillMeta?: SkillMeta | null): string {
  let text = stripUserNoiseKeepComposerBake(raw);
  if (!skillMeta) return text;
  const { defaultPrompt, title: plazaTitle } = resolveSkillFromPlaza(skillMeta.slug);
  const title = (skillMeta.title?.trim() || plazaTitle).trim();
  const prompt = defaultPrompt.trim() || title;
  return stripSkillGatewayPrefix(text, prompt, title, skillMeta.slug);
}

/**
 * history 加载后、把 skill content 收缩成 displayText 之前：
 * 从仍含 bake 的 gateway 原文重建 `_composerSegments`，避免切会话后 chip 前置 / 工作流丢失。
 */
export function hydrateComposerSegmentsOnMessages(messages: RawMessage[]): RawMessage[] {
  return messages.map((message) => {
    if (message.role !== 'user') return message;
    if (message._composerSegments?.length) return message;

    const raw = getMessageText(message.content);
    if (!raw || !COMPOSER_BAKE_EVIDENCE_RE.test(raw)) return message;

    const skillMeta = message._skillMeta ?? parseSkillTranscriptMarker(raw) ?? undefined;
    const skillMetas = message._skillMetas
      ?? (skillMeta ? [skillMeta] : undefined);
    const attachedFiles = message._attachedFiles ?? [];
    const synthText = prepareGatewayTextForComposerSynth(raw, skillMeta);
    const segments = synthesizeComposerSegments(
      {
        ...message,
        _composerSegments: undefined,
        _skillMeta: skillMeta,
        _skillMetas: skillMetas,
      },
      synthText,
      skillMeta,
      attachedFiles,
    );
    if (!segments?.length) return message;

    const displayContent = skillMeta
      ? deriveSkillUserDisplayText(
        stripSkillTranscriptMarker(raw),
        skillMeta.slug,
        skillMeta.title,
      )
      : normalizeUserMessageForDisplay(raw);

    return {
      ...message,
      _skillMeta: skillMeta ?? message._skillMeta,
      _skillMetas: skillMetas ?? message._skillMetas,
      _composerSegments: segments,
      content: displayContent,
    };
  });
}
