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

  it('mounts the combined picker without forcing it beyond the composer width', () => {
    expect(homeComposerSource).toContain('<ChatEngineModelPicker className="min-w-0 max-w-full" />');
    expect(chatPageSource).toContain('<ChatEngineModelPicker className="min-w-0 max-w-full" />');
  });

  it('uses a styled portal menu without Radix composed callback refs', () => {
    expect(selectorSource).toContain('function SelectorMenu');
    expect(selectorSource).toContain('createPortal(');
    expect(selectorSource).toContain('ref={triggerRef}');
    expect(selectorSource).not.toContain('<select');
    expect(selectorSource).not.toContain('<DropdownMenuTrigger');
  });

  it('presents engine and model as independent panels', () => {
    expect(selectorSource).toContain('Combined independent engine/model picker');
    expect(selectorSource).toContain('const selectedEngine = canSwitchEngine ? agentDefaultEngineType : currentEngineType;');
    expect(selectorSource).toContain('const selected = option.value === selectedModelId;');
    expect(selectorSource).not.toContain('previewEngine');
    expect(selectorSource).not.toContain('模型 ·');
    expect(selectorSource).not.toContain('<ChevronRight');
  });
});
