import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function stripLeadingBlockComment(source: string): string {
  let result = source;
  let prev: string;
  do {
    prev = result;
    result = result.replace(/^\s*\/\*\*[\s\S]*?\*\/\s*/, '');
  } while (result !== prev);
  return result;
}

describe('OpenClaw plugin vendor sync', () => {
  it('keeps sto-dynamic-agent-route workspace-paths aligned with shared/workspace-paths.ts', () => {
    const root = readFileSync(join(process.cwd(), 'shared', 'workspace-paths.ts'), 'utf8');
    const vendor = readFileSync(
      join(
        process.cwd(),
        'sto-plugin/openclaw/sto-dynamic-agent-route/shared/workspace-paths.ts',
      ),
      'utf8',
    );
    expect(stripLeadingBlockComment(vendor)).toBe(stripLeadingBlockComment(root));
  });

  it('keeps sto-dynamic-agent-route retired-skills aligned with shared/retired-skills.ts', () => {
    const root = readFileSync(join(process.cwd(), 'shared', 'retired-skills.ts'), 'utf8');
    const vendor = readFileSync(
      join(
        process.cwd(),
        'sto-plugin/openclaw/sto-dynamic-agent-route/shared/retired-skills.ts',
      ),
      'utf8',
    );
    expect(stripLeadingBlockComment(vendor)).toBe(stripLeadingBlockComment(root));
  });
});
