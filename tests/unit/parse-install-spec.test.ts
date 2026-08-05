import { describe, expect, it } from 'vitest';

import { parseManagedCliInstallSpec } from '../../shared/connectors/parse-install-spec';

describe('parseManagedCliInstallSpec', () => {
  it('parses install manifest URL and source priority', () => {
    const spec = parseManagedCliInstallSpec({
      binary: 'dws',
      install: {
        manifestUrl: 'https://cdn.example.com/dws/manifest.json',
        fallbackManifestUrl: 'bundled://resources/dws/manifest.json',
        sourcePriority: ['cdn', 'gitee', 'github'],
        manifestCacheTtlSec: 7200,
        postInstall: [['dws', 'skill', 'setup', '--mode', 'mono']],
      },
    });

    expect(spec.manifestUrl).toBe('https://cdn.example.com/dws/manifest.json');
    expect(spec.fallbackManifestUrl).toBe('bundled://resources/dws/manifest.json');
    expect(spec.sourcePriority).toEqual(['cdn', 'gitee', 'github']);
    expect(spec.manifestCacheTtlSec).toBe(7200);
    expect(spec.postInstall).toEqual([['dws', 'skill', 'setup', '--mode', 'mono']]);
  });

  it('drops invalid source priority entries', () => {
    const spec = parseManagedCliInstallSpec({
      install: {
        sourcePriority: ['cdn', 'invalid', 'github'],
      },
    });
    expect(spec.sourcePriority).toEqual(['cdn', 'github']);
  });
});
