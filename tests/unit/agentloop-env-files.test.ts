import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AGENTLOOP_APP_NAMES } from '../../scripts/agentloop-env';

const repoRoot = join(__dirname, '..', '..');

function readEnvFileValue(fileName: string, key: string): string | undefined {
  const content = readFileSync(join(repoRoot, fileName), 'utf-8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    if (line.slice(0, eq).trim() === key) {
      return line.slice(eq + 1).trim();
    }
  }
  return undefined;
}

describe('AgentLoop 环境文件应用名配置（task 1.1）', () => {
  it.each([
    ['.env.development', 'development'],
    ['.env.test', 'test'],
    ['.env.staging', 'staging'],
    ['.env.production', 'production'],
  ] as const)('%s 配置固定的 ARMS_APP_NAME=sto-claw-%s', (fileName, mode) => {
    const expected = AGENTLOOP_APP_NAMES[mode];
    expect(expected).toBe(`sto-claw-${mode}`);
    expect(readEnvFileValue(fileName, 'ARMS_APP_NAME')).toBe(expected);
  });

  it.each(['.env.development', '.env.test', '.env.staging', '.env.production'])(
    '%s 不提交 License 凭证',
    (fileName) => {
      expect(readEnvFileValue(fileName, 'ARMS_LICENSE_KEY')).toBeUndefined();
      expect(readEnvFileValue(fileName, 'ARMS_LICENSE')).toBeUndefined();
    },
  );
});
