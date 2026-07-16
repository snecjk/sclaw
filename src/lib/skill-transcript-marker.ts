/**
 * Hidden skill marker embedded in Gateway user message text.
 * Persisted in OpenClaw session transcripts (.jsonl) — survives app restart and localStorage clears.
 */
import { resolveSkillFromPlaza } from '@/lib/skill-plaza-resolve';
import { stripGatewayUserMetadataPreservingLines } from '@/lib/user-message-display';
import { getMessageText } from '@/stores/chat/helpers';
import type { RawMessage } from '@/stores/chat/types';
import type { SkillMeta } from '@/types/skill-meta';

const SKILL_MARKER_RE = /<!--\s*SClaw-Skill\s+(\{[\s\S]*?\})\s*-->/;

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
  return text.replace(SKILL_MARKER_RE, '').trimEnd();
}

export function parseSkillTranscriptMarker(text: string): SkillMeta | null {
  const match = SKILL_MARKER_RE.exec(text);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]) as { slug?: string; title?: string };
    if (!parsed.slug?.trim()) return null;
    const slug = parsed.slug.trim();
    return {
      slug,
      title: (parsed.title?.trim() || slug),
    };
  } catch {
    return null;
  }
}

function stripSkillGatewayPrefix(body: string, prompt: string, title: string): string {
  let text = body.trim();
  if (!text) return '';

  for (const prefix of [prompt, title]) {
    if (!prefix || text !== prefix) continue;
    return '';
  }

  for (const prefix of [prompt, title]) {
    if (!prefix) continue;
    for (const separator of ['\n\n', '\n', ' ']) {
      const lead = `${prefix}${separator}`;
      if (text.startsWith(lead)) {
        text = text.slice(lead.length).trim();
        break;
      }
    }
  }

  const lines = text.split('\n').map((line) => line.trim());
  if (lines.length > 1 && lines[0] === title) {
    text = lines.slice(1).join('\n').trim();
  }

  return text;
}

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
  const userText = stripSkillGatewayPrefix(body, prompt, title);
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
    if (message.role !== 'user' || message._skillMeta) return message;
    const raw = getMessageText(message.content);
    const skillMeta = parseSkillTranscriptMarker(raw);
    if (!skillMeta) return message;

    const withoutMarker = stripSkillTranscriptMarker(raw);
    const displayText = deriveSkillUserDisplayText(withoutMarker, skillMeta.slug, skillMeta.title);
    return {
      ...message,
      _skillMeta: skillMeta,
      content: displayText,
    };
  });
}
