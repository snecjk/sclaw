import type { BridgeComposerFillSegment } from '../../../shared/jsbridge/composer-fill-segments';
import { bridgeComposerFillPlainText } from '../../../shared/jsbridge/composer-fill-segments';
import type { PersistedComposerSegment } from '@/lib/dingtalk-mention-composer';
import { resolveSkillFromPlaza } from '@/lib/skill-plaza-resolve';
import type { SkillMeta } from '@/types/skill-meta';

export interface ResolvedComposerFill {
  segments: PersistedComposerSegment[];
  plainText: string;
  skillMetas: SkillMeta[];
  workflows: Array<{ id: string; name: string; source?: string }>;
}

export function resolveComposerFillSegments(
  bridgeSegments: BridgeComposerFillSegment[],
): ResolvedComposerFill {
  const segments: PersistedComposerSegment[] = [];
  const skillMetas: SkillMeta[] = [];
  const workflows: Array<{ id: string; name: string; source?: string }> = [];

  for (const seg of bridgeSegments) {
    switch (seg.type) {
      case 'text': {
        if (!seg.text) break;
        segments.push({ type: 'text', text: seg.text });
        break;
      }
      case 'skill': {
        const slug = seg.slug.trim();
        if (!slug) break;
        const resolved = resolveSkillFromPlaza(slug);
        const title = seg.title?.trim() || resolved.title;
        segments.push({ type: 'skill', slug, title });
        skillMetas.push({ slug, title });
        break;
      }
      case 'workflow': {
        const id = seg.id.trim();
        if (!id) break;
        const name = seg.name?.trim() || id;
        segments.push({ type: 'workflow', id, name });
        workflows.push({ id, name });
        break;
      }
      default:
        break;
    }
  }

  return {
    segments,
    plainText: bridgeComposerFillPlainText(bridgeSegments),
    skillMetas,
    workflows,
  };
}
