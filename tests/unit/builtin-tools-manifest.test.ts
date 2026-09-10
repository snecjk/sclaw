import { describe, expect, it } from 'vitest';
import {
  filterPluginSpecsByManifest,
  parseStoBuiltinToolsManifest,
} from '../../electron/utils/builtin-tools-manifest';

describe('sto-builtin-tools manifest (H1)', () => {
  const fallback = [
    { dirName: 'wecom', label: 'WeCom' },
    { dirName: 'sto-scheduled-task-tool', label: 'Scheduled' },
    { dirName: 'sto-browser-automation', label: 'BA' },
    { dirName: 'sto-browser-bridge', label: 'Bridge' },
  ];

  it('keeps the hardcoded list when manifest is missing', () => {
    expect(filterPluginSpecsByManifest(fallback, null)).toEqual(fallback);
  });

  it('drops plugins that the manifest marks enabled:false', () => {
    const manifest = parseStoBuiltinToolsManifest(JSON.stringify({
      version: 2,
      plugins: [
        { id: 'sto-scheduled-task-tool', localDir: 'sto-scheduled-task-tool', enabled: false },
        { id: 'sto-browser-automation', localDir: 'sto-browser-automation', enabled: true },
      ],
    }));
    const filtered = filterPluginSpecsByManifest(fallback, manifest);
    expect(filtered.map((item) => item.dirName)).toEqual([
      'wecom',
      'sto-browser-automation',
      'sto-browser-bridge',
    ]);
  });
});
