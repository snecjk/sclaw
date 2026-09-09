import { describe, expect, it } from 'vitest';
import {
  classifyAppDevElementTuneKind,
  elementTuneFieldsForKind,
  emptyElementTuneStyles,
  expandAlignmentStyles,
  formatCssBox,
  formatCssLength,
  hashSelector,
  normalizeAppDevPickedElement,
  parseCssBox,
  parseCssLength,
  parseCssPx,
  replaceUniqueSourceText,
  upsertElementOverrideCssBlock,
} from '@/lib/app-dev-element-tune';
import { parseColorToOklch, parseColorToRgba, rgbToOklch } from '@/lib/app-dev-tune-tokens';
import { buildApplyElementPatchScript, buildElementPickerScript } from '@/lib/app-dev-tune-scripts';

describe('app-dev element tune', () => {
  it('classifies heading as text and img as image', () => {
    expect(classifyAppDevElementTuneKind({ selector: 'h1', tag: 'h1', text: '标题' })).toBe('text');
    expect(classifyAppDevElementTuneKind({ selector: 'img.hero', tag: 'img', src: '/a.png' })).toBe('image');
    expect(classifyAppDevElementTuneKind({ selector: 'button', tag: 'button', text: '提交' })).toBe('button');
    expect(classifyAppDevElementTuneKind({ selector: 'div.card', tag: 'div' })).toBe('container');
    expect(classifyAppDevElementTuneKind({ selector: 'footer', tag: 'footer', text: '© 2026' })).toBe('container');
    expect(classifyAppDevElementTuneKind({ selector: 'nav', tag: 'nav' })).toBe('container');
    expect(classifyAppDevElementTuneKind({ selector: 'table', tag: 'table' })).toBe('table');
    expect(classifyAppDevElementTuneKind({
      selector: '[data-a2ui-component-id="table"]',
      tag: 'div',
      a2uiComponent: 'AntdTable',
    })).toBe('table');
  });

  it('exposes different fields per kind', () => {
    expect(elementTuneFieldsForKind('text')).toContain('fontSize');
    expect(elementTuneFieldsForKind('image')).toContain('src');
    expect(elementTuneFieldsForKind('button')).toContain('background');
    expect(elementTuneFieldsForKind('container')).toContain('justifyContent');
    expect(elementTuneFieldsForKind('container')).toContain('display');
    expect(elementTuneFieldsForKind('table')).toContain('boxModel');
    expect(elementTuneFieldsForKind('container', {
      selector: 'div',
      tag: 'div',
      styles: { display: 'block' },
    })).not.toContain('justifyContent');
  });

  it('upserts selector-scoped CSS blocks', () => {
    const first = upsertElementOverrideCssBlock(':root { color: red; }\n', 'h1.hero', { color: 'blue' });
    expect(first).toContain('h1.hero');
    expect(first).toContain(`sclaw-el:${hashSelector('h1.hero')}`);
    expect(first).toContain('color: blue !important;');
    const second = upsertElementOverrideCssBlock(first, 'h1.hero', { color: 'green' });
    expect(second.match(/h1\.hero/g)).toHaveLength(1);
    expect(second).toContain('color: green !important;');
    const fill = upsertElementOverrideCssBlock('', 'header.bar', { 'background-color': 'rgb(255, 255, 255)' });
    expect(fill).toContain('header.bar > :first-child');
    expect(fill).toContain('background-image: none !important;');
  });

  it('replaces unique source text only', () => {
    expect(replaceUniqueSourceText('hello world', 'world', 'there')).toBe('hello there');
    expect(replaceUniqueSourceText('world world', 'world', 'x')).toBeNull();
  });

  it('parses px and rgb colors', () => {
    expect(parseCssPx('16px')).toBe(16);
    expect(parseCssPx('1rem')).toBe(16);
    expect(parseCssPx('8px 16px')).toBe(8);
    expect(rgbToOklch('rgb(255, 111, 0)')).not.toBeNull();
    expect(parseColorToOklch('rgb(29, 33, 41)')).not.toBeNull();
    expect(parseColorToRgba('#FF6F00')).toEqual({ r: 255, g: 111, b: 0, a: 1 });
    expect(parseColorToRgba('rgba(29, 33, 41, 0.5)')).toEqual({ r: 29, g: 33, b: 41, a: 0.5 });
    expect(parseColorToRgba('linear-gradient(rgb(255, 111, 0), #fff)')).toEqual({
      r: 255, g: 111, b: 0, a: 1,
    });
    expect(parseCssLength('100%')).toEqual({ value: 100, unit: '%' });
    expect(parseCssLength('auto')).toEqual({ value: 0, unit: 'auto' });
    expect(formatCssLength({ value: 120, unit: 'px' })).toBe('120px');
    expect(parseCssBox('8px 16px')).toEqual({ top: 8, right: 16, bottom: 8, left: 16 });
    expect(formatCssBox({ top: 8, right: 8, bottom: 8, left: 8 })).toBe('8px');
    expect(emptyElementTuneStyles()['border-width']).toBe('');
  });

  it('expands container alignment into flex so children follow', () => {
    expect(expandAlignmentStyles('center')).toEqual({ 'text-align': 'center' });
    expect(expandAlignmentStyles('right', true)).toMatchObject({
      display: 'flex',
      'text-align': 'right',
      'justify-content': 'flex-end',
    });
    expect(buildApplyElementPatchScript('header', {
      styles: { 'text-align': 'center', 'justify-content': 'center' },
      cascadeAlign: true,
    })).toContain('querySelectorAll');
    expect(buildApplyElementPatchScript('header', {
      styles: { 'background-color': 'rgb(255, 255, 255)' },
    })).toContain("setProperty(k, v, 'important')");
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
