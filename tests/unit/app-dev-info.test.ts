import { describe, expect, it } from 'vitest';
import {
  creepRatio,
  isTemplateTextFile,
  pipelineProgress,
  sanitizePackageName,
  substituteTemplateVars,
} from '../../electron/utils/app-dev-info';

describe('app-dev-info', () => {
  describe('pipelineProgress（连续单进度条映射）', () => {
    it('maps phases onto non-overlapping ascending ranges', () => {
      expect(pipelineProgress('created', 0)).toBe(0);
      expect(pipelineProgress('preparing-env', 0)).toBe(0);
      expect(pipelineProgress('preparing-env', 1)).toBe(35);
      expect(pipelineProgress('installing', 0)).toBe(35);
      expect(pipelineProgress('installing', 1)).toBe(80);
      expect(pipelineProgress('starting', 0)).toBe(80);
      expect(pipelineProgress('starting', 1)).toBe(99);
      expect(pipelineProgress('ready', 0)).toBe(100);
    });

    it('clamps out-of-range ratios', () => {
      expect(pipelineProgress('installing', -1)).toBe(35);
      expect(pipelineProgress('installing', 2)).toBe(80);
    });
  });

  describe('sanitizePackageName', () => {
    it('converts Chinese/mixed names to a safe fallback or kebab-case', () => {
      expect(sanitizePackageName('快递查询')).toBe('sclaw-app');
      expect(sanitizePackageName('My Cool App!')).toBe('my-cool-app');
      expect(sanitizePackageName('  Order-Center 2 ')).toBe('order-center-2');
    });
  });

  describe('isTemplateTextFile', () => {
    it('treats source/config/doc files and dotfiles as text', () => {
      for (const f of ['a.tsx', 'b.json', 'index.html', '.npmrc', '.gitignore', 'x.css', 'y.md']) {
        expect(isTemplateTextFile(f), f).toBe(true);
      }
    });

    it('treats binaries as non-text', () => {
      expect(isTemplateTextFile('logo.png')).toBe(false);
      expect(isTemplateTextFile('font.woff2')).toBe(false);
    });
  });

  it('substituteTemplateVars replaces every occurrence of both vars', () => {
    const out = substituteTemplateVars('{"name":"__APP_NAME__","title":"__APP_TITLE__ / __APP_TITLE__"}', {
      appName: 'my-app',
      appTitle: '我的应用',
    });
    expect(out).toBe('{"name":"my-app","title":"我的应用 / 我的应用"}');
  });

  it('creepRatio approaches but never reaches 1', () => {
    let r = 0;
    for (let i = 0; i < 500; i++) r = creepRatio(r);
    expect(r).toBeGreaterThan(0.9);
    expect(r).toBeLessThanOrEqual(0.98);
  });
});
