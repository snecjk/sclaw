import { traceChatSession } from '../../../shared/chat-session-trace';
import { normalizeDerivedSessionLabel, isCorruptedSessionLabel } from '@/lib/workflow-session-hint';
import { shouldAutoDeriveSessionLabel } from '@/lib/session-label';
import type { ChatGet, ChatSet } from './store-api';
import type { AttachedFileMeta, RawMessage, SendMessageOptions } from './types';
import { rememberSkillMessageMeta } from '@/lib/skill-message-meta-cache';
import { useChatRuntimeV2Store } from './runtime-v2-store';
import { logUserQuestion } from './chat-flow-log';
import { touchEmbedChatActivity } from '@/lib/sclaw-browser-chat-index';

function attachedFilesFromComposerSegments(
  segments: NonNullable<SendMessageOptions['composerSegments']>,
): AttachedFileMeta[] {
  return segments
    .filter((seg): seg is Extract<typeof seg, { type: 'file' }> => seg.type === 'file')
    .map((seg) => ({
      fileName: seg.fileName,
      mimeType: seg.mimeType,
      fileSize: seg.fileSize,
      preview: seg.preview,
      filePath: seg.stagedPath ?? seg.filePath,
    }));
}

function summarizeSegmentsForLog(
  segments: NonNullable<SendMessageOptions['composerSegments']> | undefined,
): Array<{ type: string; detail?: string }> {
  if (!segments?.length) return [];
  return segments.map((seg) => {
    switch (seg.type) {
      case 'text':
        return { type: 'text', detail: seg.text.slice(0, 120) };
      case 'mention':
        return { type: 'mention', detail: seg.mention.displayName };
      case 'skill':
        return { type: 'skill', detail: `${seg.slug}|${seg.title}` };
      case 'workflow':
        return { type: 'workflow', detail: `${seg.id}|${seg.name}|${seg.source ?? ''}` };
      case 'file':
        return { type: 'file', detail: seg.fileName };
      default:
        return { type: 'unknown' };
    }
  });
}

export function insertOptimisticUserTurn(input: {
  get: ChatGet;
  set: ChatSet;
  sessionKey: string;
  displayText: string;
  gatewayMessage: string;
  attachments?: SendMessageOptions['attachments'];
  skillMeta?: SendMessageOptions['skillMeta'];
  skillMetas?: SendMessageOptions['skillMetas'];
  composerSegments?: SendMessageOptions['composerSegments'];
}): RawMessage {
  const {
    attachments,
    composerSegments,
    displayText,
    gatewayMessage,
    skillMeta,
    skillMetas,
    get,
    sessionKey,
    set: _set,
  } = input;
  const resolvedSkillMetas = skillMetas ?? (skillMeta ? [skillMeta] : []);
  const primarySkillMeta = resolvedSkillMetas[0] ?? skillMeta;
  const nowMs = Date.now();
  const attachedFiles = composerSegments?.length
    ? attachedFilesFromComposerSegments(composerSegments)
    : attachments?.map((a) => ({
      fileName: a.fileName,
      mimeType: a.mimeType,
      fileSize: a.fileSize,
      preview: a.preview,
      filePath: a.stagedPath,
    }));

  const userMsg: RawMessage = {
    role: 'user',
    // 仅附件/工作流时 displayText 可为空；气泡靠 _composerSegments / _attachedFiles 渲染 chip。
    content: displayText,
    timestamp: nowMs / 1000,
    id: crypto.randomUUID(),
    _skillMeta: primarySkillMeta,
    _skillMetas: resolvedSkillMetas.length ? resolvedSkillMetas : undefined,
    _composerSegments: composerSegments,
    _attachedFiles: attachedFiles,
  };

  if (primarySkillMeta && userMsg.id) {
    rememberSkillMessageMeta(sessionKey, userMsg.id, displayText, primarySkillMeta, nowMs);
  }

  traceChatSession({
    phase: 'merge-optimistic',
    action: 'optimistic-insert',
    sessionKey,
    userMessageAt: nowMs,
    sending: true,
    optimisticId: userMsg.id,
    reason: 'sendMessage',
    detail: {
      displayLen: displayText.length,
      gatewayLen: gatewayMessage.length,
      idempotencyKey: userMsg.id,
    },
  });

  logUserQuestion('optimistic', {
    sessionKey,
    optimisticId: userMsg.id,
    displayText,
    gatewayText: gatewayMessage,
    skillMetas: resolvedSkillMetas.map((s) => ({ slug: s.slug, title: s.title, tagOffset: s.tagOffset })),
    attachmentCount: attachedFiles?.length ?? 0,
    attachments: attachedFiles?.map((f) => ({
      fileName: f.fileName,
      mimeType: f.mimeType,
      filePath: f.filePath,
    })),
    segments: summarizeSegmentsForLog(composerSegments),
    content: userMsg.content,
  });

  useChatRuntimeV2Store.getState().setOptimisticUserMessage(sessionKey, userMsg);

  const { sessionLabels } = get();
  const messages = useChatRuntimeV2Store.getState().sessionsByKey[sessionKey]?.transcript ?? [];
  const isFirstMessage = !messages.slice(0, -1).some((m) => m.role === 'user');
  if (
    get().currentSessionKey === sessionKey
    &&
    !sessionKey.endsWith(':main')
    && isFirstMessage
    && shouldAutoDeriveSessionLabel(sessionKey, sessionLabels, isCorruptedSessionLabel)
    && (displayText || primarySkillMeta?.title)
  ) {
    const normalized = normalizeDerivedSessionLabel(displayText || primarySkillMeta?.title || '');
    if (normalized) {
      _set((s) => ({
        sessionLabels: {
          ...s.sessionLabels,
          [sessionKey]: normalized,
        },
      }));
    }
  }

  _set((s) => ({ sessionLastActivity: { ...s.sessionLastActivity, [sessionKey]: nowMs } }));
  touchEmbedChatActivity(sessionKey);

  return userMsg;
}
