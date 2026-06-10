import fs from 'fs';
import path from 'path';

/**
 * Parse simple YAML frontmatter text from SKILL.md.
 *
 * Supports:
 * - Single-line values: `key: value`, `key: "value"`
 * - Multi-line folded blocks: `key: >`, `key: >-`, `key: >+`
 * - Multi-line literal blocks: `key: |`, `key: |-`, `key: |+`
 *
 * Does NOT support nested objects, arrays, anchors, or complex YAML.
 */
export function parseSkillFrontmatter(frontmatter: string): Record<string, string> {
  const lines = frontmatter.split('\n');
  const meta: Record<string, string> = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const colonIdx = line.indexOf(':');
    if (colonIdx <= 0) {
      i++;
      continue;
    }

    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();

    // Block scalar indicator: >, >-, >+, |, |-, |+
    // May have same-line content after the indicator
    const blockMatch = value.match(/^(>[+-]?|[|][+-]?)(?:\s+(.*))?$/);
    if (blockMatch) {
      const indicator = blockMatch[1];
      const sameLineContent = blockMatch[2] || '';
      i++;
      const blockLines: string[] = sameLineContent ? [sameLineContent] : [];

      while (i < lines.length) {
        const nextLine = lines[i];
        if (nextLine.trim() === '') {
          blockLines.push('');
          i++;
          continue;
        }
        // Part of block if indented
        if (nextLine.startsWith(' ') || nextLine.startsWith('\t')) {
          blockLines.push(nextLine.trimStart());
          i++;
        } else {
          break;
        }
      }

      if (indicator.startsWith('>')) {
        // Folded: join lines with spaces, double newline for paragraph breaks
        let result = '';
        let needsSpace = false;
        for (const bl of blockLines) {
          if (bl === '') {
            if (result) result += '\n';
            needsSpace = false;
          } else {
            if (result && needsSpace) result += ' ';
            result += bl;
            needsSpace = true;
          }
        }
        value = result;
      } else {
        // Literal: preserve newlines
        value = blockLines.join('\n');
      }
    } else {
      // Simple inline value, strip surrounding quotes
      value = value.replace(/^["']|["']$/g, '');
      i++;
    }

    meta[key] = value;
  }

  return meta;
}

/**
 * Read and parse SKILL.md frontmatter from a skill directory.
 * Normalizes CRLF to LF before parsing.
 * Returns null if the file doesn't exist or has no frontmatter.
 */
export function readSkillMdFrontmatter(skillDir: string): Record<string, string> | null {
  try {
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) return null;
    const raw = fs.readFileSync(skillMdPath, 'utf8').replace(/\r\n/g, '\n');
    const frontmatterMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return null;
    return parseSkillFrontmatter(frontmatterMatch[1]);
  } catch {
    return null;
  }
}
