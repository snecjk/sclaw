import { describe, expect, it } from 'vitest';
import {
  MANAGED_NODE_VERSION,
  buildDownloadPlan,
  nodeArchiveName,
  nodeBinRelativePaths,
  nodeDistName,
  parseShasums,
} from '../../electron/utils/node-runtime-info';

describe('node-runtime-info', () => {
  it('pins an exact semver version', () => {
    expect(MANAGED_NODE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  describe('nodeDistName / nodeArchiveName', () => {
    it('maps win32 to win and uses zip', () => {
      expect(nodeDistName('22.14.0', 'win32', 'x64')).toBe('node-v22.14.0-win-x64');
      expect(nodeArchiveName('22.14.0', 'win32', 'x64')).toBe('node-v22.14.0-win-x64.zip');
    });

    it('uses tar.gz on darwin/linux', () => {
      expect(nodeArchiveName('22.14.0', 'darwin', 'arm64')).toBe('node-v22.14.0-darwin-arm64.tar.gz');
      expect(nodeArchiveName('22.14.0', 'linux', 'x64')).toBe('node-v22.14.0-linux-x64.tar.gz');
    });
  });

  describe('buildDownloadPlan', () => {
    it('orders npmmirror before official when no internal source', () => {
      const plan = buildDownloadPlan('22.14.0', 'darwin', 'arm64');
      expect(plan.map((s) => s.label)).toEqual(['npmmirror', 'official']);
      expect(plan[0].archiveUrl).toBe(
        'https://registry.npmmirror.com/-/binary/node/v22.14.0/node-v22.14.0-darwin-arm64.tar.gz',
      );
      expect(plan[1].archiveUrl).toBe(
        'https://nodejs.org/dist/v22.14.0/node-v22.14.0-darwin-arm64.tar.gz',
      );
    });

    it('puts the internal source first and pairs SHASUMS from the same base', () => {
      const plan = buildDownloadPlan('22.14.0', 'win32', 'x64', 'http://mirror.sto.cn/node/');
      expect(plan.map((s) => s.label)).toEqual(['internal', 'npmmirror', 'official']);
      expect(plan[0].archiveUrl).toBe('http://mirror.sto.cn/node/v22.14.0/node-v22.14.0-win-x64.zip');
      expect(plan[0].shasumsUrl).toBe('http://mirror.sto.cn/node/v22.14.0/SHASUMS256.txt');
    });

    it('ignores a blank internal base URL', () => {
      const plan = buildDownloadPlan('22.14.0', 'darwin', 'x64', '   ');
      expect(plan.map((s) => s.label)).toEqual(['npmmirror', 'official']);
    });
  });

  describe('parseShasums', () => {
    const body = [
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  node-v22.14.0-darwin-arm64.tar.gz',
      'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB  node-v22.14.0-win-x64.zip',
      '',
      'not a shasum line',
    ].join('\n');

    it('finds the digest for an exact file name and lowercases it', () => {
      expect(parseShasums(body, 'node-v22.14.0-win-x64.zip')).toBe(
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      );
    });

    it('returns null when the file is not listed', () => {
      expect(parseShasums(body, 'node-v22.14.0-linux-x64.tar.gz')).toBeNull();
    });

    it('supports the binary-mode asterisk prefix', () => {
      const starred =
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc *node-v22.14.0-linux-x64.tar.gz';
      expect(parseShasums(starred, 'node-v22.14.0-linux-x64.tar.gz')).toBe(
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      );
    });
  });

  describe('nodeBinRelativePaths', () => {
    it('returns exe/cmd at the root on Windows', () => {
      expect(nodeBinRelativePaths('win32')).toEqual({ node: 'node.exe', npm: 'npm.cmd', binDir: '.' });
    });

    it('returns bin/ paths on darwin/linux', () => {
      expect(nodeBinRelativePaths('darwin')).toEqual({ node: 'bin/node', npm: 'bin/npm', binDir: 'bin' });
    });
  });
});
