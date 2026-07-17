export interface SkillPickerItem {
  slug: string;
  title: string;
  description: string;
}

export interface HighlightSegment {
  text: string;
  highlight: boolean;
}

export function filterSkillsByQuery(skills: SkillPickerItem[], query: string): SkillPickerItem[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return skills;
  return skills.filter(
    (skill) =>
      skill.title.toLowerCase().includes(trimmed)
      || (skill.description ?? '').toLowerCase().includes(trimmed),
  );
}

/** Split text into segments for Brand-6 highlight rendering (case-insensitive substring match). */
export function splitHighlightSegments(text: string, query: string): HighlightSegment[] {
  if (!text) return [];
  const trimmed = query.trim();
  if (!trimmed) return [{ text, highlight: false }];

  const lowerText = text.toLowerCase();
  const lowerQuery = trimmed.toLowerCase();
  const segments: HighlightSegment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const matchIndex = lowerText.indexOf(lowerQuery, cursor);
    if (matchIndex === -1) {
      segments.push({ text: text.slice(cursor), highlight: false });
      break;
    }
    if (matchIndex > cursor) {
      segments.push({ text: text.slice(cursor, matchIndex), highlight: false });
    }
    segments.push({
      text: text.slice(matchIndex, matchIndex + trimmed.length),
      highlight: true,
    });
    cursor = matchIndex + trimmed.length;
  }

  return segments.length > 0 ? segments : [{ text, highlight: false }];
}
