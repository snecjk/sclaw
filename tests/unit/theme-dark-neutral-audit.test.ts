import { readdirSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function activeStyleSources(directory: string): Array<{ file: string; source: string }> {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return activeStyleSources(path);
    if (!['.ts', '.tsx'].includes(extname(entry.name))) return [];
    return [{ file: path, source: readFileSync(path, 'utf8') }];
  });
}

describe('dark neutral appearance audit', () => {
  it('contains no known blue-black or cool-gray dark surface fallbacks', () => {
    const forbidden = /dark:[^\s'"`]*\[#(?:131a24|0f172a|111827|1f2937|1e293b|252a2e|343a40|46515a|2e3038|a8b8c8)\]/gi;
    const failures = activeStyleSources(resolve(process.cwd(), 'src')).flatMap(({ file, source }) => {
      const lines = source.split('\n').flatMap((line, index) => {
        const values = [...line.matchAll(forbidden)].map((match) => match[0]);
        return values.length === 0 ? [] : [`${file}:${index + 1}: ${values.join(', ')}`];
      });
      return lines;
    });

    expect(failures).toEqual([]);
  });
});
