const SKILL_MARKER_RE = /<!--\s*SClaw-Skill\s+(\{[\s\S]*?\})\s*-->/;

const INJECTED_CONTEXT_MARKERS = [
  '<!-- StoClaw-Agent-Memory -->',
  '<!-- StoClaw-Agent-Execution-Memory -->',
  '<!-- StoClaw-Workflow-Context -->',
  '<!-- StoClaw-Workflow-Session -->',
  '<!-- StoClaw-Embed-Browser-Context -->',
] as const;

function stripMarkedContext(text: string, marker: string): string {
  const start = text.indexOf(marker);
  if (start < 0) return text;
  const end = text.lastIndexOf(marker);
  if (end > start) {
    return [text.slice(0, start).trim(), text.slice(end + marker.length).trim()]
      .filter(Boolean)
      .join('\n\n');
  }
  return text.slice(0, start).trim();
}

/** Keep only the user's actual request before a turn is summarized into mem0. */
export function sanitizeMemoryCaptureUserMessage(rawText: string): string {
  const skillMatch = SKILL_MARKER_RE.exec(rawText);
  if (skillMatch) {
    try {
      const payload = JSON.parse(skillMatch[1]) as {
        title?: string;
        userText?: string;
      };
      const actualUserText = payload.userText?.trim() || payload.title?.trim();
      if (actualUserText) return actualUserText;
    } catch {
      // Fall through and remove the malformed marker and injected contexts.
    }
  }

  let text = rawText.replace(SKILL_MARKER_RE, '').trim();
  for (const marker of INJECTED_CONTEXT_MARKERS) {
    text = stripMarkedContext(text, marker);
  }
  return text.trim();
}
