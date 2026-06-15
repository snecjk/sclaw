/** <ParameterForm templateId="..." schemaHash="..." /> — attribute order flexible */
export const PARAM_FORM_MARKER_REGEX =
  /<ParameterForm\s+(?:(?:templateId="([^"]+)"\s+schemaHash="([^"]+)")|(?:schemaHash="([^"]+)"\s+templateId="([^"]+)"))\s*\/?>/i;

export function parseParameterFormMarker(text: string): { templateId: string; schemaHash: string } | null {
  const match = text.match(PARAM_FORM_MARKER_REGEX);
  if (!match) return null;
  const templateId = match[1] || match[4];
  const schemaHash = match[2] || match[3];
  if (!templateId || !schemaHash) return null;
  return { templateId, schemaHash };
}

export function findParameterFormMarkerInMessage(
  message: { content?: unknown },
): { templateId: string; schemaHash: string } | null {
  const content = message.content;
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (
      block
      && typeof block === 'object'
      && (block as { type?: string }).type === 'text'
      && typeof (block as { text?: string }).text === 'string'
    ) {
      const parsed = parseParameterFormMarker((block as { text: string }).text);
      if (parsed) return parsed;
    }
  }
  return null;
}
