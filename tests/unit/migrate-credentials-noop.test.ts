import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateLegacyCredentials } from '../../electron/message-channel/weixin/runtime/transport/migrate-credentials';

describe('migrateLegacyCredentials (permanent no-op)', () => {
  let root: string;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('does not copy legacy files into the target dir', () => {
    root = mkdtempSync(join(tmpdir(), 'migrate-noop-'));
    const sourceDir = join(root, 'legacy');
    const targetDir = join(root, 'weixin');
    mkdirSync(join(sourceDir, 'accounts'), { recursive: true });
    writeFileSync(join(sourceDir, 'accounts.json'), '{"accountIds":["bot-1"]}');
    writeFileSync(join(sourceDir, 'accounts', 'bot-1.json'), '{"token":"secret"}');

    const result = migrateLegacyCredentials({ sourceDir, targetDir, overwrite: true });
    expect(result.copiedFiles).toEqual([]);
    expect(result.hadSource).toBe(false);
    expect(existsSync(join(targetDir, 'accounts.json'))).toBe(false);
    expect(existsSync(join(targetDir, 'accounts', 'bot-1.json'))).toBe(false);
    // Source left intact (no-op does not delete).
    expect(readFileSync(join(sourceDir, 'accounts', 'bot-1.json'), 'utf8')).toContain('secret');
  });
});
