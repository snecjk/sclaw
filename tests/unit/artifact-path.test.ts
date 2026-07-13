import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extensionFromBasename,
  migrateLegacyOpenClawWorkspacePath,
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

  it('preserves legacy .openclaw/workspace paths (migration is resolve-time)', () => {
    expect(
      normalizeArtifactPathPrefix('/Users/sto/.openclaw/workspace/report.html', HOME),
    ).toBe('/Users/sto/.openclaw/workspace/report.html');
  });

  it('preserves legacy Windows .openclaw workspace with backslashes', () => {
    expect(
      normalizeArtifactPathPrefix(
        'C:\\Users\\sto\\.openclaw\\workspace\\.claw-output\\report.html',
        'C:\\Users\\sto',
      ),
    ).toBe('C:/Users/sto/.openclaw/workspace/.claw-output/report.html');
  });

  it('preserves legacy Windows .openclaw workspace with forward slashes', () => {
    expect(
      normalizeArtifactPathPrefix(
        'C:/Users/sto/.openclaw/workspace/outputs/report.html',
        'C:/Users/sto',
      ),
    ).toBe('C:/Users/sto/.openclaw/workspace/outputs/report.html');
  });

  it('preserves file:// Windows legacy workspace path', () => {
    expect(
      normalizeArtifactPathPrefix(
        'file:///C:/Users/sto/.openclaw/workspace/.claw-output/report.html',
        'C:/Users/sto',
      ),
    ).toBe('C:/Users/sto/.openclaw/workspace/.claw-output/report.html');
  });

  it('normalizes Windows file:// URLs', () => {
    expect(stripFileUrlScheme('file:///C:/Users/sto/report.html')).toBe('C:/Users/sto/report.html');
  });
});

describe('migrateLegacyOpenClawWorkspacePath', () => {
  it('rewrites legacy .openclaw/workspace to .stoclaw/openclaw/workspace', () => {
    expect(
      migrateLegacyOpenClawWorkspacePath('/Users/sto/.openclaw/workspace/report.html'),
    ).toBe('/Users/sto/.stoclaw/openclaw/workspace/report.html');
  });

  it('rewrites legacy Windows .openclaw workspace with backslashes', () => {
    expect(
      migrateLegacyOpenClawWorkspacePath(
        'C:\\Users\\sto\\.openclaw\\workspace\\.claw-output\\report.html',
      ),
    ).toBe('C:\\Users\\sto\\.stoclaw\\openclaw\\workspace\\.claw-output\\report.html');
  });

  it('rewrites legacy Windows .openclaw workspace with forward slashes', () => {
    expect(
      migrateLegacyOpenClawWorkspacePath(
        'C:/Users/sto/.openclaw/workspace/outputs/report.html',
      ),
    ).toBe('C:/Users/sto/.stoclaw/openclaw/workspace/outputs/report.html');
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
