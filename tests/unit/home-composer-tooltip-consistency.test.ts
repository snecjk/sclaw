import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Home composer tooltip consistency', () => {
  it('shares the new-project tooltip appearance across composer actions', () => {
    const source = readSource(
      'src/components/input-composer/input-composer-toolbar-icon-tooltip.tsx',
    );

    expect(source).toContain('sidebarTooltipContentClass');
    expect(source).toContain('sidebarTooltipArrowClass');
    expect(source).toContain('delayDuration={300}');
  });

  it('replaces native title bubbles on the engine/model cascade', () => {
    const source = readSource('src/pages/Chat/ChatEngineModelSelectors.tsx');

    expect(source).toContain('InputComposerToolbarIconTooltip');
    expect(source).not.toContain('title={`${engineTriggerTitle} · ${switchTitle}`}');
  });

  it('replaces the native microphone title bubble', () => {
    const source = readSource('src/pages/Chat/ChatInput.tsx');

    expect(source).toContain('label={voiceButtonTitle}');
    expect(source).not.toContain('title={voiceButtonTitle}');
  });

  it('replaces native send and stop title bubbles', () => {
    const source = readSource(
      'src/components/input-composer/input-composer-send-button.tsx',
    );

    expect(source).toContain('InputComposerToolbarIconTooltip');
    expect(source).not.toContain('title={sendTitle}');
    expect(source).not.toContain('title={sending ? stopTitle : sendTitle}');
  });
});
