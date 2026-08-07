import { describe, expect, it } from 'vitest';

import { parseServerManifestConnectorCode } from '../../electron/connectors/resolve-install-manifest';

describe('parseServerManifestConnectorCode', () => {
  it('parses server manifest URL', () => {
    expect(parseServerManifestConnectorCode('server://dingtalk-dws/install-manifest')).toBe(
      'dingtalk-dws',
    );
    expect(parseServerManifestConnectorCode('server://qpath-conn')).toBe('qpath-conn');
  });

  it('returns null for non-server URLs', () => {
    expect(parseServerManifestConnectorCode('bundled://resources/dws/manifest.json')).toBeNull();
    expect(parseServerManifestConnectorCode('https://example/manifest.json')).toBeNull();
  });
});
