import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extensionFromBasename,
  normalizeArtifactPathPrefix,
  stripFileUrlScheme,
} from '../../shared/artifact-path';

const HOME = '/Users/sto';

describe('normalizeArtifactPathPrefix', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('expands /.stoclaw to home-relative path', () => {
    expect(
      normalizeArtifactPathPrefix(
        '/.stoclaw/openclaw/workspace/.claw-output/report.html',
        HOME,
      ),
    ).toBe('/Users/sto/.stoclaw/openclaw/workspace/.claw-output/report.html');
  });

  it('expands ~/.stoclaw paths', () => {
    expect(
      normalizeArtifactPathPrefix('~/.stoclaw/openclaw/workspace/foo.md', HOME),
    ).toBe('/Users/sto/.stoclaw/openclaw/workspace/foo.md');
  });

  it('rewrites legacy .openclaw/workspace to .stoclaw/openclaw/workspace', () => {
    expect(
      normalizeArtifactPathPrefix('/Users/sto/.openclaw/workspace/report.html', HOME),
    ).toBe('/Users/sto/.stoclaw/openclaw/workspace/report.html');
  });

  it('normalizes Windows file:// URLs', () => {
    expect(stripFileUrlScheme('file:///C:/Users/sto/report.html')).toBe('C:/Users/sto/report.html');
  });
});

describe('extensionFromBasename', () => {
  it('prefers tsv over ts', () => {
    expect(extensionFromBasename('data.tsv')).toBe('tsv');
  });

  it('prefers html over htm', () => {
    expect(extensionFromBasename('page.html')).toBe('html');
  });
});
