import { isAbsolute, relative, resolve } from 'node:path';

export function extractClaudeSkillSlugs(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const slugs: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const record = block as Record<string, unknown>;
    if (record.type !== 'tool_use' || String(record.name ?? '').toLowerCase() !== 'skill') continue;
    const input = record.input && typeof record.input === 'object'
      ? record.input as Record<string, unknown>
      : {};
    const slug = [input.skill, input.slug, input.name]
      .find((value): value is string => typeof value === 'string' && Boolean(value.trim()));
    if (slug) slugs.push(slug.trim().toLowerCase());
  }
  return [...new Set(slugs)];
}

export function extractPiReadPaths(message: unknown): string[] {
  if (!message || typeof message !== 'object') return [];
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  const paths: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const record = block as Record<string, unknown>;
    if (record.type !== 'toolCall' || String(record.name ?? '').toLowerCase() !== 'read') continue;
    const args = record.arguments && typeof record.arguments === 'object'
      ? record.arguments as Record<string, unknown>
      : {};
    const path = [args.path, args.file_path, args.filePath]
      .find((value): value is string => typeof value === 'string' && Boolean(value.trim()));
    if (path) paths.push(path);
  }
  return paths;
}

export function resolvePiReadSkillSlug(
  selected: Array<{ slug: string; sourceDir: string }>,
  candidate: string,
): string | undefined {
  if (!isAbsolute(candidate)) return undefined;
  return selected.find((skill) => {
    const child = relative(resolve(skill.sourceDir), resolve(candidate));
    if (child.startsWith('..') || isAbsolute(child)) return false;
    const normalized = child.replace(/\\/g, '/').toLowerCase();
    return normalized === 'skill.md' || normalized.startsWith('references/');
  })?.slug;
}
