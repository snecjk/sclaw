import { describe, expect, it } from 'vitest';
import {
  classifyAppDevElementTuneKind,
  elementTuneFieldsForKind,
  hashSelector,
  normalizeAppDevPickedElement,
  parseCssPx,
  replaceUniqueSourceText,
  upsertElementOverrideCssBlock,
} from '@/lib/app-dev-element-tune';
import { parseColorToOklch, rgbToOklch } from '@/lib/app-dev-tune-tokens';
import { buildElementPickerScript } from '@/lib/app-dev-tune-scripts';

describe('app-dev element tune', () => {
  it('classifies heading as text and img as image', () => {
    expect(classifyAppDevElementTuneKind({ selector: 'h1', tag: 'h1', text: '标题' })).toBe('text');
    expect(classifyAppDevElementTuneKind({ selector: 'img.hero', tag: 'img', src: '/a.png' })).toBe('image');
    expect(classifyAppDevElementTuneKind({ selector: 'button', tag: 'button', text: '提交' })).toBe('button');
    expect(classifyAppDevElementTuneKind({ selector: 'div.card', tag: 'div' })).toBe('container');
  });

  it('exposes different fields per kind', () => {
    expect(elementTuneFieldsForKind('text')).toContain('fontSize');
    expect(elementTuneFieldsForKind('image')).toContain('src');
    expect(elementTuneFieldsForKind('button')).toContain('background');
  });

  it('upserts selector-scoped CSS blocks', () => {
    const first = upsertElementOverrideCssBlock(':root { color: red; }\n', 'h1.hero', { color: 'blue' });
    expect(first).toContain('h1.hero');
    expect(first).toContain(`sclaw-el:${hashSelector('h1.hero')}`);
    const second = upsertElementOverrideCssBlock(first, 'h1.hero', { color: 'green' });
    expect(second.match(/h1\.hero/g)).toHaveLength(1);
    expect(second).toContain('color: green;');
  });

  it('replaces unique source text only', () => {
    expect(replaceUniqueSourceText('hello world', 'world', 'there')).toBe('hello there');
    expect(replaceUniqueSourceText('world world', 'world', 'x')).toBeNull();
  });

  it('parses px and rgb colors', () => {
    expect(parseCssPx('16px')).toBe(16);
    expect(parseCssPx('1rem')).toBe(16);
    expect(rgbToOklch('rgb(255, 111, 0)')).not.toBeNull();
    expect(parseColorToOklch('rgb(29, 33, 41)')).not.toBeNull();
  });

  it('keeps inspect picker teardown on Escape and tune picker clearing selection', () => {
    expect(buildElementPickerScript('inspect')).toContain('emit(\'cancel\'');
    expect(buildElementPickerScript('tune')).toContain('MODE === \'tune\'');
    expect(buildElementPickerScript('tune')).toContain('data-a2ui-component-id');
    const script = buildElementPickerScript('tune');
    expect(script.indexOf('data-a2ui-component-id')).toBeLessThan(script.indexOf('nth-of-type'));
  });

  it('fills kind and drops empty a2ui stamps', () => {
    const next = normalizeAppDevPickedElement({
      selector: 'h1',
      tag: 'h1',
      text: '标题',
      a2uiPageId: '',
      a2uiComponentId: 'title',
    });
    expect(next.kind).toBe('text');
    expect(next.a2uiPageId).toBeUndefined();
    expect(next.a2uiComponentId).toBe('title');
  });
});
