/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = dirname(fileURLToPath(import.meta.url));
const selectorSource = readFileSync(
  resolve(testDir, '../../src/pages/Chat/ChatEngineModelSelectors.tsx'),
  'utf8',
);
const homeComposerSource = readFileSync(
  resolve(testDir, '../../src/pages/Home/HomeComposer.tsx'),
  'utf8',
);
const chatPageSource = readFileSync(
  resolve(testDir, '../../src/pages/Chat/index.tsx'),
  'utf8',
);

describe('chat inline model selector layout', () => {
  it('keeps the selected model label visible instead of truncating it', () => {
    expect(selectorSource).toContain('inlineModelPillTrigger');
    expect(selectorSource).toContain('whitespace-nowrap');
    expect(selectorSource).toContain('<span className="shrink-0 whitespace-nowrap">{modelDisplayText}</span>');
    expect(selectorSource).not.toContain('<span className="min-w-0 flex-1 truncate">{modelDisplayText}</span>');
  });

  it('does not force the inline model selector to share width with the engine selector', () => {
    expect(homeComposerSource).toContain('<ChatModelSelector variant="inline" className="min-w-max shrink-0" />');
    expect(chatPageSource).toContain('<ChatModelSelector variant="inline" className="min-w-max shrink-0" />');
  });
});
