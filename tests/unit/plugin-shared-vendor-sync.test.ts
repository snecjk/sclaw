import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLUGIN_SHARED_VENDOR_PAIRS } from '../../scripts/plugin-shared-vendor-pairs.mjs';

function stripLeadingBlockComment(source: string): string {
  let result = source;
  let prev: string;
  do {
    prev = result;
    result = result.replace(/^\s*\/\*\*[\s\S]*?\*\/\s*/, '');
  } while (result !== prev);
  return result;
}

describe('plugin shared vendor sync', () => {
  it('keeps every mapped vendor copy body-equal to shared SSOT', () => {
    const root = path.resolve(__dirname, '../..');
    for (const pair of PLUGIN_SHARED_VENDOR_PAIRS) {
      const rootBody = stripLeadingBlockComment(
        readFileSync(path.join(root, pair.rootRel), 'utf8'),
      );
      const vendorBody = stripLeadingBlockComment(
        readFileSync(path.join(root, pair.vendorRel), 'utf8'),
      );
      expect(vendorBody, pair.vendorRel).toBe(rootBody);
    }
  });
});
