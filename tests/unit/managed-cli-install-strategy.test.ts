import { describe, expect, it } from 'vitest';

import { parseManagedCliInstallSpec } from '../../shared/connectors/parse-install-spec';
import { parseManagedCliAuthSpec } from '../../shared/connectors/parse-auth-spec';
import { resolveManagedCliInstallStrategy } from '../../shared/connectors/resolve-install-strategy';

describe('resolveManagedCliInstallStrategy', () => {
  it('uses explicit strategy', () => {
    expect(
      resolveManagedCliInstallStrategy({ strategy: 'shell_script' }),
    ).toBe('shell_script');
  });

  it('infers shell_script from unix/windows URLs', () => {
    expect(
      resolveManagedCliInstallStrategy({
        unix: 'https://example.com/install.sh',
      }),
    ).toBe('shell_script');
  });

  it('infers release_asset from releaseApiUrl', () => {
    expect(
      resolveManagedCliInstallStrategy({
        releaseApiUrl: 'https://gitlab.com/api/v4/projects/1/releases',
      }),
    ).toBe('release_asset');
  });

  it('infers manifest_assets from manifestUrl', () => {
    expect(
      resolveManagedCliInstallStrategy({
        manifestUrl: 'server://conn-x/install-manifest',
      }),
    ).toBe('manifest_assets');
  });

  it('falls back to legacy binary heuristics', () => {
    expect(resolveManagedCliInstallStrategy({}, { binary: 'qpath' })).toBe('shell_script');
    expect(resolveManagedCliInstallStrategy({}, { binary: 'glab' })).toBe('release_asset');
    expect(resolveManagedCliInstallStrategy({}, { binary: 'dws' })).toBe('manifest_assets');
  });
});

describe('parseManagedCliInstallSpec', () => {
  it('parses strategy and shell_script fields', () => {
    const spec = parseManagedCliInstallSpec({
      binary: 'qpath',
      install: {
        strategy: 'shell_script',
        unix: 'https://example.com/install',
        windows: 'https://example.com/install.cmd',
        binDir: '~/.sto/qpath-cli/bin',
      },
    });
    expect(spec.strategy).toBe('shell_script');
    expect(spec.unix).toContain('install');
    expect(spec.windows).toContain('install.cmd');
    expect(spec.binDir).toBe('~/.sto/qpath-cli/bin');
  });

  it('parses release_asset fields', () => {
    const spec = parseManagedCliInstallSpec({
      binary: 'glab',
      install: {
        strategy: 'release_asset',
        releaseApiUrl: 'https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/releases?per_page=1',
        assetNameHint: 'darwin_arm64',
      },
    });
    expect(spec.strategy).toBe('release_asset');
    expect(spec.releaseApiUrl).toContain('gitlab.com');
    expect(spec.assetNameHint).toBe('darwin_arm64');
  });
});

describe('parseManagedCliAuthSpec', () => {
  it('parses cli_login with embedded ui', () => {
    const auth = parseManagedCliAuthSpec({
      auth: {
        type: 'cli_login',
        ui: 'embedded',
        login: ['qpath', 'login'],
        status: ['qpath', 'status'],
        logout: ['qpath', 'logout'],
      },
    });
    expect(auth?.type).toBe('cli_login');
    expect(auth?.ui).toBe('embedded');
    expect(auth?.login).toEqual(['qpath', 'login']);
    expect(auth?.status).toEqual(['qpath', 'status']);
    expect(auth?.logout).toEqual(['qpath', 'logout']);
  });
});

describe('legacy install defaults for shell/release', () => {
  it('keeps qpath unix/windows/binDir defaults when strategy is shell_script', () => {
    const strategy = resolveManagedCliInstallStrategy(
      parseManagedCliInstallSpec({ binary: 'qpath', install: { strategy: 'shell_script' } }),
      { binary: 'qpath' },
    );
    expect(strategy).toBe('shell_script');
  });

  it('keeps glab release_asset when only binary is known', () => {
    expect(resolveManagedCliInstallStrategy({}, { binary: 'glab' })).toBe('release_asset');
  });
});
