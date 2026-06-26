import { describe, expect, it } from 'vitest';
import {
  enrichMediaAttachedText,
  joinWorkspacePath,
  resolveFileRefPath,
} from '../../shared/media-path-enrich';
import { parseToolOutputFiles } from '../../shared/tool-output-files';

describe('resolveFileRefPath', () => {
  const hints = { runDir: '/Users/sto/.openclaw/workspace/.claw-output' };

  it('joins basename with runDir', () => {
    expect(resolveFileRefPath('report.html', hints, [])).toBe(
      '/Users/sto/.openclaw/workspace/.claw-output/report.html',
    );
  });

  it('prefers structured outputFiles path', () => {
    const outputFiles = parseToolOutputFiles({
      outputFiles: [{ path: '/Users/sto/.openclaw/workspace/.claw-output/report.html' }],
    });
    expect(resolveFileRefPath('report.html', hints, outputFiles)).toBe(
      '/Users/sto/.openclaw/workspace/.claw-output/report.html',
    );
  });

  it('leaves absolute paths unchanged', () => {
    const abs = '/tmp/abs.html';
    expect(resolveFileRefPath(abs, hints, [])).toBe(abs);
  });
});

describe('enrichMediaAttachedText', () => {
  it('enriches basename media attached with spaces in filename', () => {
    const text = '[media attached: 申通快递分析-20260626.html (text/html) | 申通快递分析-20260626.html]';
    const hints = { runDir: '/Users/sto/ws/.claw-output' };
    const enriched = enrichMediaAttachedText(text, hints);
    expect(enriched).toContain('/Users/sto/ws/.claw-output/申通快递分析-20260626.html');
  });

  it('enriches spaced basename from model copy', () => {
    const text = '[media attached: 申通快递分析 -20260626.html (text/html) | 申通快递分析 -20260626.html]';
    const hints = { runDir: '/Users/sto/ws/.claw-output' };
    const enriched = enrichMediaAttachedText(text, hints);
    expect(enriched).toContain('申通快递分析 -20260626.html');
    expect(enriched).toContain('/Users/sto/ws/.claw-output/');
  });
});

describe('joinWorkspacePath', () => {
  it('strips trailing slashes from base', () => {
    expect(joinWorkspacePath('/base///', 'out/a.html')).toBe('/base/out/a.html');
  });
});
