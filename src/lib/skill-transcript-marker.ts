/**
 * Hidden skill marker embedded in Gateway user message text.
 * Persisted in OpenClaw session transcripts (.jsonl) — survives app restart and localStorage clears.
 *
 * 剥除 / 解析正则 SSOT：`shared/skill-transcript-marker.ts`（定时任务入库也用同一套）。
 */
import {
  parseSkillTranscriptMarkers,
  stripSkillGatewayPrefix,
  stripSkillTranscriptMarkers,
} from '../../shared/skill-transcript-marker';
import { resolveSkillFromPlaza } from '@/lib/skill-plaza-resolve';
import { stripGatewayUserMetadataPreservingLines } from '@/lib/user-message-display';
import { getMessageText } from '@/stores/chat/helpers';
import type { RawMessage } from '@/stores/chat/types';
import type { SkillMeta } from '@/types/skill-meta';

export function appendSkillTranscriptMarker(
  gatewayText: string,
  skillMeta: SkillMeta,
  userText?: string,
): string {
  const payload = JSON.stringify({
    slug: skillMeta.slug,
    title: skillMeta.title,
    userText: userText?.trim() || undefined,
  });
  const trimmed = gatewayText.trimEnd();
  return trimmed ? `${trimmed}\n<!-- SClaw-Skill ${payload} -->` : `<!-- SClaw-Skill ${payload} -->`;
}

export function stripSkillTranscriptMarker(text: string): string {
  return stripSkillTranscriptMarkers(text);
}

export function parseSkillTranscriptMarker(text: string): SkillMeta | null {
  const [first] = parseSkillTranscriptMarkers(text);
  return first ?? null;
}

export { stripSkillGatewayPrefix, parseSkillTranscriptMarkers };

/** Strip injected defaultPrompt prefix; keep only user-typed text for bubble display. */
export function deriveSkillUserDisplayText(
  gatewayTextWithoutMarker: string,
  slug: string,
  skillTitle?: string,
): string {
  const body = stripGatewayUserMetadataPreservingLines(gatewayTextWithoutMarker);
  if (!body) return '';
  const { defaultPrompt, title: plazaTitle } = resolveSkillFromPlaza(slug);
  const title = (skillTitle?.trim() || plazaTitle).trim();
  const prompt = defaultPrompt.trim() || title;
  const userText = stripSkillGatewayPrefix(body, prompt, title, slug);
  return normalizeSkillBubbleDisplayText(title, userText);
}

/** Title is rendered in SkillMessageTag — never repeat it in bubble body. */
export function normalizeSkillBubbleDisplayText(skillTitle: string, displayText: string): string {
  const title = skillTitle.trim();
  let text = displayText.trim();
  if (!text || !title) return text;
  if (text === title) return '';

  const lines = text.split('\n').map((line) => line.trim());
  if (lines.length > 1 && lines[0] === title) {
    text = lines.slice(1).join('\n').trim();
  }
  if (text === title) return '';
  return text;
}

export function applySkillTranscriptMetaToMessages(messages: RawMessage[]): RawMessage[] {
  return messages.map((message) => {
    if (message.role !== 'user') return message;
    const raw = getMessageText(message.content);
    const skillMeta = message._skillMeta ?? parseSkillTranscriptMarker(raw);
    if (!skillMeta) return message;

    // 已有 segments（hydrate / 乐观回写）：只补 _skillMeta，勿再破坏结构。
    if (message._composerSegments?.length) {
      if (message._skillMeta) return message;
      return { ...message, _skillMeta: skillMeta };
    }

    // 无 segments：收缩为 displayText（hydrate 应已先跑；此处为无 bake 可重建时的兜底）。
    const withoutMarker = stripSkillTranscriptMarker(raw);
    const displayText = deriveSkillUserDisplayText(withoutMarker, skillMeta.slug, skillMeta.title);
    return {
      ...message,
      _skillMeta: skillMeta,
      content: displayText,
    };
  });
}
